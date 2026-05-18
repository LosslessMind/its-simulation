/**
 * app.js — точка входа, инициализация и главный цикл симуляции
 */
'use strict';

let logger, intersection, traffic, algorithm, stats, ui;

let simRunning  = false;
let simPaused   = false;
let simSpeed    = 1.0;
let currentMode = 'adaptive';

const SIM_DT = 1.0;
let _simInterval  = null;
let _chartInterval = null;

/* ================================================================== */
/*  Инициализация                                                       */
/* ================================================================== */
document.addEventListener('DOMContentLoaded', () => {
  logger       = new Logger();
  intersection = new Intersection();
  traffic      = new TrafficGenerator(intersection, logger);
  stats        = new Stats();
  algorithm    = new Algorithm(intersection, logger, stats);
  ui           = new UI(intersection, algorithm);

  logger.init();
  stats.init();
  ui.startRender();
  _setupListeners();
  _updateHeaderStatus('Ожидание');

  logger.log('SYSTEM', 'Система инициализирована. Выберите режим и нажмите СТАРТ.', 0);
  logger.log('SYSTEM', 'Адаптивный алгоритм: 4 фазы (ПРЯМО+НАПРАВО / ЛЕВЫЙ ПОВОРОТ × 2 оси)', 0);
});

/* ================================================================== */
/*  Управление симуляцией                                              */
/* ================================================================== */
function startSim() {
  if (simRunning) return;
  simRunning = true;
  simPaused  = false;

  algorithm.setMode(currentMode);
  traffic.setScenario(document.getElementById('scenarioSelect').value);

  _btn('btnStart').disabled = true;
  _btn('btnPause').disabled = false;
  _btn('btnStop').disabled  = false;
  _updateHeaderStatus('Работает');

  logger.log('SYSTEM',
    `Симуляция запущена. Режим: ${_modeLabel(currentMode)}, ` +
    `сценарий: ${_scenarioLabel()}, скорость: ×${simSpeed}`,
    intersection.simTime);

  _startInterval();

  _chartInterval = setInterval(() => {
    if (!simPaused) {
      stats.drawQueueChart(intersection.queueSnapshots);
      const activePane = document.querySelector('.tab-pane.active');
      if (activePane && activePane.id === 'tab-charts') {
        stats.drawIntensityChart(traffic._lambdaLog);
      }
    }
  }, 2000);
}

function pauseSim() {
  if (!simRunning) return;
  simPaused = !simPaused;
  const btn = _btn('btnPause');
  btn.textContent = simPaused ? 'Продолжить' : 'Пауза';
  document.getElementById('pauseOverlay').style.display = simPaused ? 'flex' : 'none';
  _updateHeaderStatus(simPaused ? 'Пауза' : 'Работает');
  logger.log('SYSTEM',
    simPaused ? 'Симуляция приостановлена' : 'Симуляция возобновлена',
    intersection.simTime);
}

function stopSim() {
  if (!simRunning) return;
  simRunning = false;
  simPaused  = false;

  _stopInterval();
  clearInterval(_chartInterval);
  _chartInterval = null;

  document.getElementById('pauseOverlay').style.display = 'none';
  _btn('btnStart').disabled = false;
  _btn('btnPause').disabled = true;
  _btn('btnStop').disabled  = true;
  _btn('btnPause').textContent = 'Пауза';
  _updateHeaderStatus('Остановлена');

  logger.log('SYSTEM',
    `Симуляция остановлена. Обслужено: ${intersection.totalServiced} авт., ` +
    `ср. ожидание: ${intersection.getAvgWait().toFixed(1)} с`,
    intersection.simTime);

  stats.updateDOM(intersection);
  stats.drawQueueChart(intersection.queueSnapshots);
}

function resetSim() {
  stopSim();
  intersection.reset();
  algorithm.reset();
  traffic.reset();
  stats.reset();
  logger.reset();
  logger.log('SYSTEM', 'Симуляция сброшена.', 0);
  ui.reset();
  ui.updateDOM(intersection, algorithm, 0);

  document.getElementById('piDirection').textContent = '—';
  document.getElementById('piTimer').textContent     = '—';
  document.getElementById('piState').textContent     = 'Ожидание';
  _updateHeaderStatus('Ожидание');
}

/* ================================================================== */
/*  Тик симуляции                                                      */
/* ================================================================== */
function _simTick() {
  if (!simRunning || simPaused) return;

  traffic.tick(SIM_DT);
  algorithm.tick(SIM_DT);
  intersection.tick(SIM_DT);

  _launchPendingExits();

  ui.updateDOM(intersection, algorithm, intersection.simTime);
  stats.updateDOM(intersection);

  const totalQ = intersection.getTotalQueue();
  if (totalQ > 80) {
    logger.log('WARNING',
      `Очереди переполнены: ${totalQ} авто суммарно`,
      intersection.simTime);
  }
}

