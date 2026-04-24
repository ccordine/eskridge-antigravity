const Recyclr = require('recyclrjs');

const state = {
  scenarios: [],
  scenariosLoading: false,
  mounted: false,
  labRoot: null,
  refs: null,
  renderer: null,
  game: {
    sessionId: '',
    dt: 1 / 120,
    running: false,
    paused: false,
    requestInFlight: false,
    rafId: 0,
    lastFrameTs: 0,
    accumulator: 0,
    latest: null,
    trailTop: [],
    trailSide: [],
    maxTrail: 900
  },
  input: {
    keys: Object.create(null),
    lockAssist: true,
    lastControl: {
      mode: 'manual',
      manualAmp: 0,
      manualPhi: 0,
      manualYaw: 0,
      autoAmp: 0,
      autoPhi: 0,
      finalAmp: 0,
      finalPhi: 0,
      finalYaw: 0
    }
  },
  exporting: false
};

class DualViewRenderer {
  constructor(topCanvas, sideCanvas) {
    this.topCanvas = topCanvas;
    this.sideCanvas = sideCanvas;
    this.topCtx = topCanvas.getContext('2d');
    this.sideCtx = sideCanvas.getContext('2d');
    this.camTop = { x: 0, y: 0 };
    this.camSide = { x: 0, alt: 0 };
    this.resize();
  }

  resize() {
    this.resizeCanvas(this.topCanvas, this.topCtx);
    this.resizeCanvas(this.sideCanvas, this.sideCtx);
  }

  resizeCanvas(canvas, ctx) {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(20, canvas.clientWidth);
    const h = Math.max(20, canvas.clientHeight);
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  draw(sample, trailTop, trailSide) {
    this.drawTop(sample, trailTop);
    this.drawSide(sample, trailSide);
  }

  drawTop(sample, trail) {
    const ctx = this.topCtx;
    const canvas = this.topCanvas;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;

    ctx.clearRect(0, 0, w, h);
    this.paintBackdrop(ctx, w, h);
    this.paintGrid(ctx, w, h);

    if (!sample) {
      this.paintMessage(ctx, w, h, 'Start session to render top-down view');
      return;
    }

    this.camTop.x = this.lerp(this.camTop.x, sample.position.x, 0.14);
    this.camTop.y = this.lerp(this.camTop.y, sample.position.y, 0.14);

    const topScale = this.scaleFromTrail(trail, w, h, (point) => [point.x - this.camTop.x, point.y - this.camTop.y], 1200);
    this.paintTrail(ctx, trail, topScale, w, h, (point) => ({
      x: (point.x - this.camTop.x) * topScale + w * 0.5,
      y: h * 0.5 - (point.y - this.camTop.y) * topScale
    }), 'rgba(15, 106, 115, 0.45)');

    const craftX = w * 0.5;
    const craftY = h * 0.5;
    this.paintCraft(ctx, craftX, craftY, '#0f6a73');

    const velScale = 1.9;
    this.paintArrow(
      ctx,
      craftX,
      craftY,
      craftX + sample.velocity.x * velScale,
      craftY - sample.velocity.y * velScale,
      '#2b4a77'
    );

    const gravScale = 18;
    this.paintArrow(
      ctx,
      craftX,
      craftY,
      craftX + sample.effective_g.x * gravScale,
      craftY - sample.effective_g.y * gravScale,
      '#9b4d1e'
    );

    this.paintLegend(ctx, w, [
      ['craft', '#0f6a73'],
      ['velocity', '#2b4a77'],
      ['gravity', '#9b4d1e']
    ]);
  }

  drawSide(sample, trail) {
    const ctx = this.sideCtx;
    const canvas = this.sideCanvas;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;

    ctx.clearRect(0, 0, w, h);
    this.paintBackdrop(ctx, w, h);
    this.paintGrid(ctx, w, h);

    if (!sample) {
      this.paintMessage(ctx, w, h, 'Profile view appears here once running');
      return;
    }

    this.camSide.x = this.lerp(this.camSide.x, sample.position.x, 0.14);
    this.camSide.alt = this.lerp(this.camSide.alt, sample.altitude, 0.12);

    const sideScale = this.scaleFromTrail(trail, w, h, (point) => [point.x - this.camSide.x, point.alt - this.camSide.alt], 800);

    const groundY = h * 0.5 + this.camSide.alt * sideScale;
    ctx.strokeStyle = 'rgba(120, 95, 66, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, groundY);
    ctx.lineTo(w, groundY);
    ctx.stroke();

    this.paintTrail(ctx, trail, sideScale, w, h, (point) => ({
      x: (point.x - this.camSide.x) * sideScale + w * 0.5,
      y: h * 0.5 - (point.alt - this.camSide.alt) * sideScale
    }), 'rgba(88, 125, 47, 0.45)');

    const craftX = w * 0.5;
    const craftY = h * 0.5;
    this.paintCraft(ctx, craftX, craftY, '#587d2f');

    const velScale = 1.9;
    this.paintArrow(
      ctx,
      craftX,
      craftY,
      craftX + sample.velocity.x * velScale,
      craftY - sample.vertical_vel * velScale,
      '#2b4a77'
    );

    const gravScale = 18;
    this.paintArrow(
      ctx,
      craftX,
      craftY,
      craftX + sample.effective_g.x * gravScale,
      craftY - sample.effective_g.z * gravScale,
      '#9b4d1e'
    );

    this.paintLegend(ctx, w, [
      ['craft', '#587d2f'],
      ['velocity', '#2b4a77'],
      ['gravity', '#9b4d1e']
    ]);
  }

  paintBackdrop(ctx, w, h) {
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, '#fffdf7');
    gradient.addColorStop(1, '#f6efe0');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
  }

