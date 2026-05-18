/**
 * ui.js — визуализация перекрёстка на Canvas + обновление DOM
 *
 * Геометрия 600×600, правостороннее движение, 2 полосы на направление:
 *   CX=CY=300, RW=80 (полуширина дороги)
 *
 * Полосы (левая = внутренняя, правая = внешняя):
 *   N: left x=280 (CX-20), right x=240 (CX-60)
 *   S: left x=320 (CX+20), right x=360 (CX+60)
 *   E: left y=280 (CY-20), right y=240 (CY-60)
 *   W: left y=320 (CY+20), right y=360 (CY+60)
 */
'use strict';

const CX = 300, CY = 300, RW = 80;
const CAR_SHORT = 13, CAR_LONG = 22, CAR_GAP = 24;

const CANVAS_COLORS = {
  background: '#dbe4ea',
  curb: '#c2ccd6',
  road: '#4b5563',
  marking: '#f9fafb',
  text: '#1f2933',
  muted: '#6b7280',
  car: '#2563eb',
  carAlt: '#64748b',
  queue: '#f59e0b',
  red: '#ef4444',
  yellow: '#f59e0b',
  green: '#22c55e',
  body: '#111827',
  queueAlt: '#fbbf24',
  carTeal: '#0f766e',
  carIndigo: '#4f46e5',
};

/* ---- Параметры подъездов по полосам ---- */
const APPROACH = {
  left: {   /* внутренняя — левые повороты + прямо */
    N: { lx: CX - 20, qy0: CY - RW - 42, stepX:  0,       stepY: -CAR_GAP },
    S: { lx: CX + 20, qy0: CY + RW + 42, stepX:  0,       stepY:  CAR_GAP },
    E: { ly: CY - 20, qx0: CX + RW + 42, stepX:  CAR_GAP, stepY:  0       },
    W: { ly: CY + 20, qx0: CX - RW - 42, stepX: -CAR_GAP, stepY:  0       },
  },
  right: {  /* внешняя — правые повороты + прямо */
    N: { lx: CX - 60, qy0: CY - RW - 42, stepX:  0,       stepY: -CAR_GAP },
    S: { lx: CX + 60, qy0: CY + RW + 42, stepX:  0,       stepY:  CAR_GAP },
    E: { ly: CY - 60, qx0: CX + RW + 42, stepX:  CAR_GAP, stepY:  0       },
    W: { ly: CY + 60, qx0: CX - RW - 42, stepX: -CAR_GAP, stepY:  0       },
  },
};

/* ---- Вектор выезда ---- */
const EXIT_VEC = {
  left: {
    N: { sx: CX - 20, sy: CY - RW, dx:  0, dy:  1 },
    S: { sx: CX + 20, sy: CY + RW, dx:  0, dy: -1 },
    E: { sx: CX + RW, sy: CY - 20, dx: -1, dy:  0 },
    W: { sx: CX - RW, sy: CY + 20, dx:  1, dy:  0 },
  },
  right: {
    N: { sx: CX - 60, sy: CY - RW, dx:  0, dy:  1 },
    S: { sx: CX + 60, sy: CY + RW, dx:  0, dy: -1 },
    E: { sx: CX + RW, sy: CY - 60, dx: -1, dy:  0 },
    W: { sx: CX - RW, sy: CY + 60, dx:  1, dy:  0 },
  },
};
const EXIT_DIST = 430;

const BEZIER_TURNS = {
  right: {
    N: { p0:[240,220], p3:[220,240], din:[0,1],  dout:[-1,0] },
    S: { p0:[360,380], p3:[380,360], din:[0,-1], dout:[1,0]  },
    E: { p0:[380,240], p3:[360,220], din:[-1,0], dout:[0,-1] },
    W: { p0:[220,360], p3:[240,380], din:[1,0],  dout:[0,1]  },
  },
  left: {
    N: { p0:[280,220], p3:[380,320], din:[0,1],  dout:[1,0]  },
    S: { p0:[320,380], p3:[220,280], din:[0,-1], dout:[-1,0] },
    E: { p0:[380,280], p3:[280,380], din:[-1,0], dout:[0,1]  },
    W: { p0:[220,320], p3:[320,220], din:[1,0],  dout:[0,-1] },
  },
};

