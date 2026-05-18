/**
 * stats.js — статистика, история фаз, canvas-графики
 */
'use strict';

const DIR_COLOR      = { N: '#4CAF50', S: '#F44336', E: '#2196F3', W: '#FF9800' };
const ADAPTIVE_COLOR = '#2196F3';
const FIXED_COLOR    = '#FF9800';

class Stats {
  constructor() {
    this.phaseHistory = [];
    this.waitSeries   = [];
    this.cmp = { adaptive: null, fixed: null };
    this._cWait = null; this._cQueues = null; this._cTP = null;
    this.skippedLeftPhases = 0;
    this.leftWaitAll  = [];
    this.mainWaitAll  = [];
    this.maxWaitEver  = 0;   // этап 2
  }

  init() {
    this._cWait   = document.getElementById('chartWait');
    this._cQueues = document.getElementById('chartQueues');
    this._cTP     = document.getElementById('chartTP');
    document.getElementById('btnExportCSV').addEventListener('click', () => this.exportCSV());
  }

  /* ------------------------------------------------------------------ */
  addPhaseRecord(rec) {
    this.phaseHistory.push(rec);
    this.waitSeries.push({ phase: rec.num, wait: rec.avgWait, mode: rec.mode });
    if (this.waitSeries.length > 200) this.waitSeries.shift();

    if (rec.lane === 'left') {
      this.leftWaitAll.push(...rec.waitTimes);
    } else {
      this.mainWaitAll.push(...rec.waitTimes);
    }
    const m = rec.mode === 'adaptive' ? 'adaptive' : rec.mode === 'fixed' ? 'fixed' : null;
    if (m) {
      if (!this.cmp[m]) this.cmp[m] = { totalWait: 0, totalServed: 0, totalDuration: 0, count: 0 };
      const d = this.cmp[m];
      d.totalWait     += rec.avgWait * rec.served;
      d.totalServed   += rec.served;
      d.totalDuration += rec.duration;
      d.count++;
    }
    this._renderPhaseRow(rec);
    this._drawWaitChart();
    this._drawTPChart();
    this._updateComparison();
  }

  /* ------------------------------------------------------------------ */
  updateDOM(ix) {
    const phases    = this.phaseHistory.length;
    const totalServ = ix.totalServiced;
    const avgWait   = ix.getAvgWait();
    const avgQ      = ix.getAvgQueueLength();
    const elapsed   = ix.simTime;
    const throughput = elapsed > 0 ? (totalServ / elapsed) * 60 : 0;
    const avgGreen   = phases > 0
      ? this.phaseHistory.reduce((s, p) => s + p.duration, 0) / phases : 0;

    _set('stTotal',    totalServ);
    _set('stAvgWait',  avgWait.toFixed(1) + ' с');
    _set('stAvgQueue', avgQ.toFixed(1));
    _set('stAvgGreen', avgGreen.toFixed(1) + ' с');
    _set('stPhases',   phases);
    _set('stTP',       throughput.toFixed(1));

    /* По типу поворота */
    _set('stStraight', ix.servedByTurn.straight);
    _set('stLeft',     ix.servedByTurn.left);
    _set('stRight',    ix.servedByTurn.right);

    /* Левые повороты: детали */
    const avgLW = this.leftWaitAll.length
      ? (this.leftWaitAll.reduce((a, b) => a + b, 0) / this.leftWaitAll.length).toFixed(1) + ' с'
      : '— с';
    const avgMW = this.mainWaitAll.length
      ? (this.mainWaitAll.reduce((a, b) => a + b, 0) / this.mainWaitAll.length).toFixed(1) + ' с'
      : '— с';
    _set('stLeftServed',   ix.servedByTurn.left);
    _set('stLeftAvgWait',  avgLW);
    _set('stMainAvgWait',  avgMW);
    _set('stSkippedLeft',  this.skippedLeftPhases);

    /* Этап 2: максимальное ожидание */
    const maxWait = ix.getMaxWaitTime ? ix.getMaxWaitTime() : 0;
    if (maxWait > this.maxWaitEver) this.maxWaitEver = maxWait;
    _set('mMaxWait',  maxWait.toFixed(0) + ' с');
    _set('stMaxWait', this.maxWaitEver.toFixed(0) + ' с');

    /* Пешеходы */
    _set('stPedServed', ix.pedServed);
    _set('stPedDelays', ix.pedDelays);

    /* По направлениям */
    for (const d of DIRS) {
      _set(`ds${d}`, ix.serviced[d]);
      _set(`dw${d}`, ix.getDirAvgWait(d).toFixed(1) + ' с');
    }
  }

