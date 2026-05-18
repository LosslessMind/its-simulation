/**
 * algorithm.js — 4-фазный адаптивный, фиксированный и алгоритм Вебстера
 *
 * Фазы:  ns_main → ns_left → ew_main → ew_left  (по кругу)
 *   ns_main / ew_main:  только правые полосы (прямо + направо)
 *   ns_left / ew_left:  только левые полосы (левый поворот)
 *
 * Адаптивный (этап 2):
 *   - _main: T = T_MIN + K*(Q/Q_MAX)*(T_MAX-T_MIN) + W_factor
 *   - W_factor = min(10, max_wait/10)  — бонус к фазе при долгом ожидании
 *   - При max_wait > 60 с: принудительный выбор оси с наибольшим ожиданием
 *   - _left: T = max(5, min(15, 5 + Q_left*1.5))
 *   - При Q_left < SKIP_LEFT_MIN фаза пропускается
 *
 * Вебстер (этап 3):
 *   - C_opt = (1.5*L + 5) / (1 - Yc)
 *   - Yc = sum(max(λ_A, λ_B) / s) по каждой из 4 фаз
 *   - Пересчёт каждые 30 с на основе данных последних 60 с
 */
'use strict';

const PHASE_CFG = {
  T_MIN:                20,
  T_MAX:                55,
  T_YELLOW:              3,
  T_FIXED_MAIN:         25,
  T_FIXED_LEFT:         10,
  Q_MAX:                60,
  K:                     1.0,
  EXTEND_Q_RATIO:        0.70,
  EXTEND_MAX:           10,
  SKIP_LEFT_MIN:         3,
  WAIT_FORCE_THRESHOLD: 60,   // этап 2: принудит. смена при ожидании > 60 с
  WEBSTER_L:            12,   // этап 3: потери за цикл (4 × 3 с жёлтого)
  WEBSTER_S:             5.0,  // насыщающий поток (авт/с, подобран под масштаб симуляции)
  WEBSTER_INTERVAL:     30,   // пересчёт Вебстера каждые 30 с
  T_WEBSTER_MIN:         8,
  T_WEBSTER_MAX:        60,
};

const PHASES = ['ns_main', 'ns_left', 'ew_main', 'ew_left'];

const PHASE_DEF = {
  ns_main: { axis: 'NS', lane: 'right', label: 'Север — Юг: прямо + направо'    },
  ns_left: { axis: 'NS', lane: 'left',  label: 'Север — Юг: левый поворот'       },
  ew_main: { axis: 'EW', lane: 'right', label: 'Восток — Запад: прямо + направо' },
  ew_left: { axis: 'EW', lane: 'left',  label: 'Восток — Запад: левый поворот'   },
};

const PHASE_PED = {
  ns_main: { north: 'red',   south: 'red',   east: 'green', west: 'green' },
  ns_left: { north: 'red',   south: 'red',   east: 'red',   west: 'red'   },
  ew_main: { north: 'green', south: 'green', east: 'red',   west: 'red'   },
  ew_left: { north: 'red',   south: 'red',   east: 'red',   west: 'red'   },
};

const PED_ALL_RED = { north: 'red', south: 'red', east: 'red', west: 'red' };

const RT_CONFLICT = { N: 'west', S: 'east', E: 'north', W: 'south' };

/* ------------------------------------------------------------------ */
/*  PhaseRecord                                                         */
/* ------------------------------------------------------------------ */
class PhaseRecord {
  constructor(num, axis, lane, mode, startTime) {
    this.num       = num;
    this.axis      = axis;
    this.lane      = lane;
    this.mode      = mode;
    this.startTime = startTime;
    this.duration  = 0;
    this.served    = 0;
    this.waitTimes = [];
    this.maxQueue  = 0;
  }
  get avgWait() {
    if (!this.waitTimes.length) return 0;
    return this.waitTimes.reduce((a, b) => a + b, 0) / this.waitTimes.length;
  }
}