function _launchPendingExits() {
  for (const car of intersection.exitingCars) {
    if (!car._uiLaunched) {
      ui.launchExit(car);
      car._uiLaunched = true;
    }
  }
  intersection.exitingCars = intersection.exitingCars.filter(c => !c._uiLaunched);
}

/* ================================================================== */
/*  Интервал                                                            */
/* ================================================================== */
function _startInterval() {
  _stopInterval();
  _simInterval = setInterval(_simTick, (SIM_DT / simSpeed) * 1000);
}

function _stopInterval() {
  if (_simInterval) { clearInterval(_simInterval); _simInterval = null; }
}

/* ================================================================== */
/*  Обработчики событий                                                 */
/* ================================================================== */
function _setupListeners() {
  _btn('btnStart').addEventListener('click', startSim);
  _btn('btnPause').addEventListener('click', pauseSim);
  _btn('btnReset').addEventListener('click', resetSim);
  _btn('btnStop').addEventListener('click', () => {
    if (!simRunning) { resetSim(); return; }
    stopSim();
  });

  document.querySelectorAll('input[name="mode"]').forEach(radio => {
    radio.addEventListener('change', e => {
      currentMode = e.target.value;
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      document.getElementById(`modeBtn-${currentMode}`).classList.add('active');
      document.getElementById('manualControls').style.display =
        (currentMode === 'manual') ? 'block' : 'none';
      _updateHeaderStatus(simRunning ? (simPaused ? 'Пауза' : 'Работает') : 'Ожидание');
      if (simRunning) {
        algorithm.setMode(currentMode);
        logger.log('SYSTEM', `Режим изменён: ${_modeLabel(currentMode)}`, intersection.simTime);
      }
    });
  });

  _btn('btnNS').addEventListener('click', () => {
    if (simRunning && !simPaused) algorithm.requestAxis('NS');
  });
  _btn('btnEW').addEventListener('click', () => {
    if (simRunning && !simPaused) algorithm.requestAxis('EW');
  });

  const speedSlider = document.getElementById('speedSlider');
  speedSlider.addEventListener('input', () => {
    simSpeed = parseFloat(speedSlider.value);
    document.getElementById('speedVal').textContent = `×${simSpeed.toFixed(1)}`;
    if (simRunning && !simPaused) _startInterval();
  });

  document.getElementById('scenarioSelect').addEventListener('change', e => {
    _updateHeaderStatus(simRunning ? (simPaused ? 'Пауза' : 'Работает') : 'Ожидание');
    if (simRunning) {
      traffic.setScenario(e.target.value);
      logger.log('SYSTEM', `Сценарий изменён: ${_scenarioLabel()}`, intersection.simTime);
    }
  });

  _btn('btnAddFew').addEventListener('click', () => {
    traffic.addManual(1 + Math.floor(Math.random() * 3));
  });
  _btn('btnAddMany').addEventListener('click', () => {
    traffic.addManual(5 + Math.floor(Math.random() * 6));
  });

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b  => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${tab}`).classList.add('active');
      if (tab === 'charts') {
        stats._drawWaitChart();
        stats.drawQueueChart(intersection.queueSnapshots);
        stats._drawTPChart();
        stats._updateComparison();
        stats.drawIntensityChart(traffic._lambdaLog);
      }
    });
  });

  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.code === 'Space') { e.preventDefault(); simRunning ? pauseSim() : startSim(); }
    if (e.code === 'KeyR') resetSim();
  });
}

/* ================================================================== */
/*  Утилиты                                                             */
/* ================================================================== */
function _btn(id) { return document.getElementById(id); }

function _modeLabel(mode) {
  return { adaptive: 'Адаптивный', fixed: 'Фиксированный',
           manual: 'Ручной', night: 'Ночной', pedestrian: 'Пешеходный',
           webster: 'Вебстер' }[mode] || mode;
}

function _scenarioLabel() {
  const sel = document.getElementById('scenarioSelect');
  return sel ? sel.options[sel.selectedIndex].text : '';
}

function _updateHeaderStatus(statusText) {
  const modeEl = document.getElementById('headerModeStatus');
  const scenarioEl = document.getElementById('headerScenarioStatus');
  const statusEl = document.getElementById('headerRunStatus');
  if (modeEl) modeEl.textContent = _modeLabel(currentMode);
  if (scenarioEl) scenarioEl.textContent = _scenarioLabel();
  if (statusEl) statusEl.textContent = statusText;
}