  paintGrid(ctx, w, h) {
    ctx.strokeStyle = 'rgba(30, 47, 63, 0.09)';
    ctx.lineWidth = 1;
    const spacing = 48;
    for (let x = 0; x <= w; x += spacing) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y <= h; y += spacing) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
  }

  paintMessage(ctx, w, h, text) {
    ctx.fillStyle = 'rgba(31, 42, 55, 0.66)';
    ctx.font = '12px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(text, w * 0.5, h * 0.5);
    ctx.textAlign = 'start';
  }

  paintTrail(ctx, trail, scale, w, h, projector, color) {
    if (!trail || trail.length < 2) {
      return;
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < trail.length; i += 1) {
      const p = projector(trail[i], scale, w, h);
      if (i === 0) {
        ctx.moveTo(p.x, p.y);
      } else {
        ctx.lineTo(p.x, p.y);
      }
    }
    ctx.stroke();
  }

  paintCraft(ctx, x, y, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fill();
  }

  paintArrow(ctx, x0, y0, x1, y1, color) {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();

    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len < 4) {
      return;
    }
    const ux = dx / len;
    const uy = dy / len;
    const leftX = x1 - ux * 9 - uy * 4;
    const leftY = y1 - uy * 9 + ux * 4;
    const rightX = x1 - ux * 9 + uy * 4;
    const rightY = y1 - uy * 9 - ux * 4;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(leftX, leftY);
    ctx.lineTo(rightX, rightY);
    ctx.closePath();
    ctx.fill();
  }

  paintLegend(ctx, w, entries) {
    let x = 12;
    const y = 16;
    ctx.font = '11px "IBM Plex Mono", monospace';
    for (const entry of entries) {
      const [label, color] = entry;
      ctx.fillStyle = color;
      ctx.fillRect(x, y - 8, 10, 10);
      x += 14;
      ctx.fillStyle = 'rgba(31, 42, 55, 0.78)';
      ctx.fillText(label, x, y);
      x += ctx.measureText(label).width + 16;
      if (x > w - 80) {
        break;
      }
    }
  }

  scaleFromTrail(trail, w, h, project, fallbackRange) {
    if (!trail || trail.length < 2) {
      return Math.min(w, h) / fallbackRange;
    }
    let maxRange = 1;
    for (let i = 0; i < trail.length; i += 1) {
      const [dx, dy] = project(trail[i]);
      maxRange = Math.max(maxRange, Math.abs(dx), Math.abs(dy));
    }
    const padded = Math.max(120, maxRange * 1.25);
    return Math.min(w, h) / (padded * 2);
  }

  lerp(a, b, t) {
    return a + (b - a) * t;
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

function normalizePaperNavSelection(scope = document) {
  if (!scope || typeof scope.querySelectorAll !== 'function') {
    return;
  }
  const mapping = '#paper-fragment@outerHTML->#paper-content@innerHTML';
  scope.querySelectorAll('a[data-paper-link]').forEach((link) => {
    if (!link || typeof link.getAttribute !== 'function' || typeof link.setAttribute !== 'function') {
      return;
    }
    const current = link.getAttribute('data-gx-select') || '';
    if (current !== mapping) {
      link.setAttribute('data-gx-select', mapping);
    }
  });
}

function normalizeScenario(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const nameRaw = item.name ?? item.Name;
  const pathRaw = item.path ?? item.Path;
  const name = typeof nameRaw === 'string' && nameRaw.trim()
    ? nameRaw.trim()
    : (typeof pathRaw === 'string' && pathRaw.trim()
      ? pathRaw.trim().split('/').pop().replace(/\.json$/i, '')
      : '');
  if (!name) {
    return null;
  }

  const dt = Number.parseFloat(item.dt ?? item.Dt);
  const duration = Number.parseFloat(item.duration ?? item.Duration);
  const gravityModelRaw = item.gravity_model ?? item.GravityModel;
  const gravityModel = typeof gravityModelRaw === 'string' && gravityModelRaw.trim()
    ? gravityModelRaw.trim().toLowerCase()
    : 'coupling';
  const couplerEnabled = Boolean(item.coupler_enabled ?? item.CouplerEnabled);

  return {
    name,
    path: typeof pathRaw === 'string' ? pathRaw : '',
    dt: Number.isFinite(dt) ? dt : 0,
    duration: Number.isFinite(duration) ? duration : 0,
    gravityModel,
    couplerEnabled
  };
}

async function loadScenarios(options = {}) {
  const force = Boolean(options && options.force);
  if (state.scenariosLoading) {
    return state.scenarios;
  }
  if (!force && state.scenarios.length > 0) {
    return state.scenarios;
  }

  state.scenariosLoading = true;
  try {
    const res = await fetch('/api/scenarios', { credentials: 'same-origin' });
    if (!res.ok) {
      throw new Error('failed to load scenarios');
    }
    const payload = await res.json();
    state.scenarios = Array.isArray(payload) ? payload.map(normalizeScenario).filter(Boolean) : [];
  } catch (_) {
    if (!state.scenarios.length) {
      state.scenarios = [];
    }
  } finally {
    state.scenariosLoading = false;
  }
  return state.scenarios;
}

function hydrateScenarioSelect(root) {
  const select = root.querySelector('[data-scenario-select]');
  if (!select) {
    return;
  }

  const preserve = select.value;
  select.innerHTML = '';

  if (!state.scenarios.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = state.scenariosLoading ? 'Loading scenarios...' : 'No scenarios available';
    select.appendChild(opt);
    select.disabled = true;
    return;
  }

  select.disabled = false;
  for (const item of state.scenarios) {
    const opt = document.createElement('option');
    const dtLabel = Number.isFinite(item.dt) && item.dt > 0 ? `${item.dt}` : '?';
    const durationLabel = Number.isFinite(item.duration) && item.duration > 0 ? `${item.duration}` : '?';
    const couplerLabel = item.couplerEnabled ? 'coupler:on' : 'coupler:off';
    opt.value = item.name;
    opt.textContent = `${item.name} • ${item.gravityModel} • ${couplerLabel} • dt=${dtLabel}s • duration=${durationLabel}s`;
    select.appendChild(opt);
  }

  if (preserve && Array.from(select.options).some((opt) => opt.value === preserve)) {
    select.value = preserve;
  } else if (select.options.length > 0) {
    select.value = select.options[0].value;
  }
}

function selectedScenario(root) {
  const selected = root.querySelector('[data-scenario-select]')?.value || '';
  if (selected) {
    return selected;
  }
  if (state.scenarios.length > 0) {
    return state.scenarios[0].name;
  }
  return 'free_fall';
}

function maybeInitLab() {
  const root = document.querySelector('[data-flight-lab-root]');
  if (!root) {
    if (state.labRoot) {
      void stopGameSession(true, 'session closed');
      state.labRoot = null;
      state.refs = null;
      state.renderer = null;
    }
    return;
  }

  if (state.labRoot === root) {
    hydrateScenarioSelect(root);
    if (!state.scenarios.length && !state.scenariosLoading) {
      void loadScenarios({ force: true }).then(() => {
        if (state.labRoot === root) {
          hydrateScenarioSelect(root);
        }
      });
    }
    return;
  }

  state.labRoot = root;
  const stats = Object.create(null);
  root.querySelectorAll('[data-stat]').forEach((node) => {
    const key = node.getAttribute('data-stat');
    if (key) {
      stats[key] = node;
    }
  });

  state.refs = {
    status: root.querySelector('[data-game-status]'),
    scenario: root.querySelector('[data-scenario-select]'),
    speed: root.querySelector('[data-game-speed]'),
    startGround: root.querySelector('[data-game-start-ground]'),
    autoTrim: root.querySelector('[data-auto-trim]'),
    autoWeight: root.querySelector('[data-auto-weight]'),
    autoVertical: root.querySelector('[data-auto-vertical]'),
    pauseButton: root.querySelector('[data-game-pause]'),
    stats,
    canvasTop: root.querySelector('[data-game-canvas-top]'),
    canvasSide: root.querySelector('[data-game-canvas-side]')
  };

  state.renderer = new DualViewRenderer(state.refs.canvasTop, state.refs.canvasSide);
  state.renderer.draw(state.game.latest, state.game.trailTop, state.game.trailSide);

  window.addEventListener('resize', () => {
    if (state.renderer) {
      state.renderer.resize();
    }
  }, { once: true });

  hydrateScenarioSelect(root);
  if (!state.scenarios.length && !state.scenariosLoading) {
    void loadScenarios({ force: true }).then(() => {
      if (state.labRoot === root) {
        hydrateScenarioSelect(root);
      }
    });
  }
  setStatus('ready');
  updateHUD(state.game.latest);
}

function setStatus(message) {
  if (!state.refs?.status) {
    return;
  }
  state.refs.status.textContent = message;
}

function formatNumber(value, digits = 3, suffix = '') {
  if (!Number.isFinite(value)) {
    return '-';
  }
  return `${value.toFixed(digits)}${suffix}`;
}

function clampUnit(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(-1, Math.min(1, value));
}

function readNumberInput(node, fallback) {
  const raw = Number.parseFloat(node?.value ?? '');
  if (!Number.isFinite(raw)) {
    return fallback;
  }
  return raw;
}

function localVerticalMetrics(sample) {
  if (!sample || !sample.position || !sample.primary_position || !sample.g_raw || !sample.effective_g) {
    return null;
  }

  const rx = sample.position.x - sample.primary_position.x;
  const ry = sample.position.y - sample.primary_position.y;
  const rz = sample.position.z - sample.primary_position.z;
  const rMag = Math.hypot(rx, ry, rz);
  if (!Number.isFinite(rMag) || rMag <= 1e-9) {
    return null;
  }
  const ux = rx / rMag;
  const uy = ry / rMag;
  const uz = rz / rMag;

  const downRaw = -(sample.g_raw.x * ux + sample.g_raw.y * uy + sample.g_raw.z * uz);
  const downEff = -(sample.effective_g.x * ux + sample.effective_g.y * uy + sample.effective_g.z * uz);
  const ratio = Math.abs(downRaw) > 1e-9 ? downEff / downRaw : NaN;
  return { downRaw, downEff, ratio };
}

function setStat(key, value) {
  const node = state.refs?.stats?.[key];
  if (!node) {
    return;
  }
  node.textContent = value;
}

function updateHUD(sample) {
  if (!state.refs || !state.refs.stats) {
    return;
  }
  if (!sample) {
    for (const key of Object.keys(state.refs.stats)) {
      setStat(key, '-');
    }
    return;
  }

  setStat('time', `${formatNumber(sample.time, 2)} s`);
  setStat('step', `${sample.step}`);
  setStat('altitude', `${formatNumber(sample.altitude, 1)} m`);
  setStat('speed', `${formatNumber(sample.speed, 2)} m/s`);
  setStat('vertical', `${formatNumber(sample.vertical_vel, 2)} m/s`);
  setStat('model', sample.gravity_model || '-');

  const mass = Number.parseFloat(sample.craft_mass);
  const vertical = localVerticalMetrics(sample);
  const downRaw = vertical ? vertical.downRaw : NaN;
  const downEff = vertical ? vertical.downEff : NaN;
  const weightN = Number.isFinite(mass) && Number.isFinite(downEff) ? (mass * downEff) : NaN;
  const weightKGF = Number.isFinite(weightN) ? (weightN / 9.80665) : NaN;

  setStat('mass', `${formatNumber(mass, 1)} kg`);
  setStat('weight_n', `${formatNumber(weightN, 1)} N`);
  setStat('weight_kgf', `${formatNumber(weightKGF, 2)} kgf`);
  setStat('weight_ratio', `${formatNumber(vertical ? vertical.ratio : NaN, 3)} x`);
  setStat('down_g_raw', `${formatNumber(downRaw, 3)} m/s^2`);
  setStat('down_g_eff', `${formatNumber(downEff, 3)} m/s^2`);

  setStat('c', formatNumber(sample.coupling_c, 4));
  setStat('k', formatNumber(sample.coupling_k, 4));
  setStat('phi', formatNumber(sample.coupling_phi, 4));
  setStat('phase', formatNumber(sample.phase_error, 4));
  setStat('lock', `${formatNumber(sample.lock_quality, 4)} (${sample.lock_flag ? 'lock' : 'open'})`);
  setStat('runaway', sample.runaway_flag ? 'flagged' : 'clear');

  setStat('drive_amp', formatNumber(sample.drive_amp, 4));
  setStat('drive_omega', `${formatNumber(sample.drive_omega, 3)} rad/s`);
  setStat('omega_base', `${formatNumber(sample.omega_base, 3)} rad/s`);
  setStat('drive_phase', formatNumber(sample.drive_phase, 4));
  setStat('pll_delta', `${formatNumber(sample.pll_freq_delta, 4)} rad/s`);
  setStat('osc_mag', formatNumber(sample.osc_mag, 4));

  setStat('power', `${formatNumber(sample.drive_power, 0)} W`);
  setStat('energy', `${formatNumber(sample.energy, 0)} W*s`);
  setStat('amp_target', formatNumber(sample.control_amp_target, 3));
  setStat('theta_target', formatNumber(sample.control_theta_target, 3));
  setStat('axis_yaw', formatNumber(sample.control_axis_yaw, 3));
  setStat('lock_assist', sample.control_lock_assist ? 'on' : 'off');
  setStat('amp_axis', formatNumber(sample.control_amp_axis, 2));
  setStat('phi_axis', formatNumber(sample.control_phi_axis, 2));
  setStat('yaw_axis', formatNumber(sample.control_yaw_axis, 2));

  const last = state.input.lastControl || {};
  setStat('control_mode', last.mode || 'manual');
  setStat('auto_amp', formatNumber(last.autoAmp, 2));
  setStat('auto_phi', formatNumber(last.autoPhi, 2));
}

function pushTrail(sample) {
  if (!sample || !sample.position) {
    return;
  }
  state.game.trailTop.push({
    x: sample.position.x,
    y: sample.position.y
  });
  state.game.trailSide.push({
    x: sample.position.x,
    alt: sample.altitude
  });

  while (state.game.trailTop.length > state.game.maxTrail) {
    state.game.trailTop.shift();
  }
  while (state.game.trailSide.length > state.game.maxTrail) {
    state.game.trailSide.shift();
  }
}

function clearTrails() {
  state.game.trailTop = [];
  state.game.trailSide = [];
}

async function apiPost(path, payload) {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload || {})
  });
  if (!res.ok) {
    const message = (await res.text()).trim();
    throw new Error(message || `request failed (${res.status})`);
  }
  return res.json();
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

  if (!state.scenarios.length) {
    setStatus('loading scenarios...');
    await loadScenarios({ force: true });
    hydrateScenarioSelect(root);
  }

  const scenario = selectedScenario(root);
  const formatKey = String(format || 'zip').toLowerCase();
  const ext = formatKey === 'csv' ? 'csv' : formatKey === 'meta' ? 'meta.json' : 'zip';
  const fallbackName = `${scenario}-export.${ext}`;

  state.exporting = true;
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
    setStatus(`export failed: ${err.message || 'unknown error'}`);
  } finally {
    state.exporting = false;
  }
}

