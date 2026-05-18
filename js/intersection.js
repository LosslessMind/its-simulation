/**
 * intersection.js — модель перекрёстка, 2-полосных очередей, машин и пешеходов
 */
'use strict';

/* Константы направлений */
const DIRS      = ['N', 'S', 'E', 'W'];
const DIR_NAME  = { N: 'Север', S: 'Юг', E: 'Восток', W: 'Запад' };
const AXIS_NAME = { NS: 'Север — Юг', EW: 'Восток — Запад' };
const TURN_NAME = { straight: 'Прямо', left: 'Лево', right: 'Право' };

/* Пешеходные переходы */
const CROSSINGS = ['north', 'south', 'east', 'west'];

/* Цветовая палитра автомобилей */
const CAR_COLORS = [
  '#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6',
  '#1abc9c','#e67e22','#e91e63','#00bcd4','#8bc34a',
  '#ff5722','#607d8b','#795548','#ff9800','#03a9f4',
];

let _carIdSeq = 0;
let _pedIdSeq = 0;

/* ------------------------------------------------------------------ */
/*  Car                                                                 */
/* ------------------------------------------------------------------ */
class Car {
  constructor(dir, arrivalTime, turnDir, lane) {
    this.id          = ++_carIdSeq;
    this.dir         = dir;
    this.arrivalTime = arrivalTime;
    this.waitTime    = 0;
    this.turnDir     = turnDir;  // 'straight' | 'left' | 'right'
    this.lane        = lane;     // 'left' (внутр.) | 'right' (внешн.)
    this.color       = CAR_COLORS[this.id % CAR_COLORS.length];

    /* Анимация выезда */
    this.exiting      = false;
    this.exitProgress = 0;
    this.exitX        = 0;
    this.exitY        = 0;
    this.exitDX       = 0;
    this.exitDY       = 0;
  }
}

/* ------------------------------------------------------------------ */
/*  Pedestrian                                                          */
/* ------------------------------------------------------------------ */
class Pedestrian {
  constructor(crossing, arrivalTime) {
    this.id           = ++_pedIdSeq;
    this.crossing     = crossing;   // 'north'|'south'|'east'|'west'
    this.arrivalTime  = arrivalTime;
    this.state        = 'waiting';  // 'waiting'|'crossing'|'done'
    this.progress     = 0;          // 0..1
    this.waitTime     = 0;
    this.crossDuration = 4 + Math.random();  // 4–5 с
  }
}

/* ------------------------------------------------------------------ */
/*  Intersection                                                        */
/* ------------------------------------------------------------------ */
class Intersection {
  constructor() {
    /* Очереди — два объекта на каждое направление (left/right полосы) */
    this.queues = {
      N: { left: [], right: [] },
      S: { left: [], right: [] },
      E: { left: [], right: [] },
      W: { left: [], right: [] },
    };

    /* Состояние фазы (для рендера) */
    this.currentAxis      = null;   // 'NS' | 'EW' | null
    this.currentPhaseType = null;   // 'sr' | 'l' | null
    this.phaseState       = 'red';  // 'green'|'yellow'|'red'|'off'
    this.phaseTimer       = 0;
    this.phaseDuration    = 0;

    /* Пешеходные светофоры */
    this.pedLights = { north: 'red', south: 'red', east: 'red', west: 'red' };

    /* Активные пешеходы */
    this.pedestrians = [];

    /* Симуляционное время */
    this.simTime = 0;

    /* Глобальная статистика */
    this.totalServiced = 0;
    this.serviced      = { N: 0, S: 0, E: 0, W: 0 };
    this.servedByTurn  = { straight: 0, left: 0, right: 0 };
    this.waitLog       = [];
    this.dirWaitLog    = { N: [], S: [], E: [], W: [] };
    this.pedServed     = 0;
    this.pedDelays     = 0;

    /* Автомобили на анимации выезда */
    this.exitingCars = [];

    /* История длин очередей */
    this.queueSnapshots = [];
    this._lastSnap      = 0;
    this._queueSum      = 0;
    this._queueCount    = 0;

    /* Счётчики прибытий для формулы Вебстера (этап 3) */
    this._arrivalEpoch = 0;
    this._arrivalCounts = { cur: {}, prev: {} };
    for (const d of DIRS) {
      this._arrivalCounts.cur[d]  = { left: 0, right: 0 };
      this._arrivalCounts.prev[d] = { left: 0, right: 0 };
    }
  }

