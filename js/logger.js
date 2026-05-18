/**
 * logger.js — логирование событий и экспорт
 */
'use strict';

const LOG_TYPE = {
  PHASE:      { label: 'ФАЗА',          css: 'log-row-phase',  badge: 'b-phase' },
  AUTO:       { label: 'АВТО',          css: 'log-row-auto',   badge: 'b-auto'  },
  PEDESTRIAN: { label: 'ПЕШЕХОД',       css: 'log-row-ped',    badge: 'b-ped'   },
  SYSTEM:     { label: 'СИСТЕМА',       css: 'log-row-system', badge: 'b-sys'   },
  WARNING:    { label: 'ПРЕДУПРЕЖДЕНИЕ',css: 'log-row-warn',   badge: 'b-warn'  },
};

class Logger {
  constructor() {
    this.entries = [];
    this.counter = 0;
    this.filters = { PHASE: true, AUTO: true, PEDESTRIAN: true, SYSTEM: true, WARNING: true };
    this._tbody  = null;
    this._scroll = null;
  }

  init() {
    this._tbody  = document.getElementById('logBody');
    this._scroll = document.getElementById('logScroll');

    const bind = (id, key) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', e => { this.filters[key] = e.target.checked; this._applyFilters(); });
    };
    bind('fPhase', 'PHASE');
    bind('fAuto',  'AUTO');
    bind('fPed',   'PEDESTRIAN');
    bind('fSys',   'SYSTEM');
    bind('fWarn',  'WARNING');

    document.getElementById('btnClearLog').addEventListener('click',  () => this.clear());
    document.getElementById('btnExportLog').addEventListener('click', () => this.exportTxt());
  }

  log(type, message, simTime) {
    const entry = { id: ++this.counter, type, message, simTime: simTime || 0 };
    this.entries.push(entry);
    if (this.entries.length > 2000) this.entries.shift();
    this._renderRow(entry);
  }

  _renderRow(entry) {
    if (!this._tbody) return;
    const info = LOG_TYPE[entry.type] || LOG_TYPE.SYSTEM;
    if (!this.filters[entry.type]) return;

    const tr = document.createElement('tr');
    tr.className   = info.css;
    tr.dataset.type = entry.type;
    tr.innerHTML =
      `<td>${entry.id}</td>` +
      `<td><span class="badge ${info.badge}">${info.label}</span></td>` +
      `<td>${this._esc(entry.message)}</td>` +
      `<td>${this._fmtTime(entry.simTime)}</td>`;
    this._tbody.appendChild(tr);
    if (this._scroll) this._scroll.scrollTop = this._scroll.scrollHeight;
    if (this._tbody.rows.length > 800) this._tbody.deleteRow(0);
  }

  _applyFilters() {
    if (!this._tbody) return;
    Array.from(this._tbody.rows).forEach(tr => {
      tr.style.display = this.filters[tr.dataset.type] ? '' : 'none';
    });
  }

  _fmtTime(sec) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  _esc(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  clear() {
    this.entries = []; this.counter = 0;
    if (this._tbody) this._tbody.innerHTML = '';
  }

  exportTxt() {
    const lines = [
      'Журнал событий — Интеллектуальная транспортная система',
      '='.repeat(62), '',
    ];
    for (const e of this.entries) {
      const info = LOG_TYPE[e.type] || LOG_TYPE.SYSTEM;
      lines.push(`[${this._fmtTime(e.simTime)}]  [${info.label.padEnd(16)}]  ${e.message}`);
    }
    lines.push('', `Всего записей: ${this.entries.length}`);
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: `its_log_${Date.now()}.txt` });
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  }

  reset() {
    this.entries = []; this.counter = 0;
    if (this._tbody) this._tbody.innerHTML = '';
  }
}