function simSpeedMultiplier() {
  const raw = Number.parseFloat(state.refs?.speed?.value || '1');
  if (!Number.isFinite(raw)) {
    return 1;
  }
  return Math.max(0.25, Math.min(8, raw));
}

async function startGameSession() {
  maybeInitLab();
  const root = state.labRoot;
  if (!root) {
    return;
  }

  if (!state.scenarios.length) {
    setStatus('loading scenarios...');
    await loadScenarios({ force: true });
    hydrateScenarioSelect(root);
  }

  await stopGameSession(true);

  const scenario = selectedScenario(root);
  setStatus(`starting ${scenario}...`);
  const startOnGround = Boolean(state.refs?.startGround?.checked);

  try {
    const payload = await apiPost('/api/game/start', { scenario, start_on_ground: startOnGround });
    state.game.sessionId = payload.session_id || '';
    state.game.dt = Number.parseFloat(payload.dt) || Number.parseFloat(payload?.state?.dt) || (1 / 120);
    state.game.running = true;
    state.game.paused = false;
    state.game.requestInFlight = false;
    state.game.lastFrameTs = 0;
    state.game.accumulator = 0;
    state.game.latest = payload.state || null;
    clearTrails();
    pushTrail(state.game.latest);
    state.input.lockAssist = Boolean(state.game.latest?.control_lock_assist);
    state.input.lastControl = {
      mode: 'manual',
      manualAmp: 0,
      manualPhi: 0,
      manualYaw: 0,
      autoAmp: 0,
      autoPhi: 0,
      finalAmp: 0,
      finalPhi: 0,
      finalYaw: 0
    };
    if (state.refs?.pauseButton) {
      state.refs.pauseButton.textContent = 'Pause';
    }
    updateHUD(state.game.latest);
    if (state.renderer) {
      state.renderer.draw(state.game.latest, state.game.trailTop, state.game.trailSide);
    }
    const mode = String(state.game.latest?.gravity_model || '').toLowerCase();
    const couplerEnabled = Boolean(state.game.latest?.coupler_enabled);
    if (!couplerEnabled) {
      setStatus(`running ${scenario} • coupler off • A/W/Q controls are telemetry-only here`);
    } else if (mode && mode !== 'coupling') {
      setStatus(`running ${scenario} • ${mode} model • coupler controls are telemetry-only here`);
    } else {
      setStatus(`running ${scenario} • dt=${state.game.dt.toFixed(4)} s • ${startOnGround ? 'ground start' : 'scenario start'}`);
    }
    if (!state.game.rafId) {
      state.game.rafId = window.requestAnimationFrame(gameLoop);
    }
  } catch (err) {
    setStatus(`start failed: ${err.message || 'unknown error'}`);
  }
}