/* ------------------------------------------------------------------ */
/*  Algorithm                                                           */
/* ------------------------------------------------------------------ */
class Algorithm {
  constructor(intersection, logger, stats) {
    this.ix     = intersection;
    this.logger = logger;
    this.stats  = stats;

    this.mode  = 'adaptive';
    this.state = 'idle';
    this.axis  = null;
    this._currentPhaseKey = null;

    this.timer         = 0;
    this.greenDuration = 0;

    this._svcAcc   = 0;
    this._phaseNum = 0;
    this._phaseIdx = 0;
    this._record   = null;
    this._extended = false;

    this._nightBlink      = false;
    this._nightBlinkTimer = 0;
    this._pendingAxis     = null;
    this._lastChoiceForced = false;

    this.skippedLeftPhases = 0;

    /* Вебстер (этап 3) */
    this._websterTimer     = 0;
    this._websterDurations = { ns_main: 25, ns_left: 10, ew_main: 25, ew_left: 10 };
  }

  setMode(mode) {
    this.mode  = mode;
    this.state = 'idle';
    this.timer = 0;
    this._extended    = false;
    this._pendingAxis = null;
    if (mode === 'night') {
      this._nightBlink      = false;
      this._nightBlinkTimer = 0;
    }
    this.ix.phaseState       = 'red';
    this.ix.currentAxis      = null;
    this.ix.currentPhaseType = null;
    this.ix.pedLights        = { ...PED_ALL_RED };

    /* Начальная запись в журнал */
    const startMsg = {
      adaptive:   '[АДАПТ.] Старт',
      fixed:      '[ФИКС.] Старт',
      manual:     '[РУЧНОЙ] Ожидание выбора оси',
      night:      '[НОЧНОЙ] Мигающий жёлтый',
      pedestrian: '[ПЕШЕХОДНЫЙ] Зелёный для пешеходов',
    };
    if (mode === 'webster') {
      this._calcWebster();
      const { C, Yc } = this._lastWebsterInfo;
      this.logger.log('SYSTEM',
        `[ВЕБСТЕР] Старт: C=${C.toFixed(0)} с, Yc=${Yc.toFixed(2)}`,
        this.ix.simTime);
    } else if (startMsg[mode]) {
      this.logger.log('SYSTEM', startMsg[mode], this.ix.simTime);
    }
  }

  requestAxis(axis) {
    this._pendingAxis = axis;
    this.logger.log('SYSTEM', `Ручная команда: → ${AXIS_NAME[axis]}`, this.ix.simTime);
  }

  tick(dt) {
    if (this.mode === 'night')       { this._tickNight(dt);      return; }
    if (this.mode === 'pedestrian')  { this._tickPedestrian(dt); return; }

    /* Вебстер: пересчёт цикла каждые WEBSTER_INTERVAL секунд */
    if (this.mode === 'webster') {
      this._websterTimer += dt;
      if (this._websterTimer >= PHASE_CFG.WEBSTER_INTERVAL) {
        this._calcWebster();
        this._websterTimer = 0;
      }
    }

    if (this.state === 'idle') { this._startNext(); return; }

    this.timer -= dt;
    if (this.timer < 0) this.timer = 0;
    this.ix.phaseTimer = Math.ceil(this.timer);

    if (this.state === 'green') {
      this._serviceStep(dt);
      this._checkExtend();
    } else if (this.state === 'yellow') {
      if (this.timer <= 0) this._endPhase();
    }
  }

  _startNext() {
    /* Цикл вместо рекурсии — предотвращает зависание при пропуске всех left-фаз */
    for (let guard = 0; guard <= PHASES.length; guard++) {
      const key = this._choosePhase();
      if (!key) {
        this.ix.phaseState = 'red'; this.ix.currentAxis = null;
        this.ix.currentPhaseType = null; this.ix.pedLights = { ...PED_ALL_RED };
        return;
      }
      /* Пропустить пустую left-фазу, но только если она не была принудительно
         выбрана _forceByMaxWait (там Q=1-2, но машина ждёт > 60 с — надо обслужить) */
      const def = PHASE_DEF[key];
      if (!this._lastChoiceForced &&
          (this.mode === 'adaptive' || this.mode === 'webster') &&
          def.lane === 'left') {
        const Q = this.ix.getAxisLaneQueue(def.axis, 'left');
        if (Q < PHASE_CFG.SKIP_LEFT_MIN) {
          this.skippedLeftPhases++;
          if (this.stats) this.stats.skippedLeftPhases++;
          this.logger.log('PHASE', `[ФАЗА] Фаза ${key} пропущена: Q_left=${Q}`, this.ix.simTime);
          continue;
        }
      }
      this._beginGreen(key);
      return;
    }
    this.logger.log('WARNING', '[АЛГОРИТМ] Превышен лимит итераций выбора фазы', this.ix.simTime);
  }

