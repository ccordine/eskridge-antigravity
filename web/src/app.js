const Recyclr = require('recyclrjs');

const state = {
  scenarios: [],
  stream: null,
  charts: null,
  labRoot: null,
  refs: null,
  mounted: false,
  streamVersion: 0,
  exporting: false
};

class LineChart {
  constructor(canvas, color) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.color = color;
    this.points = [];
    this.maxPoints = 2400;
    this.resize();
  }

  reset() {
    this.points = [];
  }

  push(t, v) {
    this.points.push({ t, v });
    if (this.points.length > this.maxPoints) {
      this.points.shift();
    }
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(20, this.canvas.clientWidth);
    const h = Math.max(20, this.canvas.clientHeight);
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  draw() {
    const ctx = this.ctx;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(31, 42, 55, 0.14)';
    ctx.lineWidth = 1;
    for (let i = 1; i <= 3; i += 1) {
      const y = (h / 4) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    if (this.points.length < 2) {
      return;
    }

    let minV = Number.POSITIVE_INFINITY;
    let maxV = Number.NEGATIVE_INFINITY;
    for (const p of this.points) {
      if (p.v < minV) minV = p.v;
      if (p.v > maxV) maxV = p.v;
    }

    if (!Number.isFinite(minV) || !Number.isFinite(maxV)) {
      return;
    }

    if (minV === maxV) {
      minV -= 1;
      maxV += 1;
    }

    const tStart = this.points[0].t;
    const tEnd = this.points[this.points.length - 1].t;
    const tRange = Math.max(1e-9, tEnd - tStart);

    ctx.strokeStyle = this.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < this.points.length; i += 1) {
      const p = this.points[i];
      const x = ((p.t - tStart) / tRange) * w;
      const y = h - ((p.v - minV) / (maxV - minV)) * h;
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    ctx.fillStyle = 'rgba(31, 42, 55, 0.68)';
    ctx.font = '11px "IBM Plex Mono", monospace';
    ctx.fillText(maxV.toFixed(2), 8, 13);
    ctx.fillText(minV.toFixed(2), 8, h - 6);
  }
}

function ensureRecyclrMount() {
  if (state.mounted) {
    return;
  }
  Recyclr.mount(document, {
    defaults: {
      identifier: 'gx',
      history: 'off',
      dispatch: 'on'
    }
  });
  state.mounted = true;
}

async function loadScenarios() {
  try {
    const res = await fetch('/api/scenarios', { credentials: 'same-origin' });
    if (!res.ok) {
      throw new Error('failed to load scenarios');
    }
    const payload = await res.json();
    state.scenarios = Array.isArray(payload) ? payload : [];
  } catch (_) {
    state.scenarios = [];
  }
}

function hydrateScenarioSelect(root) {
  const selects = root.querySelectorAll('[data-scenario-select]');
  if (!selects.length) {
    return;
  }

  const scenarios = state.scenarios;
  for (const sel of selects) {
    const preserve = sel.value;
    sel.innerHTML = '';

    if (!scenarios.length) {
      const opt = document.createElement('option');
      opt.value = 'free_fall';
      opt.textContent = 'free_fall';
      sel.appendChild(opt);
      continue;
    }

    scenarios.forEach((item) => {
      const opt = document.createElement('option');
      opt.value = item.name;
      opt.textContent = `${item.name} • dt=${item.dt}s • duration=${item.duration}s`;
      sel.appendChild(opt);
    });

    if (preserve) {
      sel.value = preserve;
    }
  }
}

function fmt(value, digits = 3) {
  if (!Number.isFinite(value)) {
    return '-';
  }
  return value.toFixed(digits);
}

function setStatus(message) {
  if (!state.refs || !state.refs.status) {
    return;
  }
  state.refs.status.textContent = message;
}

function stopStream(reason) {
  if (state.stream) {
    state.stream.close();
    state.stream = null;
  }
  if (reason) {
    setStatus(reason);
  }
}

function resetCharts() {
  if (!state.charts) {
    return;
  }
  Object.values(state.charts).forEach((chart) => chart.reset());
}

function maybeInitLab() {
  const root = document.querySelector('[data-lab-root]');
  if (!root) {
    if (state.labRoot) {
      stopStream('stream idle');
      state.labRoot = null;
      state.refs = null;
      state.charts = null;
    }
    return;
  }

  if (state.labRoot === root) {
    hydrateScenarioSelect(root);
    return;
  }

  state.labRoot = root;
  state.refs = {
    status: root.querySelector('[data-stream-status]'),
    statTime: root.querySelector('[data-stat="time"]'),
    statAlt: root.querySelector('[data-stat="altitude"]'),
    statVz: root.querySelector('[data-stat="vertical"]'),
    statC: root.querySelector('[data-stat="c"]'),
    statLock: root.querySelector('[data-stat="lock"]'),
    statEnergy: root.querySelector('[data-stat="energy"]'),
    exportButtons: Array.from(root.querySelectorAll('[data-export-sim]'))
  };

  state.charts = {
    altitude: new LineChart(root.querySelector('[data-chart="altitude"]'), '#0f6a73'),
    velocity: new LineChart(root.querySelector('[data-chart="vertical"]'), '#9b4d1e'),
    coupling: new LineChart(root.querySelector('[data-chart="c"]'), '#2b4a77'),
    lock: new LineChart(root.querySelector('[data-chart="lock"]'), '#587d2f'),
    power: new LineChart(root.querySelector('[data-chart="power"]'), '#7a3555'),
    energy: new LineChart(root.querySelector('[data-chart="energy"]'), '#374151')
  };

  window.addEventListener('resize', () => {
    if (!state.charts) {
      return;
    }
    Object.values(state.charts).forEach((chart) => chart.resize());
  }, { once: true });

  hydrateScenarioSelect(root);
  setStatus('ready');
}

function applySample(sample) {
  if (!state.charts || !state.refs) {
    return;
  }

  state.charts.altitude.push(sample.time, sample.altitude);
  state.charts.velocity.push(sample.time, sample.vertical_vel);
  state.charts.coupling.push(sample.time, sample.coupling_c);
  state.charts.lock.push(sample.time, sample.lock_quality);
  state.charts.power.push(sample.time, sample.drive_power);
  state.charts.energy.push(sample.time, sample.energy);

  state.refs.statTime.textContent = `${fmt(sample.time, 2)} s`;
  state.refs.statAlt.textContent = `${fmt(sample.altitude, 1)} m`;
  state.refs.statVz.textContent = `${fmt(sample.vertical_vel, 2)} m/s`;
  state.refs.statC.textContent = fmt(sample.coupling_c, 4);
  state.refs.statLock.textContent = fmt(sample.lock_quality, 4);
  state.refs.statEnergy.textContent = `${fmt(sample.energy, 0)} W*s`;
}

function startStream() {
  maybeInitLab();
  const root = state.labRoot;
  if (!root) {
    return;
  }

  const scenario = root.querySelector('[data-scenario-select]')?.value || 'free_fall';
  const speedRaw = root.querySelector('[data-stream-speed]')?.value || '1';
  const speed = Number.parseFloat(speedRaw);
  const playback = Number.isFinite(speed) ? speed : 1;

  stopStream('starting stream...');
  resetCharts();

  state.streamVersion += 1;
  const version = state.streamVersion;

  const url = `/api/sim/stream?scenario=${encodeURIComponent(scenario)}&speed=${encodeURIComponent(playback)}`;
  const es = new EventSource(url);
  state.stream = es;

  es.onmessage = (evt) => {
    if (version !== state.streamVersion) {
      return;
    }

    let payload;
    try {
      payload = JSON.parse(evt.data);
    } catch (_) {
      return;
    }

    if (payload.type === 'start') {
      setStatus(`running ${payload.scenario} at ${fmt(payload.playback_speed, 2)}x`);
      return;
    }

    if (payload.type === 'sample') {
      applySample(payload);
      return;
    }

    if (payload.type === 'done') {
      if (payload.error) {
        setStatus(`error: ${payload.error}`);
      } else {
        setStatus(`done • ${payload.sample_count} samples`);
      }
      stopStream();
    }
  };

  es.onerror = () => {
    if (version !== state.streamVersion) {
      return;
    }
    setStatus('stream interrupted');
  };
}

function parseDownloadFilename(disposition, fallback) {
  if (!disposition) {
    return fallback;
  }

  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match && utf8Match[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch (_) {
      return fallback;
    }
  }

  const quotedMatch = disposition.match(/filename=\"([^\"]+)\"/i);
  if (quotedMatch && quotedMatch[1]) {
    return quotedMatch[1];
  }

  const bareMatch = disposition.match(/filename=([^;]+)/i);
  if (bareMatch && bareMatch[1]) {
    return bareMatch[1].trim();
  }

  return fallback;
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportScenario(format = 'zip') {
  maybeInitLab();
  const root = state.labRoot;
  if (!root || state.exporting) {
    return;
  }

  const scenario = root.querySelector('[data-scenario-select]')?.value || 'free_fall';
  const formatKey = String(format || 'zip').toLowerCase();
  const ext = formatKey === 'csv' ? 'csv' : formatKey === 'meta' ? 'meta.json' : 'zip';
  const fallbackName = `${scenario}-export.${ext}`;

  state.exporting = true;
  if (state.refs?.exportButtons) {
    state.refs.exportButtons.forEach((btn) => {
      btn.disabled = true;
    });
  }
  setStatus(`exporting ${scenario} (${formatKey})...`);

  try {
    const url = `/api/sim/export?scenario=${encodeURIComponent(scenario)}&format=${encodeURIComponent(formatKey)}`;
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) {
      const message = (await res.text()).trim();
      throw new Error(message || 'export failed');
    }

    const blob = await res.blob();
    const filename = parseDownloadFilename(res.headers.get('content-disposition'), fallbackName);
    triggerDownload(blob, filename);
    setStatus(`export ready • ${filename}`);
  } catch (err) {
    const message = err && err.message ? err.message : 'export failed';
    setStatus(`export failed: ${message}`);
  } finally {
    state.exporting = false;
    if (state.refs?.exportButtons) {
      state.refs.exportButtons.forEach((btn) => {
        btn.disabled = false;
      });
    }
  }
}

function drawCharts() {
  if (state.charts) {
    Object.values(state.charts).forEach((chart) => chart.draw());
  }
  window.requestAnimationFrame(drawCharts);
}

function setupEvents() {
  document.addEventListener('click', (event) => {
    const runButton = event.target.closest('[data-run-sim]');
    if (runButton) {
      event.preventDefault();
      startStream();
      return;
    }

    if (event.target.closest('[data-stop-sim]')) {
      event.preventDefault();
      stopStream('stopped');
      return;
    }

    const exportButton = event.target.closest('[data-export-sim]');
    if (exportButton) {
      event.preventDefault();
      const format = exportButton.getAttribute('data-export-format') || 'zip';
      exportScenario(format);
      return;
    }

    if (event.target.closest('[data-paper-link]')) {
      window.setTimeout(() => {
        maybeInitLab();
      }, 50);
    }
  }, true);

  document.addEventListener('gx:updated', () => {
    window.setTimeout(() => {
      maybeInitLab();
    }, 0);
  });

  window.addEventListener('beforeunload', () => {
    stopStream();
  });
}

async function boot() {
  ensureRecyclrMount();
  setupEvents();
  await loadScenarios();
  hydrateScenarioSelect(document);
  maybeInitLab();
  drawCharts();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
