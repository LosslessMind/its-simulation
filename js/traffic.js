/**
 * traffic.js — генерация транспорта и пешеходов по распределению Пуассона
 *
 * Этап 4: добавлены сценарии «Час пик» (rushhour) и «Суточный» (daily)
 * с динамическим изменением λ по времени.
 */
'use strict';

const QUEUE_CAP  = 30;
const PED_LAMBDA = 0.3;
const PED_CAP    = 10;

const SCENARIOS = {
  morning: {
    name: 'Утро',
    lambda: { N: 0.3, S: 1.2, E: 0.3, W: 1.2 },
  },
  evening: {
    name: 'Вечер',
    lambda: { N: 1.2, S: 0.3, E: 1.2, W: 0.3 },
  },
  jam: {
    name: 'Пробка',
    lambda: { N: 1.5, S: 1.5, E: 1.5, W: 1.5 },
  },
  empty: {
    name: 'Пустая дорога',
    lambda: { N: 0.15, S: 0.15, E: 0.15, W: 0.15 },
  },
  random: {
    name: 'Случайный трафик',
    lambda: { N: 0.5, S: 0.5, E: 0.5, W: 0.5 },
    randomize: true,
  },
  rushhour: {
    name: 'Час пик (5 мин)',
    lambda: { N: 0.3, S: 0.3, E: 0.3, W: 0.3 },
    dynamic: true,
    period: 300,
  },
  daily: {
    name: 'Суточный (10 мин)',
    lambda: { N: 0.3, S: 0.3, E: 0.3, W: 0.3 },
    dynamic: true,
    period: 600,
  },
};

const SCENARIO_ALIASES = {
  rush_hour: 'rushhour',
};

class TrafficGenerator {
  constructor(intersection, logger) {
    this.ix     = intersection;
    this.logger = logger;

    this.scenario = 'random';
    this.lambda   = { N: 1.0, S: 1.0, E: 1.0, W: 1.0 };

    this._randTimer    = 0;
    this._randInterval = 0;

    this._pedAcc = {};
    for (const c of CROSSINGS) this._pedAcc[c] = 0;

    /* Журнал интенсивности λ для графика (этап 4) */
    this._lambdaLog      = [];
    this._lambdaLogTimer = 0;
  }

  setScenario(key) {
    const scenarioKey = SCENARIO_ALIASES[key] || key;
    this.scenario = scenarioKey;
    const sc = SCENARIOS[scenarioKey] || SCENARIOS.random;
    this.lambda = { ...sc.lambda };
    this._randTimer      = 0;
    this._randInterval   = this._nextRandInterval();
    this._lambdaLog      = [];
    this._lambdaLogTimer = 0;
  }

  _nextRandInterval() { return 15 + Math.random() * 15; }

  _poisson(lambda) {
    if (lambda <= 0) return 0;
    const L = Math.exp(-lambda);
    let k = 0, p = 1;
    do { k++; p *= Math.random(); } while (p > L);
    return k - 1;
  }

  tick(dt) {
    const sc = SCENARIOS[this.scenario];

    /* Рандомизация λ (random-сценарий) */
    if (sc?.randomize) {
      this._randTimer += dt;
      if (this._randTimer >= this._randInterval) {
        for (const d of DIRS) this.lambda[d] = 0.3 + Math.random() * 2.7;
        this._randTimer    = 0;
        this._randInterval = this._nextRandInterval();
        this.logger.log('SYSTEM',
          `Трафик изменён: λ=[${DIRS.map(d => this.lambda[d].toFixed(1)).join(', ')}]`,
          this.ix.simTime);
      }
    }

    /* Динамический сценарий — пересчитывать λ каждый тик */
    if (sc?.dynamic) {
      this.lambda = this._getDynamicLambda(this.ix.simTime);
    }

    /* Журнал интенсивности каждые 5 с */
    this._lambdaLogTimer += dt;
    if (this._lambdaLogTimer >= 5) {
      this._lambdaLog.push({ t: this.ix.simTime, ...this.lambda });
      if (this._lambdaLog.length > 240) this._lambdaLog.shift();
      this._lambdaLogTimer = 0;
    }

    /* Генерация автомобилей */
    for (const d of DIRS) {
      const qLen = this.ix.getDirQueueLen(d);
      if (qLen >= QUEUE_CAP) continue;
      const n = Math.min(this._poisson(this.lambda[d] * dt), QUEUE_CAP - qLen);
      for (let i = 0; i < n; i++) {
        const car = this.ix.addCar(d);
        this.logger.log('AUTO',
          `Авто #${car.id} прибыло (${DIR_NAME[d]}, ${TURN_NAME[car.turnDir]})`,
          this.ix.simTime);
      }
    }

    /* Генерация пешеходов */
    for (const crossing of CROSSINGS) {
      const onCrossing = this.ix.pedestrians.filter(p => p.crossing === crossing).length;
      if (onCrossing >= PED_CAP) continue;
      this._pedAcc[crossing] += PED_LAMBDA * dt;
      while (this._pedAcc[crossing] >= 1) {
        const ped = this.ix.addPedestrian(crossing);
        this.logger.log('PEDESTRIAN',
          `Пешеход #${ped.id} ждёт перехода (${crossing})`,
          this.ix.simTime);
        this._pedAcc[crossing] -= 1;
      }
    }
  }