  /* ------------------------------------------------------------------ */
  _drawWaitChart() {
    const canvas = this._cWait;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    if (this.waitSeries.length < 2) { _drawEmpty(ctx, W, H, 'Нет данных'); return; }

    const pad = { t: 20, r: 20, b: 30, l: 44 };
    const gW  = W - pad.l - pad.r;
    const gH  = H - pad.t - pad.b;
    const maxW = Math.max(1, ...this.waitSeries.map(d => d.wait));
    const maxN = this.waitSeries[this.waitSeries.length - 1].phase;

    _drawGrid(ctx, pad, gW, gH, maxW, 5, 'с');
    for (const [mode, color] of [['adaptive', ADAPTIVE_COLOR], ['fixed', FIXED_COLOR]]) {
      const pts = this.waitSeries.filter(d => d.mode === mode);
      if (pts.length < 2) continue;
      ctx.strokeStyle = color; ctx.lineWidth = 2;
      ctx.beginPath();
      pts.forEach((d, i) => {
        const x = pad.l + (d.phase / maxN) * gW;
        const y = pad.t + gH * (1 - d.wait / maxW);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
    _drawLegend(ctx, W - 130, pad.t, [
      { color: ADAPTIVE_COLOR, label: 'Адаптивный' },
      { color: FIXED_COLOR,    label: 'Фиксированный' },
    ]);
  }

  drawQueueChart(snapshots) {
    const canvas = this._cQueues;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    if (snapshots.length < 2) { _drawEmpty(ctx, W, H, 'Нет данных'); return; }

    const pad  = { t: 20, r: 90, b: 30, l: 40 };
    const gW   = W - pad.l - pad.r;
    const gH   = H - pad.t - pad.b;
    const maxQ = Math.max(1, ...snapshots.flatMap(s => DIRS.map(d => s[d])));
    const n    = snapshots.length;

    _drawGrid(ctx, pad, gW, gH, maxQ, 4, '');
    for (const dir of DIRS) {
      ctx.strokeStyle = DIR_COLOR[dir]; ctx.lineWidth = 2;
      ctx.beginPath();
      snapshots.forEach((s, i) => {
        const x = pad.l + (i / (n - 1)) * gW;
        const y = pad.t + gH * (1 - s[dir] / maxQ);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
    _drawLegend(ctx, W - 82, pad.t, DIRS.map(d => ({ color: DIR_COLOR[d], label: DIR_NAME[d] })));
  }

  _drawTPChart() {
    const canvas = this._cTP;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const nsP = this.phaseHistory.filter(p => p.axis === 'NS');
    const ewP = this.phaseHistory.filter(p => p.axis === 'EW');
    const nsSrv = nsP.reduce((s, p) => s + p.served, 0);
    const ewSrv = ewP.reduce((s, p) => s + p.served, 0);
    const nsDur = Math.max(1, nsP.reduce((s, p) => s + p.duration, 0));
    const ewDur = Math.max(1, ewP.reduce((s, p) => s + p.duration, 0));
    const nsTP  = (nsSrv / nsDur) * 60;
    const ewTP  = (ewSrv / ewDur) * 60;
    const maxV  = Math.max(nsTP, ewTP, 1);

    const pad = { t: 20, r: 20, b: 40, l: 44 };
    const gW  = W - pad.l - pad.r;
    const gH  = H - pad.t - pad.b;
    _drawGrid(ctx, pad, gW, gH, maxV, 4, '');

    const bw = gW / 5, gap = gW / 10;
    const drawBar = (label, value, xOff, color) => {
      const bh = (value / maxV) * gH;
      const x  = pad.l + xOff, y = pad.t + gH - bh;
      ctx.fillStyle = color; ctx.fillRect(x, y, bw, bh);
      ctx.fillStyle = '#444'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(label,           x + bw / 2, pad.t + gH + 18);
      ctx.fillText(value.toFixed(1), x + bw / 2, Math.max(y - 4, pad.t + 12));
    };
    drawBar('С — Ю', nsTP, gap,          '#4CAF50');
    drawBar('В — З', ewTP, gap * 2 + bw, '#2196F3');
    ctx.fillStyle = '#888'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('авт/мин', W / 2, H - 4);
  }

  /* ------------------------------------------------------------------ */
  _updateComparison() {
    const el = document.getElementById('comparisonBlock');
    if (!el) return;
    const a = this.cmp.adaptive, f = this.cmp.fixed;
    if (!a || !f) return;

    const aWait = a.totalServed > 0 ? a.totalWait / a.totalServed : 0;
    const fWait = f.totalServed > 0 ? f.totalWait / f.totalServed : 0;
    const aTP   = a.totalDuration > 0 ? (a.totalServed / a.totalDuration) * 60 : 0;
    const fTP   = f.totalDuration > 0 ? (f.totalServed / f.totalDuration) * 60 : 0;
    const eff   = fWait > 0 ? (fWait - aWait) / fWait * 100 : 0;
    const better = eff >= 0;

    el.innerHTML = `
      <div class="cmp-row adaptive">
        <strong>Адаптивный:</strong><br>
        ср. ожидание: <b>${aWait.toFixed(1)} с</b> &nbsp;|&nbsp;
        пропускная: <b>${aTP.toFixed(1)} авт/мин</b>
      </div>
      <div class="cmp-row fixed">
        <strong>Фиксированный:</strong><br>
        ср. ожидание: <b>${fWait.toFixed(1)} с</b> &nbsp;|&nbsp;
        пропускная: <b>${fTP.toFixed(1)} авт/мин</b>
      </div>
      <div class="cmp-result ${better ? 'better' : 'worse'}">
        Адаптивный ${better ? 'эффективнее' : 'уступает'} на ${Math.abs(eff).toFixed(1)}%
      </div>`;
  }

  /* ------------------------------------------------------------------ */
  _renderPhaseRow(rec) {
    const tbody = document.getElementById('phaseHistBody');
    if (!tbody) return;
    const axCls  = rec.axis === 'NS' ? 'axis-ns' : 'axis-ew';
    const axName = AXIS_NAME[rec.axis] + (rec.lane === 'left' ? ' ←' : '');
    const mode   = { adaptive: 'Адапт.', fixed: 'Фиксир.', webster: 'Вебстер' }[rec.mode] || rec.mode;
    const tr = document.createElement('tr');
    tr.innerHTML =
      `<td>${rec.num}</td>` +
      `<td class="${axCls}">${axName}</td>` +
      `<td>${mode}</td>` +
      `<td>${rec.duration.toFixed(1)}</td>` +
      `<td>${rec.served}</td>` +
      `<td>${rec.avgWait.toFixed(1)}</td>` +
      `<td>${rec.maxQueue}</td>`;
    tbody.appendChild(tr);
    const scroll = tbody.closest('.table-scroll');
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
  }

  /* ------------------------------------------------------------------ */
  exportCSV() {
    const BOM  = '\uFEFF';
    const head = ['#','Ось','Режим','Длит. (с)','Обслужено','Ср. ожид. (с)','Макс. очередь'];
    const rows = this.phaseHistory.map(p => [
      p.num, p.axis === 'NS' ? 'С-Ю' : 'В-З',
      p.mode, p.duration.toFixed(2), p.served,
      p.avgWait.toFixed(2), p.maxQueue,
    ]);
    const csv = BOM + [head, ...rows].map(r => r.join(';')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'),
      { href: url, download: `its_phases_${Date.now()}.csv` });
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  }

  /* Этап 4: график интенсивности трафика */
  drawIntensityChart(lambdaLog) {
    const canvas = document.getElementById('chartIntensity');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    if (!lambdaLog || lambdaLog.length < 2) { _drawEmpty(ctx, W, H, 'Нет данных'); return; }

    const pad  = { t: 20, r: 90, b: 30, l: 44 };
    const gW   = W - pad.l - pad.r;
    const gH   = H - pad.t - pad.b;
    const maxV = Math.max(1, ...lambdaLog.flatMap(s => DIRS.map(d => s[d] || 0)));
    const n    = lambdaLog.length;

    _drawGrid(ctx, pad, gW, gH, maxV, 4, '');
    for (const dir of DIRS) {
      ctx.strokeStyle = DIR_COLOR[dir]; ctx.lineWidth = 2;
      ctx.beginPath();
      lambdaLog.forEach((s, i) => {
        const x = pad.l + (i / (n - 1)) * gW;
        const y = pad.t + gH * (1 - (s[dir] || 0) / maxV);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
    _drawLegend(ctx, W - 82, pad.t, DIRS.map(d => ({ color: DIR_COLOR[d], label: DIR_NAME[d] })));
  }

  reset() {
    this.phaseHistory = []; this.waitSeries = [];
    this.cmp = { adaptive: null, fixed: null };
    this.skippedLeftPhases = 0;
    this.leftWaitAll = []; this.mainWaitAll = [];
    this.maxWaitEver = 0;
    const tbody = document.getElementById('phaseHistBody');
    if (tbody) tbody.innerHTML = '';
    const cmpEl = document.getElementById('comparisonBlock');
    if (cmpEl) cmpEl.innerHTML =
      '<p class="cmp-hint">Запустите симуляцию в адаптивном и фиксированном режимах для сравнения</p>';
    for (const id of ['chartWait', 'chartQueues', 'chartTP']) {
      const c = document.getElementById(id);
      if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height);
    }
  }
}

/* ---- Вспомогательные функции рисования ---- */
function _drawGrid(ctx, pad, gW, gH, maxVal, steps, unit) {
  ctx.fillStyle = '#f8f9fa'; ctx.fillRect(pad.l, pad.t, gW, gH);
  ctx.strokeStyle = '#dee2e6'; ctx.lineWidth = 1;
  ctx.fillStyle = '#888'; ctx.font = '11px sans-serif'; ctx.textAlign = 'right';
  for (let i = 0; i <= steps; i++) {
    const y = pad.t + gH * (1 - i / steps);
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + gW, y); ctx.stroke();
    ctx.fillText((maxVal * i / steps).toFixed(maxVal < 10 ? 1 : 0) + unit, pad.l - 4, y + 4);
  }
  ctx.strokeStyle = '#aaa';
  ctx.beginPath(); ctx.moveTo(pad.l, pad.t + gH); ctx.lineTo(pad.l + gW, pad.t + gH); ctx.stroke();
}

function _drawLegend(ctx, x, y, items) {
  ctx.font = '11px sans-serif'; ctx.textAlign = 'left';
  items.forEach((item, i) => {
    ctx.fillStyle = item.color; ctx.fillRect(x, y + i * 18, 10, 10);
    ctx.fillStyle = '#444'; ctx.fillText(item.label, x + 14, y + i * 18 + 9);
  });
}

function _drawEmpty(ctx, W, H, text) {
  ctx.fillStyle = '#f8f9fa'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#aaa'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(text, W / 2, H / 2 + 5);
}

function _set(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}