  /* ---- Добавить автомобиль ---- */
  addCar(dir) {
    /* Распределение: 20% лево, 50% прямо (50/50 по полосам), 30% право */
    const rnd = Math.random();
    let turnDir, lane;
    if (rnd < 0.20) {
      turnDir = 'left';     lane = 'left';
    } else if (rnd < 0.70) {
      turnDir = 'straight'; lane = 'right';  // прямо — только правая полоса
    } else {
      turnDir = 'right';    lane = 'right';
    }
    const car = new Car(dir, this.simTime, turnDir, lane);
    this.queues[dir][lane].push(car);
    this._arrivalCounts.cur[dir][lane]++;
    return car;
  }

  /* ---- Добавить пешехода ---- */
  addPedestrian(crossing) {
    const ped = new Pedestrian(crossing, this.simTime);
    this.pedestrians.push(ped);
    return ped;
  }

  /* ---- Обслужить машины по оси и типу полосы ---- */
  serviceCars(axis, laneType) {
    const dirs  = axis === 'NS' ? ['N', 'S'] : ['E', 'W'];
    const served = [];
    for (const dir of dirs) {
      const q = this.queues[dir][laneType];
      if (q.length === 0) continue;
      const car = q.shift();
      car.waitTime = this.simTime - car.arrivalTime;
      this.waitLog.push(car.waitTime);
      this.dirWaitLog[dir].push(car.waitTime);
      this.serviced[dir]++;
      this.totalServiced++;
      this.servedByTurn[car.turnDir]++;
      this._launchExitAnim(car, laneType);
      served.push(car);
    }
    return served;
  }

  /* ---- Запустить анимацию выезда ---- */
  _launchExitAnim(car, laneType) {
    const C = 300, R = 80;
    /* left=внутренняя полоса (±20 от оси), right=внешняя (±60) */
    const vecs = {
      N: {
        left:  { sx: C - 20, sy: C - R, dx:  0, dy:  1 },
        right: { sx: C - 60, sy: C - R, dx:  0, dy:  1 },
      },
      S: {
        left:  { sx: C + 20, sy: C + R, dx:  0, dy: -1 },
        right: { sx: C + 60, sy: C + R, dx:  0, dy: -1 },
      },
      E: {
        left:  { sx: C + R, sy: C - 20, dx: -1, dy:  0 },
        right: { sx: C + R, sy: C - 60, dx: -1, dy:  0 },
      },
      W: {
        left:  { sx: C - R, sy: C + 20, dx:  1, dy:  0 },
        right: { sx: C - R, sy: C + 60, dx:  1, dy:  0 },
      },
    };
    const v = vecs[car.dir][laneType];
    car.exiting      = true;
    car.exitProgress = 0;
    car.exitX        = v.sx;
    car.exitY        = v.sy;
    car.exitDX       = v.dx;
    car.exitDY       = v.dy;
    this.exitingCars.push(car);
  }

  /* ---- Тик симуляции ---- */
  tick(dt) {
    this.simTime += dt;

    /* Ротация окна прибытий каждые 30 с (для Вебстера) */
    const epoch = Math.floor(this.simTime / 30);
    if (epoch > this._arrivalEpoch) {
      this._arrivalEpoch = epoch;
      for (const d of DIRS) {
        this._arrivalCounts.prev[d] = { ...this._arrivalCounts.cur[d] };
        this._arrivalCounts.cur[d]  = { left: 0, right: 0 };
      }
    }

    /* Обновить время ожидания стоящих машин */
    for (const dir of DIRS) {
      for (const lane of ['left', 'right']) {
        for (const car of this.queues[dir][lane]) {
          car.waitTime = this.simTime - car.arrivalTime;
        }
      }
    }

    /* Тик пешеходов */
    for (const ped of this.pedestrians) {
      if (ped.state === 'waiting') {
        ped.waitTime = this.simTime - ped.arrivalTime;
        if (this.pedLights[ped.crossing] === 'green') {
          ped.state = 'crossing';
        }
      } else if (ped.state === 'crossing') {
        ped.progress += dt / ped.crossDuration;
        if (ped.progress >= 1) {
          ped.progress = 1;
          ped.state    = 'done';
          this.pedServed++;
        }
      }
    }
    this.pedestrians = this.pedestrians.filter(p => p.state !== 'done');

    /* Снимок очереди каждые 5 с */
    if (this.simTime - this._lastSnap >= 5) {
      this.queueSnapshots.push({
        t: this.simTime,
        N: this.getDirQueueLen('N'),
        S: this.getDirQueueLen('S'),
        E: this.getDirQueueLen('E'),
        W: this.getDirQueueLen('W'),
      });
      if (this.queueSnapshots.length > 120) this.queueSnapshots.shift();
      this._lastSnap    = this.simTime;
      this._queueSum   += this.getTotalQueue();
      this._queueCount += 1;
    }
  }