async function stopGameSession(sendStop = true, finalStatus = 'stopped') {
  const oldSession = state.game.sessionId;
  if (sendStop && oldSession) {
    try {
      await apiPost('/api/game/stop', { session_id: oldSession });
    } catch (_) {
      // best-effort close
    }
  }

  state.game.sessionId = '';
  state.game.running = false;
  state.game.paused = false;
  state.game.requestInFlight = false;
  state.game.lastFrameTs = 0;
  state.game.accumulator = 0;
  if (state.game.rafId) {
    window.cancelAnimationFrame(state.game.rafId);
    state.game.rafId = 0;
  }
  if (state.refs?.pauseButton) {
    state.refs.pauseButton.textContent = 'Pause';
  }
  if (finalStatus) {
    setStatus(finalStatus);
  }
}

function togglePause() {
  if (!state.game.running) {
    return;
  }
  state.game.paused = !state.game.paused;
  if (state.refs?.pauseButton) {
    state.refs.pauseButton.textContent = state.game.paused ? 'Resume' : 'Pause';
  }
  setStatus(state.game.paused ? 'paused' : 'running');
}

async function resetGameSession() {
  if (!state.labRoot) {
    return;
  }
  await startGameSession();
}

function currentControlPayload(sample = state.game.latest) {
  const keys = state.input.keys;
  const manualAmp = (keys.d ? 1 : 0) + (keys.a ? -1 : 0);
  const manualPhi = (keys.w ? 1 : 0) + (keys.s ? -1 : 0);
  const manualYaw = (keys.e ? 1 : 0) + (keys.q ? -1 : 0);

  let autoAmp = 0;
  let autoPhi = 0;
  let mode = 'manual';

  const autoTrimEnabled = Boolean(state.refs?.autoTrim?.checked);
  const couplerEnabled = Boolean(sample?.coupler_enabled);
  const couplingModel = String(sample?.gravity_model || '').toLowerCase() === 'coupling';
  if (autoTrimEnabled && couplerEnabled && couplingModel) {
    const vertical = localVerticalMetrics(sample);
    const weightRatio = vertical ? vertical.ratio : NaN;
    const targetWeight = readNumberInput(state.refs?.autoWeight, 1.0);
    const targetVertical = readNumberInput(state.refs?.autoVertical, 0.0);
    const verticalVel = Number.parseFloat(sample?.vertical_vel);
    const lockQuality = Number.parseFloat(sample?.lock_quality);

    const weightErr = Number.isFinite(weightRatio) ? (targetWeight - weightRatio) : 0;
    const verticalErr = Number.isFinite(verticalVel) ? (targetVertical - verticalVel) : 0;
    const lockErr = Number.isFinite(lockQuality) ? (0.9 - lockQuality) : 0;

    autoPhi = clampUnit((weightErr * 0.9) + (verticalErr * 0.04));
    autoAmp = clampUnit(lockErr * 1.1);
    mode = 'assist';
  }

  const ampAxis = clampUnit(manualAmp + autoAmp);
  const phiAxis = clampUnit(manualPhi + autoPhi);
  const yawAxis = clampUnit(manualYaw);

  state.input.lastControl = {
    mode,
    manualAmp,
    manualPhi,
    manualYaw,
    autoAmp,
    autoPhi,
    finalAmp: ampAxis,
    finalPhi: phiAxis,
    finalYaw: yawAxis
  };

  return {
    amp_axis: ampAxis,
    phi_axis: phiAxis,
    yaw_axis: yawAxis,
    lock_assist: state.input.lockAssist
  };
}