  _choosePhase() {
    this._lastChoiceForced = false;
    if (this.mode === 'manual') {
      if (!this._pendingAxis) return null;
      const axis = this._pendingAxis; this._pendingAxis = null;
      return axis === 'NS' ? 'ns_main' : 'ew_main';
    }
    /* Этап 2: принудительный выбор при долгом ожидании (только адаптивный) */
    if (this.mode === 'adaptive') {
      const forced = this._forceByMaxWait();
      if (forced) { this._lastChoiceForced = true; return forced; }
    }
    const key = PHASES[this._phaseIdx % PHASES.length];
    this._phaseIdx++;
    return key;
  }

  /* Этап 2: вернуть ключ фазы, если есть машина с ожиданием > 60 с */
  _forceByMaxWait() {
    let maxWait = 0, maxDir = null, maxLane = null;
    for (const dir of DIRS) {
      for (const lane of ['left', 'right']) {
        for (const car of this.ix.queues[dir][lane]) {
          if (car.waitTime > maxWait) {
            maxWait = car.waitTime; maxDir = dir; maxLane = lane;
          }
        }
      }
    }
    if (maxWait < PHASE_CFG.WAIT_FORCE_THRESHOLD) return null;
    const axis = (maxDir === 'N' || maxDir === 'S') ? 'NS' : 'EW';
    const key  = axis === 'NS'
      ? (maxLane === 'left' ? 'ns_left' : 'ns_main')
      : (maxLane === 'left' ? 'ew_left' : 'ew_main');
    this._phaseIdx = PHASES.indexOf(key) + 1;
    this.logger.log('PHASE',
      `[ПРИОРИТЕТ] Макс. ожидание ${maxWait.toFixed(0)} с → принудит. ${key}`,
      this.ix.simTime);
    return key;
  }

  _calcDuration(key) {
    const def = PHASE_DEF[key];
    const { T_MIN, T_MAX, T_FIXED_MAIN, T_FIXED_LEFT, Q_MAX, K } = PHASE_CFG;
    if (this.mode === 'fixed') {
      return def.lane === 'left' ? T_FIXED_LEFT : T_FIXED_MAIN;
    }
    if (this.mode === 'webster') {
      return this._websterDurations[key];
    }
    /* adaptive */
    if (def.lane === 'left') {
      const Q = this.ix.getAxisLaneQueue(def.axis, 'left');
      return Math.max(5, Math.min(15, 5 + Q * 1.5));
    }
    /* Этап 2: добавить бонус W_factor при большом ожидании */
    const Q       = this.ix.getAxisLaneQueue(def.axis, 'right');
    const maxWait = this.ix.getMaxWaitTime ? this.ix.getMaxWaitTime() : 0;
    const wFactor = Math.min(10, maxWait / 10);
    return T_MIN + K * (Math.min(Q, Q_MAX) / Q_MAX) * (T_MAX - T_MIN) + wFactor;
  }