/* ---- Светофоры: симметричное 4-угловое расположение
 *
 *  Корпуса вынесены в угловые зоны тротуара, чтобы не перекрывать
 *  проезжую часть, стоп-линии и пешеходные переходы.
 *
 *  Основной корпус TL = 18×56:
 *    левый столбец  x = CX-RW-44 = 176  (NW и SW)
 *    правый столбец x = CX+RW+26 = 406  (NE и SE)
 *    верхняя строка y = CY-RW-84 = 136  (NW и NE)
 *    нижняя строка  y = CY+RW+26 = 406  (SW и SE)
 *
 *  Оси (правостороннее): NW+SE = NS,  NE+SW = EW
 */
const TL_DEFS = [
  { x: CX - RW - 44, y: CY - RW - 84, axis: 'NS', leftModule: 'left'  },
  { x: CX + RW + 26, y: CY + RW + 26, axis: 'NS', leftModule: 'right' },
  { x: CX + RW + 26, y: CY - RW - 84, axis: 'EW', leftModule: 'right' },
  { x: CX - RW - 44, y: CY + RW + 26, axis: 'EW', leftModule: 'left'  },
];

/* ---- Пешеходные переходы: координаты для анимации ---- */
const PED_CROSS_PATH = {
  north: { x0: CX - RW + 6, y0: CY - RW - 10, x1: CX + RW - 6, y1: CY - RW - 10 },
  south: { x0: CX - RW + 6, y0: CY + RW + 11, x1: CX + RW - 6, y1: CY + RW + 11 },
  west:  { x0: CX - RW - 10, y0: CY - RW + 6, x1: CX - RW - 10, y1: CY + RW - 6 },
  east:  { x0: CX + RW + 11, y0: CY - RW + 6, x1: CX + RW + 11, y1: CY + RW - 6 },
};

const PED_WAIT_POS = {
  north: { x: CX - RW - 24, y: CY - RW - 14, dx: -6, dy: 0 },
  south: { x: CX + RW + 24, y: CY + RW + 14, dx: 6, dy: 0 },
  west:  { x: CX - RW - 24, y: CY + RW + 14, dx: -6, dy: 0 },
  east:  { x: CX + RW + 24, y: CY - RW - 14, dx: 6, dy: 0 },
};

/* ---- Цвет линзы ---- */
const TL_ON  = { red: CANVAS_COLORS.red, yellow: CANVAS_COLORS.yellow, green: CANVAS_COLORS.green };
const TL_OFF = '#263241';

/* ================================================================== */
class UI {
  constructor(intersection, algorithm) {
    this.ix   = intersection;
    this.algo = algorithm;
    this.canvas = document.getElementById('intersectionCanvas');
    this.ctx    = this.canvas.getContext('2d');
    this._raf    = null;
    this._lastTs = 0;
    this._exiting = [];
  }