  /* ---- Геттеры ---- */

  getDirQueueLen(dir) {
    return this.queues[dir].left.length + this.queues[dir].right.length;
  }

  getAxisQueue(axis) {
    const dirs = axis === 'NS' ? ['N', 'S'] : ['E', 'W'];
    return dirs.reduce((s, d) => s + this.getDirQueueLen(d), 0);
  }

  getAxisLaneQueue(axis, lane) {
    const dirs = axis === 'NS' ? ['N', 'S'] : ['E', 'W'];
    return dirs.reduce((s, d) => s + this.queues[d][lane].length, 0);
  }

  getTotalQueue() {
    return DIRS.reduce((s, d) => s + this.getDirQueueLen(d), 0);
  }

  getAvgWait() {
    if (!this.waitLog.length) return 0;
    return this.waitLog.reduce((a, b) => a + b, 0) / this.waitLog.length;
  }

  getDirAvgWait(dir) {
    const wl = this.dirWaitLog[dir];
    if (!wl.length) return 0;
    return wl.reduce((a, b) => a + b, 0) / wl.length;
  }

  getAvgQueueLength() {
    return this._queueCount ? this._queueSum / this._queueCount : 0;
  }

  /* Этап 2: максимальное текущее время ожидания среди всех стоящих машин */
  getMaxWaitTime() {
    let max = 0;
    for (const dir of DIRS) {
      for (const lane of ['left', 'right']) {
        for (const car of this.queues[dir][lane]) {
          if (car.waitTime > max) max = car.waitTime;
        }
      }
    }
    return max;
  }

  /* Этап 3: средняя скорость прибытия (авт/с) за последние ~60 с */
  getArrivalRate(dir, lane) {
    const total = this._arrivalCounts.cur[dir][lane] + this._arrivalCounts.prev[dir][lane];
    return total / 60;
  }

  /* ---- Сброс ---- */
  reset() {
    _carIdSeq = 0;
    _pedIdSeq = 0;
    this.queues = {
      N: { left: [], right: [] }, S: { left: [], right: [] },
      E: { left: [], right: [] }, W: { left: [], right: [] },
    };
    this.currentAxis      = null;
    this.currentPhaseType = null;
    this.phaseState       = 'red';
    this.phaseTimer       = 0;
    this.phaseDuration    = 0;
    this.pedLights        = { north: 'red', south: 'red', east: 'red', west: 'red' };
    this.pedestrians      = [];
    this.simTime          = 0;
    this.totalServiced    = 0;
    this.serviced         = { N: 0, S: 0, E: 0, W: 0 };
    this.servedByTurn     = { straight: 0, left: 0, right: 0 };
    this.waitLog          = [];
    this.dirWaitLog       = { N: [], S: [], E: [], W: [] };
    this.pedServed        = 0;
    this.pedDelays        = 0;
    this.exitingCars      = [];
    this.queueSnapshots   = [];
    this._lastSnap        = 0;
    this._queueSum        = 0;
    this._queueCount      = 0;
    this._arrivalEpoch    = 0;
    this._arrivalCounts   = { cur: {}, prev: {} };
    for (const d of DIRS) {
      this._arrivalCounts.cur[d]  = { left: 0, right: 0 };
      this._arrivalCounts.prev[d] = { left: 0, right: 0 };
    }
  }
}