  _beginGreen(key) {
    const def = PHASE_DEF[key];
    this._currentPhaseKey = key;
    this.axis  = def.axis;
    this.state = 'green';
    this.greenDuration = this._calcDuration(key);
    this.timer = this.greenDuration;
    this._svcAcc = 0; this._extended = false;
    this._phaseNum++;

    this.ix.currentAxis      = def.axis;
    this.ix.currentPhaseType = def.lane === 'left' ? 'l' : 'sr';
    this.ix.phaseState       = 'green';
    this.ix.phaseTimer       = Math.ceil(this.timer);
    this.ix.phaseDuration    = this.greenDuration;
    this.ix.pedLights        = { ...(PHASE_PED[key] || PED_ALL_RED) };

    const Q  = this.ix.getAxisLaneQueue(def.axis, def.lane);
    this._record = new PhaseRecord(this._phaseNum, def.axis, def.lane, this.mode, this.ix.simTime);
    this._record.maxQueue = Q;

    const ml = { fixed: 'фиксир.', webster: 'вебстер', adaptive: 'адапт.' }[this.mode] || 'адапт.';
    this.logger.log('PHASE',
      `[ФАЗА] Запуск ${key}: T=${Math.round(this.greenDuration)}с, Q=${Q} [${ml}]`,
      this.ix.simTime);
  }

  _serviceStep(dt) {
    const SVC = 0.7;
    this._svcAcc += dt;
    while (this._svcAcc >= SVC) {
      const lane   = PHASE_DEF[this._currentPhaseKey].lane;
      const served = this.ix.serviceCars(this.axis, lane);
      if (served.length === 0) { this._svcAcc = 0; break; }
      for (const car of served) {
        if (this._record) {
          this._record.served++;
          this._record.waitTimes.push(car.waitTime);
        }
        if (car.turnDir === 'right') this._checkPedConflict(car.dir);
        this.logger.log('AUTO',
          `Авто #${car.id} (${DIR_NAME[car.dir]}, ${TURN_NAME[car.turnDir]}) проехало, ожидание: ${car.waitTime.toFixed(1)} с`,
          this.ix.simTime);
      }
      this._svcAcc -= SVC;
    }
  }

  _checkPedConflict(dir) {
    const crossing = RT_CONFLICT[dir];
    if (!crossing) return;
    const hasPed = this.ix.pedestrians.some(p => p.crossing === crossing && p.state === 'crossing');
    if (hasPed && Math.random() < 0.4) {
      this.ix.pedDelays++;
      this.logger.log('PEDESTRIAN',
        `Авто (${DIR_NAME[dir]}, направо) уступает пешеходу — переход «${crossing}»`,
        this.ix.simTime);
    }
  }

  _checkExtend() {
    if (this.timer > 0) return;
    if (!this._extended && this.mode === 'adaptive') {
      const def = PHASE_DEF[this._currentPhaseKey];
      if (def.lane === 'right') {
        const Q     = this.ix.getAxisLaneQueue(def.axis, 'right');
        const limit = PHASE_CFG.Q_MAX * PHASE_CFG.EXTEND_Q_RATIO;
        if (Q > limit) {
          const ext = Math.min(PHASE_CFG.EXTEND_MAX, PHASE_CFG.T_MAX - this.greenDuration);
          if (ext > 0) {
            this.timer += ext; this.greenDuration += ext;
            this.ix.phaseDuration = this.greenDuration;
            this._extended = true;
            this.logger.log('PHASE',
              `Фаза #${this._phaseNum} продлена на ${ext} с (очередь: ${Q})`,
              this.ix.simTime);
            return;
          }
        }
      }
    }
    this._beginYellow();
  }

  _beginYellow() {
    this.state = 'yellow'; this.timer = PHASE_CFG.T_YELLOW;
    this.ix.phaseState = 'yellow'; this.ix.phaseTimer = PHASE_CFG.T_YELLOW;
    this.ix.pedLights  = { ...PED_ALL_RED };
    this.logger.log('PHASE', `[ФАЗА] Запуск жёлтого: 3с (${this.axis})`, this.ix.simTime);
  }

  _endPhase() {
    this.ix.phaseState = 'red'; this.ix.currentAxis = null;
    this.ix.currentPhaseType = null; this.ix.pedLights = { ...PED_ALL_RED };
    if (this._record) {
      this._record.duration = this.ix.simTime - this._record.startTime;
      this.stats.addPhaseRecord(this._record);
      this.logger.log('PHASE',
        `Фаза #${this._phaseNum} завершена: обслужено ${this._record.served}, ` +
        `ср. ожид. ${this._record.avgWait.toFixed(1)} с`,
        this.ix.simTime);
      this._record = null;
    }
    this.state = 'idle';
  }