  startRender() {
    if (this._raf) return;
    this._lastTs = performance.now();
    const loop = (ts) => {
      const dt = Math.min((ts - this._lastTs) / 1000, 0.1);
      this._lastTs = ts;
      this._updateExiting(dt);
      this._draw();
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  stopRender() {
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
  }

  launchExit(car) {
    const v  = EXIT_VEC[car.lane][car.dir];
    const h0 = { N: Math.PI / 2, S: -Math.PI / 2, E: Math.PI, W: 0 }[car.dir];
    this._exiting.push({
      car,
      traj:  this._buildTraj(car.dir, car.turnDir, v.sx, v.sy),
      dist:  0,
      x:     v.sx,
      y:     v.sy,
      angle: h0,
    });
  }

  _buildTraj(dir, turnDir, sx, sy) {
    const H = { N: Math.PI / 2, S: -Math.PI / 2, E: Math.PI, W: 0 };
    const h0 = H[dir];

    if (turnDir === 'straight') {
      return [{ type: 'line', x0: sx, y0: sy,
                dx: Math.cos(h0), dy: Math.sin(h0), len: Infinity }];
    }

    const bt = BEZIER_TURNS[turnDir][dir];
    const [p0x, p0y] = bt.p0;
    const [p3x, p3y] = bt.p3;
    const [dinx, diny]   = bt.din;
    const [doutx, douty] = bt.dout;
    const C = turnDir === 'right' ? 15 : 50;
    const p1 = [p0x + dinx * C, p0y + diny * C];
    const p2 = [p3x - doutx * C, p3y - douty * C];

    return [
      this._buildBezierSeg([p0x,p0y], p1, p2, [p3x,p3y], bt.din, bt.dout),
      { type: 'line', x0: p3x, y0: p3y, dx: doutx, dy: douty, len: Infinity },
    ];
  }

  _buildBezierSeg(p0, p1, p2, p3, din, dout) {
    const aStart = Math.atan2(din[1], din[0]);
    const aEnd   = Math.atan2(dout[1], dout[0]);
    let delta = aEnd - aStart;
    while (delta >  Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;

    const N = 64;
    const pts = [];
    let cumulLen = 0;
    let prev = p0;
    pts.push({ t: 0, x: p0[0], y: p0[1], cumulLen: 0 });
    for (let i = 1; i <= N; i++) {
      const t  = i / N;
      const mt = 1 - t;
      const x  = mt*mt*mt*p0[0] + 3*mt*mt*t*p1[0] + 3*mt*t*t*p2[0] + t*t*t*p3[0];
      const y  = mt*mt*mt*p0[1] + 3*mt*mt*t*p1[1] + 3*mt*t*t*p2[1] + t*t*t*p3[1];
      const dx = x - prev[0], dy = y - prev[1];
      cumulLen += Math.sqrt(dx*dx + dy*dy);
      pts.push({ t, x, y, cumulLen });
      prev = [x, y];
    }
    return { type: 'bezier', p0, p1, p2, p3, aStart, delta, len: cumulLen, pts };
  }

  _evalTraj(traj, dist) {
    let rem = dist;
    for (const seg of traj) {
      const segLen = seg.type === 'line' ? seg.len : seg.len;
      const isInf  = seg.type === 'line' && seg.len === Infinity;

      if (rem <= segLen || isInf) {
        if (seg.type === 'line') {
          return { x: seg.x0 + seg.dx * rem, y: seg.y0 + seg.dy * rem,
                   angle: Math.atan2(seg.dy, seg.dx) };
        }
        /* bezier: binary search in precomputed table */
        const pts = seg.pts;
        let lo = 0, hi = pts.length - 1;
        while (hi - lo > 1) {
          const mid = (lo + hi) >> 1;
          if (pts[mid].cumulLen < rem) lo = mid; else hi = mid;
        }
        const s0 = pts[lo], s1 = pts[hi];
        const frac = s1.cumulLen > s0.cumulLen
          ? (rem - s0.cumulLen) / (s1.cumulLen - s0.cumulLen) : 0;
        const t = s0.t + frac * (s1.t - s0.t);
        return {
          x: s0.x + frac * (s1.x - s0.x),
          y: s0.y + frac * (s1.y - s0.y),
          angle: seg.aStart + seg.delta * t,
        };
      }
      rem -= segLen;
    }
    const last = traj[traj.length - 1];
    return { x: last.x0 + last.dx * rem, y: last.y0 + last.dy * rem,
             angle: Math.atan2(last.dy, last.dx) };
  }

  _updateExiting(dt) {
    for (const e of this._exiting) {
      e.dist += dt * 200;
      const p = this._evalTraj(e.traj, e.dist);
      e.x = p.x; e.y = p.y; e.angle = p.angle;
    }
    this._exiting = this._exiting.filter(
      e => e.x > -60 && e.x < 660 && e.y > -60 && e.y < 660
    );
  }

  /* ================================================================== */
  /*  Главная отрисовка                                                   */
  /* ================================================================== */
  _draw() {
    const ctx = this.ctx, ix = this.ix;
    ctx.fillStyle = CANVAS_COLORS.background;
    ctx.fillRect(0, 0, 600, 600);

    this._drawGrass();
    this._drawRoads();
    this._drawMarkings();
    this._drawCrossings();
    this._drawStopLines();
    this._drawTrafficLights();
    this._drawPedSignals();
    this._drawQueues();
    this._drawExiting();
    this._drawPedestrians();
    this._drawDirectionLabels();
    if (ix.phaseState === 'off') this._drawNightOverlay();
  }

  /* ---- Газон ---- */
  _drawGrass() {
    const ctx = this.ctx, S = 600;
    ctx.fillStyle = CANVAS_COLORS.background;
    ctx.fillRect(0, 0, S, S);

    ctx.fillStyle = '#eef3f7';
    for (const [x, y, w, h] of [
      [0, 0, CX - RW, CY - RW],
      [CX + RW, 0, S - CX - RW, CY - RW],
      [0, CY + RW, CX - RW, S - CY - RW],
      [CX + RW, CY + RW, S - CX - RW, S - CY - RW],
    ]) ctx.fillRect(x, y, w, h);

    ctx.fillStyle = CANVAS_COLORS.curb;
    for (const [x, y, w, h] of [
      [CX - RW - 2, 0, 4, 600], [CX + RW - 2, 0, 4, 600],
      [0, CY - RW - 2, 600, 4], [0, CY + RW - 2, 600, 4],
    ]) ctx.fillRect(x, y, w, h);

    ctx.strokeStyle = 'rgba(107, 114, 128, 0.22)';
    ctx.lineWidth = 1;
    for (const [x, y, w, h] of [
      [16, 16, 188, 188],
      [396, 16, 188, 188],
      [16, 396, 188, 188],
      [396, 396, 188, 188],
    ]) ctx.strokeRect(x, y, w, h);

    this._drawInfrastructure();
  }

  /* ---- Нейтральная инфраструктура вне проезжей части ---- */
  _drawInfrastructure() {
    const ctx = this.ctx;
    ctx.save();

    this._drawParkingZone(426, 42, 126, 66);
    this._drawParkingZone(48, 448, 126, 66);
    this._drawServiceCabinet(500, 142, 'Датчик');
    this._drawServiceCabinet(84, 520, 'Шкаф');
    this._drawCameraPole(154, 88);
    this._drawCameraPole(462, 514);

    ctx.restore();
  }

  _drawParkingZone(x, y, w, h) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    this._roundRect(ctx, x, y, w, h, 6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(194,204,214,0.9)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.strokeStyle = 'rgba(107,114,128,0.28)';
    ctx.lineWidth = 1;
    for (let px = x + 18; px < x + w - 8; px += 22) {
      ctx.beginPath();
      ctx.moveTo(px, y + 8);
      ctx.lineTo(px - 10, y + h - 8);
      ctx.stroke();
    }
  }

  _drawServiceCabinet(x, y, label) {
    const ctx = this.ctx;
    ctx.fillStyle = '#ffffff';
    this._roundRect(ctx, x, y, 50, 24, 5);
    ctx.fill();
    ctx.strokeStyle = 'rgba(194,204,214,0.95)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = CANVAS_COLORS.muted;
    ctx.font = 'bold 8px system-ui, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + 25, y + 12);
  }

  _drawCameraPole(x, y) {
    const ctx = this.ctx;
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, y + 34);
    ctx.lineTo(x, y);
    ctx.lineTo(x + 20, y);
    ctx.stroke();
    ctx.fillStyle = '#64748b';
    this._roundRect(ctx, x + 18, y - 5, 18, 10, 3);
    ctx.fill();
    ctx.fillStyle = CANVAS_COLORS.body;
    ctx.fillRect(x + 31, y - 2, 4, 4);
  }

  /* ---- Дороги ---- */
  _drawRoads() {
    const ctx = this.ctx;
    ctx.fillStyle = CANVAS_COLORS.road;
    ctx.fillRect(CX - RW, 0, RW * 2, 600);
    ctx.fillRect(0, CY - RW, 600, RW * 2);
  }

  /* ---- Разметка ---- */
  _drawMarkings() {
    const ctx = this.ctx;

    /* Центральные пунктиры (между встречными потоками) */
    ctx.save();
    ctx.strokeStyle = 'rgba(249,250,251,0.55)';
    ctx.lineWidth = 2;
    ctx.setLineDash([16, 12]);
    for (const [x1, y1, x2, y2] of [
      [CX, 0, CX, CY - RW], [CX, CY + RW, CX, 600],
      [0, CY, CX - RW, CY], [CX + RW, CY, 600, CY],
    ]) {
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    ctx.restore();

    /* Пунктир между полосами одного направления (белый, тонкий) */
    ctx.save();
    ctx.strokeStyle = 'rgba(249,250,251,0.48)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([10, 10]);
    for (const [x1, y1, x2, y2] of [
      [CX - 40, 0,       CX - 40, CY - RW],   // N — юж. полоса (x=260)
      [CX + 40, 0,       CX + 40, CY - RW],   // N — сев. полоса (x=340)
      [CX - 40, CY + RW, CX - 40, 600],        // S — юж. полоса (x=260)
      [CX + 40, CY + RW, CX + 40, 600],        // S — сев. полоса (x=340)
      [0,       CY - 40, CX - RW, CY - 40],    // W — зап. полоса (y=260)
      [0,       CY + 40, CX - RW, CY + 40],    // W — вост. полоса (y=340)
      [CX + RW, CY - 40, 600,     CY - 40],    // E — зап. полоса (y=260)
      [CX + RW, CY + 40, 600,     CY + 40],    // E — вост. полоса (y=340)
    ]) {
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();

    /* Краевые белые полосы */
    ctx.save();
    ctx.strokeStyle = 'rgba(249,250,251,0.42)';
    ctx.lineWidth = 2;
    for (const [x1, y1, x2, y2] of [
      [CX - RW, 0,       CX - RW, CY - RW], [CX + RW, 0,       CX + RW, CY - RW],
      [CX - RW, CY + RW, CX - RW, 600],     [CX + RW, CY + RW, CX + RW, 600],
      [0,       CY - RW, CX - RW, CY - RW], [CX + RW, CY - RW, 600,     CY - RW],
      [0,       CY + RW, CX - RW, CY + RW], [CX + RW, CY + RW, 600,     CY + RW],
    ]) {
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    ctx.restore();

    /* Стрелки полос */
    this._drawLaneArrows();
  }

  /* ---- Стрелки на полосах (нарисованные, у стоп-линии) ---- */
  _drawLaneArrows() {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = 'rgba(249,250,251,0.88)';
    ctx.fillStyle   = 'rgba(249,250,251,0.88)';
    ctx.lineWidth   = 2;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';

    const S = 10;
    /* [x, y, heading, type]
     * heading: N=Math.PI  S=0  E=-Math.PI/2  W=Math.PI/2
     * type:  'sr'=прямо+направо  'lt'=налево
     * Позиция: перед стоп-линией, с отступом от пешеходного перехода */
    const defs = [
      [CX - 60, CY - RW - 46, Math.PI,       'sr'],  // N правая x=240
      [CX - 20, CY - RW - 46, Math.PI,       'lt'],  // N левая  x=280
      [CX + 20, CY + RW + 46, 0,             'lt'],  // S левая  x=320
      [CX + 60, CY + RW + 46, 0,             'sr'],  // S правая x=360
      [CX + RW + 46, CY - 60, -Math.PI / 2, 'sr'],  // E правая y=240
      [CX + RW + 46, CY - 20, -Math.PI / 2, 'lt'],  // E левая  y=280
      [CX - RW - 46, CY + 20,  Math.PI / 2, 'lt'],  // W левая  y=320
      [CX - RW - 46, CY + 60,  Math.PI / 2, 'sr'],  // W правая y=360
    ];
    for (const [x, y, h, type] of defs) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(h);
      if (type === 'sr') this._arrowSR(ctx, S);
      else               this._arrowLT(ctx, S);
      ctx.restore();
    }
    ctx.restore();
  }

  /* Прямо + направо */
  _arrowSR(ctx, S) {
    ctx.beginPath();
    ctx.moveTo(-4, S); ctx.lineTo(-4, -S + 4);
    ctx.stroke();
    this._arrowHead(ctx, -4, -S, 0, -1);

    ctx.beginPath();
    ctx.moveTo(3, S * 0.4);
    ctx.quadraticCurveTo(3, -S * 0.5, S * 0.9, -S * 0.5);
    ctx.stroke();
    this._arrowHead(ctx, S * 0.9, -S * 0.5, 1, 0);
  }

  /* Налево */
  _arrowLT(ctx, S) {
    ctx.beginPath();
    ctx.moveTo(2, S);
    ctx.quadraticCurveTo(2, -S * 0.4, -S * 0.9, -S * 0.4);
    ctx.stroke();
    this._arrowHead(ctx, -S * 0.9, -S * 0.4, -1, 0);
  }

  /* Наконечник стрелки в направлении (dx,dy) */
  _arrowHead(ctx, x, y, dx, dy) {
    const a = 3.5, px = -dy, py = dx;
    ctx.beginPath();
    ctx.moveTo(x + dx * a,                        y + dy * a);
    ctx.lineTo(x - dx * a * 0.5 + px * a * 0.8,  y - dy * a * 0.5 + py * a * 0.8);
    ctx.lineTo(x - dx * a * 0.5 - px * a * 0.8,  y - dy * a * 0.5 - py * a * 0.8);
    ctx.closePath();
    ctx.fill();
  }

  /* ---- Пешеходные переходы (зебра) ---- */
  _drawCrossings() {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(249,250,251,0.76)';
    const SW = 8, GAP = 6;
    /* Горизонтальные (северный и южный) */
    for (const y of [CY - RW - 14, CY + RW + 7]) {
      for (let i = 0; i < RW * 2 - 8; i += SW + GAP) {
        ctx.fillRect(CX - RW + 4 + i, y, Math.min(SW, RW * 2 - 8 - i), SW);
      }
    }
    /* Вертикальные (западный и восточный) */
    for (const x of [CX - RW - 14, CX + RW + 7]) {
      for (let i = 0; i < RW * 2 - 8; i += SW + GAP) {
        ctx.fillRect(x, CY - RW + 4 + i, SW, Math.min(SW, RW * 2 - 8 - i));
      }
    }
  }

  /* ---- Стоп-линии (на всю ширину подъезда) ---- */
  _drawStopLines() {
    const ctx = this.ctx;
    ctx.strokeStyle = CANVAS_COLORS.marking; ctx.lineWidth = 4;
    for (const [x1, y1, x2, y2] of [
      [CX - RW + 4, CY - RW - 24, CX,            CY - RW - 24], // N
      [CX,          CY + RW + 24, CX + RW - 4,   CY + RW + 24], // S
      [CX + RW + 24, CY - RW + 4, CX + RW + 24, CY],           // E
      [CX - RW - 24, CY,          CX - RW - 24, CY + RW - 4],  // W
    ]) {
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
  }

  /* ---- Светофоры ---- */
  _drawTrafficLights() {
    const ix = this.ix;
    for (const tl of TL_DEFS) {
      const isActive    = ix.currentAxis === tl.axis;
      const isLeftGreen = isActive && ix.phaseState === 'green' && ix.currentPhaseType === 'l';
      /* Во время фазы левого поворота основной корпус показывает красный */
      const state       = isActive ? (isLeftGreen ? 'red' : ix.phaseState) : 'red';
      const phaseType   = isActive ? ix.currentPhaseType : null;
      this._drawTL(this.ctx, tl.x, tl.y, state, phaseType, isLeftGreen, tl.leftModule);
    }
  }

  _drawTL(ctx, x, y, state, phaseType, isLeftGreen = false, leftModule = 'right') {
    const W = 18, H = 56, R = 5;
    ctx.fillStyle = CANVAS_COLORS.body;
    this._roundRect(ctx, x - 1, y - 2, W, H, 5); ctx.fill();
    ctx.strokeStyle = '#334155'; ctx.lineWidth = 1; ctx.stroke();

    const lenses = [
      { cy: y + 8,  name: 'red'    },
      { cy: y + 25, name: 'yellow' },
      { cy: y + 42, name: 'green'  },
    ];
    const cx_ = x - 1 + W / 2;

    for (const { cy, name } of lenses) {
      const isOn = state === name;
      if (isOn) {
        const grd = ctx.createRadialGradient(cx_, cy, 1, cx_, cy, R + 3);
        grd.addColorStop(0, TL_ON[name]);
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.arc(cx_, cy, R + 4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = isOn ? TL_ON[name] : TL_OFF;
      ctx.beginPath(); ctx.arc(cx_, cy, R, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 0.7; ctx.stroke();
    }

    /* Индикатор прямо+направо */
    if (state === 'green') {
      ctx.fillStyle = CANVAS_COLORS.marking;
      ctx.font = 'bold 8px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('↑→', cx_, y + H - 2);
    }

    /* Индикатор левого поворота — маленький боковой блок */
    const lW = 16, lH = 14;
    const lx = leftModule === 'left' ? x - lW - 5 : x + W + 4;
    const ly = y + H - lH - 3;
    const lCx = lx + lW / 2;
    ctx.fillStyle = isLeftGreen ? '#166534' : CANVAS_COLORS.body;
    this._roundRect(ctx, lx, ly, lW, lH, 3); ctx.fill();
    ctx.strokeStyle = '#334155'; ctx.lineWidth = 0.7; ctx.stroke();
    if (isLeftGreen) {
      const grd2 = ctx.createRadialGradient(lCx, ly + lH / 2, 1, lCx, ly + lH / 2, 7);
      grd2.addColorStop(0, TL_ON.green); grd2.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grd2;
      ctx.beginPath(); ctx.arc(lCx, ly + lH / 2, 9, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = isLeftGreen ? CANVAS_COLORS.green : '#64748b';
    ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('←', lCx, ly + lH - 2);
  }

  /* ---- Пешеходные сигналы ---- */
  _drawPedSignals() {
    const ctx = this.ctx;
    /* Сигналы в угловых островках тротуара, чуть внутрь от TL-боксов */
    const signals = {
      north: { x: CX - RW - 14, y: CY - RW - 22 },
      east:  { x: CX + RW + 14, y: CY - RW - 22 },
      south: { x: CX + RW + 14, y: CY + RW + 22 },
      west:  { x: CX - RW - 14, y: CY + RW + 22 },
    };
    for (const [crossing, pos] of Object.entries(signals)) {
      const green = this.ix.pedLights[crossing] === 'green';
      /* Фон-шайба */
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = CANVAS_COLORS.body;
      ctx.fill();
      /* Цветная точка */
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = green ? CANVAS_COLORS.green : CANVAS_COLORS.red;
      ctx.fill();
      if (green) {
        /* Свечение */
        const grd = ctx.createRadialGradient(pos.x, pos.y, 1, pos.x, pos.y, 8);
        grd.addColorStop(0, 'rgba(34,197,94,0.36)');
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.arc(pos.x, pos.y, 8, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  /* ---- Машины в очередях (2 полосы) ---- */
  _drawQueues() {
    const ctx = this.ctx;
    const maxVis = 9;

    for (const dir of DIRS) {
      for (const lane of ['left', 'right']) {
        const queue = this.ix.queues[dir][lane];
        const ap    = APPROACH[lane][dir];

        for (let i = 0; i < Math.min(queue.length, maxVis); i++) {
          let cx_, cy_;
          if (dir === 'N' || dir === 'S') {
            cx_ = ap.lx;
            cy_ = ap.qy0 + ap.stepY * i;
          } else {
            cx_ = ap.qx0 + ap.stepX * i;
            cy_ = ap.ly;
          }
          if (cx_ < -15 || cx_ > 615 || cy_ < -15 || cy_ > 615) continue;
          this._drawCar(ctx, cx_, cy_, this._queueCarColor(lane, queue[i]), dir);
        }

        if (queue.length > maxVis) {
          const ex = queue.length - maxVis;
          let tx, ty;
          if (dir === 'N') { tx = ap.lx; ty = ap.qy0 + ap.stepY * maxVis - 8; }
          else if (dir === 'S') { tx = ap.lx; ty = ap.qy0 + ap.stepY * maxVis + 8; }
          else if (dir === 'E') { tx = ap.qx0 + ap.stepX * maxVis + 8; ty = ap.ly; }
          else { tx = ap.qx0 + ap.stepX * maxVis - 8; ty = ap.ly; }
          ctx.fillStyle = CANVAS_COLORS.red;
          ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center';
          ctx.fillText(`+${ex}`, tx, ty);
        }
      }
    }
  }

  /* ---- Анимирующие машины (с поворотом) ---- */
  _drawExiting() {
    const ctx = this.ctx;
    for (const e of this._exiting) {
      const color = this._movingCarColor(e.car);
      this._drawCarAngled(ctx, e.x, e.y, color, e.angle);
    }
  }

  _queueCarColor(lane, car) {
    if (lane === 'left') return CANVAS_COLORS.queue;
    return car.id % 2 === 0 ? CANVAS_COLORS.queueAlt : '#fb923c';
  }

  _movingCarColor(car) {
    const palette = [CANVAS_COLORS.car, CANVAS_COLORS.carAlt, CANVAS_COLORS.carTeal, CANVAS_COLORS.carIndigo];
    return palette[car.id % palette.length];
  }

  /* ---- Машина повёрнутая по углу движения (angle=0 → нос вправо) ---- */
  _drawCarAngled(ctx, cx_, cy_, color, angle) {
    const L = CAR_LONG, W = CAR_SHORT;
    ctx.save();
    ctx.translate(cx_, cy_);
    ctx.rotate(angle);
    ctx.fillStyle = color;
    ctx.beginPath();
    this._roundRect(ctx, -L / 2, -W / 2, L, W, 3);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(1, -W / 2 + 2, L / 2 - 3, W - 4);  // лобовое стекло (нос +x)
    ctx.strokeStyle = 'rgba(15,23,42,0.45)'; ctx.lineWidth = 0.8; ctx.stroke();
    ctx.restore();
  }

  /* ---- Нарисовать машину в очереди ---- */
  _drawCar(ctx, cx_, cy_, color, dir) {
    const isVert = dir === 'N' || dir === 'S';
    const W = isVert ? CAR_SHORT : CAR_LONG;
    const H = isVert ? CAR_LONG  : CAR_SHORT;

    ctx.save();
    ctx.translate(cx_, cy_);
    ctx.fillStyle = color;
    ctx.beginPath();
    this._roundRect(ctx, -W / 2, -H / 2, W, H, 3);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    if (isVert) ctx.fillRect(-W / 2 + 2, -H / 2 + 3, W - 4, H / 2 - 4);
    else        ctx.fillRect(-W / 2 + 3, -H / 2 + 2, W / 2 - 4, H - 4);
    ctx.strokeStyle = 'rgba(15,23,42,0.45)'; ctx.lineWidth = 0.8; ctx.stroke();
    ctx.restore();
  }

  /* ---- Подписи направлений ---- */
  _drawDirectionLabels() {
    const ctx = this.ctx;
    const labels = [
      { text: 'Север',  x: 300, y: 28 },
      { text: 'Юг',    x: 300, y: 572 },
      { text: 'Запад', x: 38,  y: 304 },
      { text: 'Восток', x: 562, y: 304 },
    ];

    ctx.save();
    ctx.font = 'bold 12px system-ui, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const label of labels) {
      const w = ctx.measureText(label.text).width + 18;
      ctx.fillStyle = 'rgba(255,255,255,0.86)';
      this._roundRect(ctx, label.x - w / 2, label.y - 13, w, 26, 9);
      ctx.fill();
      ctx.strokeStyle = 'rgba(194,204,214,0.9)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = CANVAS_COLORS.muted;
      ctx.fillText(label.text, label.x, label.y + 0.5);
    }
    ctx.restore();
  }

  /* ---- Пешеходы ---- */
  _drawPedestrians() {
    const ctx = this.ctx;
    for (const ped of this.ix.pedestrians) {
      const path = PED_CROSS_PATH[ped.crossing];
      if (!path) continue;

      let px, py;
      if (ped.state === 'waiting') {
        const wait = PED_WAIT_POS[ped.crossing];
        const offset = ped.id % 6;
        px = wait.x + wait.dx * offset;
        py = wait.y + wait.dy * offset;
      } else {
        px = path.x0 + (path.x1 - path.x0) * ped.progress;
        py = path.y0 + (path.y1 - path.y0) * ped.progress;
      }

      const r = ped.state === 'waiting' ? 2.6 : 4;
      ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fillStyle = ped.state === 'waiting' ? CANVAS_COLORS.warning : CANVAS_COLORS.green;
      ctx.fill();
      ctx.strokeStyle = 'rgba(15,23,42,0.5)'; ctx.lineWidth = 0.5; ctx.stroke();
    }
  }

  /* ---- Ночной оверлей ---- */
  _drawNightOverlay() {
    this.ctx.fillStyle = 'rgba(15,23,42,0.24)';
    this.ctx.fillRect(0, 0, 600, 600);
  }

  /* ---- Вспомогательный roundRect ---- */
  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);  ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);  ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);      ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  /* ================================================================== */
  /*  DOM-метрики + phase-info-box                                        */
  /* ================================================================== */
  updateDOM(ix, algo, simTime) {
    const totalQ    = ix.getTotalQueue();
    const totalServ = ix.totalServiced;
    const avgWait   = ix.getAvgWait();
    const throughput = simTime > 0 ? (totalServ / simTime) * 60 : 0;

    _domSet('mTotal',      totalQ);
    _domSet('mServed',     totalServ);
    _domSet('mAvgWait',    avgWait.toFixed(1) + ' с');
    _domSet('mThroughput', throughput.toFixed(1));

    _domSet('dqN', ix.getDirQueueLen('N'));
    _domSet('dqS', ix.getDirQueueLen('S'));
    _domSet('dqE', ix.getDirQueueLen('E'));
    _domSet('dqW', ix.getDirQueueLen('W'));

    const m = Math.floor(simTime / 60);
    const s = Math.floor(simTime % 60).toString().padStart(2, '0');
    _domSet('simTimeDisplay', `${m}:${s}`);

    this._updatePhaseBox(ix, algo);
  }

  _updatePhaseBox(ix, algo) {
    const timerEl = document.getElementById('piTimer');
    const stateEl = document.getElementById('piState');
    const dirEl   = document.getElementById('piDirection');

    const state = ix.phaseState;
    const axis  = ix.currentAxis;

    const t = Math.ceil(ix.phaseTimer);
    timerEl.textContent = t > 0 ? String(t).padStart(2, '0') : '—';
    timerEl.className   = 'pi-timer ' + (state === 'green' ? 'green' : state === 'yellow' ? 'yellow' : 'red');

    const labels = { green: 'ЗЕЛЁНЫЙ', yellow: 'ЖЁЛТЫЙ', red: 'КРАСНЫЙ', off: 'МИГАЮЩИЙ' };
    stateEl.textContent = labels[state] || '—';
    stateEl.className   = 'pi-state ' + state;

    if (axis) {
      const type = ix.currentPhaseType;
      dirEl.textContent = AXIS_NAME[axis] + (type === 'l' ? ': левый поворот' : ': прямо + направо');
    } else {
      dirEl.textContent = algo.state === 'idle' ? 'Ожидание' : '—';
    }

    _domSet('piQN', ix.getDirQueueLen('N'));
    _domSet('piQS', ix.getDirQueueLen('S'));
    _domSet('piQE', ix.getDirQueueLen('E'));
    _domSet('piQW', ix.getDirQueueLen('W'));
  }

  reset() {
    this._exiting = [];
    this._draw();
  }
}

function _domSet(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}