async function requestStep(steps) {
  if (!state.game.running || state.game.requestInFlight || !state.game.sessionId) {
    return;
  }

  state.game.requestInFlight = true;
  try {
    const payload = await apiPost('/api/game/step', {
      session_id: state.game.sessionId,
      steps,
      controls: currentControlPayload(state.game.latest)
    });
    const sample = payload?.state || null;
    if (!sample) {
      throw new Error('empty step response');
    }
    state.game.latest = sample;
    pushTrail(sample);
    updateHUD(sample);
    const vertical = localVerticalMetrics(sample);
    const ratio = vertical ? formatNumber(vertical.ratio, 3) : '-';
    const mode = state.input.lastControl?.mode || 'manual';
    setStatus(`running • t=${formatNumber(sample.time, 2)}s • C=${formatNumber(sample.coupling_c, 3)} • W=${ratio}x • ${mode}`);
  } catch (err) {
    setStatus(`session error: ${err.message || 'step failed'}`);
    await stopGameSession(false, 'session closed');
  } finally {
    state.game.requestInFlight = false;
  }
}

function gameLoop(ts) {
  state.game.rafId = 0;
  if (!state.game.running) {
    return;
  }

  if (!state.game.lastFrameTs) {
    state.game.lastFrameTs = ts;
  }

  const wallDt = Math.min(0.1, Math.max(0, (ts - state.game.lastFrameTs) / 1000));
  state.game.lastFrameTs = ts;

  if (!state.game.paused) {
    state.game.accumulator += wallDt * simSpeedMultiplier();
    state.game.accumulator = Math.min(state.game.accumulator, state.game.dt * 240);
    const stepsReady = Math.floor(state.game.accumulator / state.game.dt);
    if (stepsReady > 0 && !state.game.requestInFlight) {
      const steps = Math.min(stepsReady, 12);
      state.game.accumulator -= steps * state.game.dt;
      void requestStep(steps);
    }
  }

  if (state.renderer) {
    state.renderer.draw(state.game.latest, state.game.trailTop, state.game.trailSide);
  }
  state.game.rafId = window.requestAnimationFrame(gameLoop);
}