  /* Этап 4: расчёт динамической λ по времени симуляции */
  _getDynamicLambda(simTime) {
    const sc  = SCENARIOS[this.scenario];
    const now = simTime % sc.period;
    const lerp = (a, b, t0, t1) =>
      now <= t0 ? a : now >= t1 ? b : a + (b - a) * (now - t0) / (t1 - t0);

    if (this.scenario === 'rushhour') {
      /* 5-минутный цикл:
       *  0–60 с:   спокойно
       *  60–120 с: нарастание утреннего пика (Юг+Запад)
       *  120–180 с: пик Ю+З
       *  180–240 с: переход (Ю+З спадает, С+В нарастает)
       *  240–300 с: вечерний пик (Север+Восток)
       */
      if (now < 60)  return { N: 0.3, S: 0.3, E: 0.3, W: 0.3 };
      if (now < 120) return { N: 0.3, S: lerp(0.3, 2.0, 60, 120), E: 0.3, W: lerp(0.3, 2.0, 60, 120) };
      if (now < 180) return { N: 0.5, S: 2.0, E: 0.5, W: 2.0 };
      if (now < 240) return {
        N: lerp(0.3, 2.0, 180, 240), S: lerp(2.0, 0.3, 180, 240),
        E: lerp(0.3, 2.0, 180, 240), W: lerp(2.0, 0.3, 180, 240),
      };
      return { N: 2.0, S: 0.3, E: 2.0, W: 0.3 };
    }

    if (this.scenario === 'daily') {
      /* 10-минутный цикл с двумя пиками:
       *  0–60 с:   все 0.3 (ночь/раннее утро)
       *  60–150 с: нарастание утреннего пика Юг+Запад → 2.5
       *  150–210 с: пик Ю+З = 2.5
       *  210–300 с: спад Ю+З → 0.5
       *  300–360 с: равномерный трафик 0.5
       *  360–450 с: нарастание вечернего пика Север+Восток → 2.5
       *  450–510 с: пик С+В = 2.5
       *  510–600 с: спад С+В → 0.3
       */
      let S, W, N, E;
      if (now < 60)        S = W = 0.3;
      else if (now < 150)  S = W = lerp(0.3, 2.5, 60, 150);
      else if (now < 210)  S = W = 2.5;
      else if (now < 300)  S = W = lerp(2.5, 0.5, 210, 300);
      else                 S = W = 0.5;

      if (now < 360)       N = E = 0.3;
      else if (now < 450)  N = E = lerp(0.3, 2.5, 360, 450);
      else if (now < 510)  N = E = 2.5;
      else                 N = E = lerp(2.5, 0.3, 510, 600);

      return { N, S, E, W };
    }

    return { N: 0.5, S: 0.5, E: 0.5, W: 0.5 };
  }

  addManual(count) {
    for (let i = 0; i < count; i++) {
      const d   = DIRS[Math.floor(Math.random() * 4)];
      const car = this.ix.addCar(d);
      this.logger.log('AUTO',
        `Авто #${car.id} добавлено вручную (${DIR_NAME[d]}, ${TURN_NAME[car.turnDir]})`,
        this.ix.simTime);
    }
  }

  reset() {
    this._randTimer      = 0;
    this._lambdaLog      = [];
    this._lambdaLogTimer = 0;
    for (const c of CROSSINGS) this._pedAcc[c] = 0;
  }

  getLambdaInfo() {
    return DIRS.map(d => `${DIR_NAME[d]}: λ=${this.lambda[d].toFixed(1)}`).join(' | ');
  }
}