  /* ---- Этап 3: формула Вебстера ---- */
  _calcWebster() {
    const { WEBSTER_L, WEBSTER_S, T_WEBSTER_MIN, T_WEBSTER_MAX } = PHASE_CFG;
    const ix = this.ix;

    /* Если данных прибытий ещё нет — использовать λ_default = 0.5 авт/с */
    const hasData = DIRS.some(d =>
      ix._arrivalCounts.cur[d].right > 0 || ix._arrivalCounts.prev[d].right > 0);
    const DEF_RIGHT = 0.5 * 0.8 / WEBSTER_S;  // λ=0.5, 80% — прямо+направо
    const DEF_LEFT  = 0.5 * 0.2 / WEBSTER_S;  // λ=0.5, 20% — левые

    const rate = (dirs, lane) => hasData
      ? Math.max(0.01, Math.max(...dirs.map(d => ix.getArrivalRate(d, lane))) / WEBSTER_S)
      : (lane === 'right' ? DEF_RIGHT : DEF_LEFT);

    const y = {
      ns_main: rate(['N', 'S'], 'right'),
      ns_left: rate(['N', 'S'], 'left'),
      ew_main: rate(['E', 'W'], 'right'),
      ew_left: rate(['E', 'W'], 'left'),
    };

    let Yc = Object.values(y).reduce((a, b) => a + b, 0);
    if (Yc > 0.95) Yc = 0.95;

    const C  = Math.min(200, (1.5 * WEBSTER_L + 5) / (1 - Yc));
    const gE = C - WEBSTER_L;

    for (const k of PHASES) {
      const g = gE * y[k] / Yc;
      this._websterDurations[k] = Math.max(T_WEBSTER_MIN, Math.min(T_WEBSTER_MAX, g));
    }

    this._lastWebsterInfo = { C, Yc };

    this.logger.log('PHASE',
      `[ВЕБСТЕР] C=${C.toFixed(0)} с, Yc=${Yc.toFixed(2)}: ` +
      PHASES.map(k => `${k}=${this._websterDurations[k].toFixed(0)}с`).join(', '),
      this.ix.simTime);
  }

  _tickNight(dt) {
    this._nightBlinkTimer -= dt;
    if (this._nightBlinkTimer <= 0) {
      this._nightBlink = !this._nightBlink; this._nightBlinkTimer = 0.7;
    }
    this.ix.currentAxis = null; this.ix.currentPhaseType = null;
    this.ix.phaseState  = this._nightBlink ? 'yellow' : 'off';
    this.ix.phaseTimer  = 0;
    this.ix.pedLights   = { ...PED_ALL_RED };
  }

  _tickPedestrian(dt) {
    if (this.state !== 'green') {
      this.state = 'green'; this.timer = 20; this.greenDuration = 20;
      this.ix.phaseState = 'red'; this.ix.currentAxis = null;
      this.ix.currentPhaseType = null; this.ix.phaseDuration = 20;
      this.ix.pedLights = { north: 'green', south: 'green', east: 'green', west: 'green' };
      this.logger.log('PHASE', 'Пешеходный режим: все переходы зелёные (20 с)', this.ix.simTime);
    }
    this.timer -= dt;
    if (this.timer < 0) this.timer = 0;
    this.ix.phaseTimer = Math.ceil(this.timer);
    if (this.timer <= 0) {
      this.state = 'idle'; this.ix.pedLights = { ...PED_ALL_RED }; this.ix.phaseState = 'red';
    }
  }

  reset() {
    this.state = 'idle'; this.axis = null;
    this._currentPhaseKey = null; this.timer = 0; this.greenDuration = 0;
    this._svcAcc = 0; this._phaseNum = 0; this._phaseIdx = 0;
    this._record = null; this._extended = false;
    this._nightBlink = false; this._nightBlinkTimer = 0; this._pendingAxis = null;
    this._lastChoiceForced = false;
    this.skippedLeftPhases = 0;
    this._websterTimer     = 0;
    this._websterDurations = { ns_main: 25, ns_left: 10, ew_main: 25, ew_left: 10 };
    this._lastWebsterInfo  = null;
  }
}