function isTypingTarget(target) {
  if (!target) {
    return false;
  }
  const tag = target.tagName ? target.tagName.toLowerCase() : '';
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
}

function setupEvents() {
  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-game-start]')) {
      event.preventDefault();
      void startGameSession();
      return;
    }

    if (event.target.closest('[data-game-pause]')) {
      event.preventDefault();
      togglePause();
      return;
    }

    if (event.target.closest('[data-game-reset]')) {
      event.preventDefault();
      void resetGameSession();
      return;
    }

    if (event.target.closest('[data-game-stop]')) {
      event.preventDefault();
      void stopGameSession(true, 'stopped');
      return;
    }

    const exportButton = event.target.closest('[data-export-sim]');
    if (exportButton) {
      event.preventDefault();
      const format = exportButton.getAttribute('data-export-format') || 'zip';
      void exportScenario(format);
      return;
    }

    if (event.target.closest('[data-paper-link]')) {
      window.setTimeout(() => {
        maybeInitLab();
      }, 50);
    }
  }, true);

  document.addEventListener('keydown', (event) => {
    if (isTypingTarget(event.target)) {
      return;
    }
    const key = (event.key || '').toLowerCase();
    if (key === ' ') {
      event.preventDefault();
      if (!event.repeat) {
        state.input.lockAssist = !state.input.lockAssist;
      }
      return;
    }
    if (key === 'r') {
      event.preventDefault();
      if (!event.repeat) {
        void resetGameSession();
      }
      return;
    }
    if (key === 'p') {
      event.preventDefault();
      if (!event.repeat) {
        togglePause();
      }
      return;
    }
    if (key === 'w' || key === 'a' || key === 's' || key === 'd' || key === 'q' || key === 'e') {
      event.preventDefault();
      state.input.keys[key] = true;
    }
  }, true);

  document.addEventListener('keyup', (event) => {
    const key = (event.key || '').toLowerCase();
    if (key === 'w' || key === 'a' || key === 's' || key === 'd' || key === 'q' || key === 'e') {
      event.preventDefault();
      state.input.keys[key] = false;
    }
  }, true);

  document.addEventListener('gx:updated', () => {
    normalizePaperNavSelection();
    window.setTimeout(() => {
      maybeInitLab();
    }, 0);
  });

  window.addEventListener('beforeunload', () => {
    if (state.game.sessionId && typeof navigator.sendBeacon === 'function') {
      const body = JSON.stringify({ session_id: state.game.sessionId });
      navigator.sendBeacon('/api/game/stop', body);
    }
  });
}

async function boot() {
  ensureRecyclrMount();
  normalizePaperNavSelection();
  setupEvents();
  await loadScenarios();
  maybeInitLab();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  void boot();
}
