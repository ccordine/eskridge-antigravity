const Recyclr = require('recyclrjs');
const { createInitialState } = require('./lab/state');
const {
  sampleSignature: invariantSampleSignature,
  validateSample,
  validateMonotonicTransition
} = require('./lab/invariants');

const TWO_PI = Math.PI * 2;
const CRAFT_SCALE_MIN = 1.0;
const CRAFT_SCALE_MAX = 6.0;
const CRAFT_LAZAR_SPAN_M = 15.8;
const METERS_TO_FEET = 3.280839895;
const OSC_OMEGA_MIN = 10;
const OSC_OMEGA_MAX = 400;
const OSC_Q_MIN = 1;
const OSC_Q_MAX = 3000;
const OSC_BETA_MIN = 0.0;
const OSC_BETA_MAX = 30;
const PLASMA_MIN = 0.0;
const PLASMA_MAX = 1.0;
const BROWSER_FRAME_INTERVAL_MS = 1000 / 60;
const UI_BUILD_MARK = 'ui-hotfix-2026-04-28-ctrl-mirror-8';
const TELEMETRY_GRAPH_KEYS = ['gravity', 'motion', 'power', 'aero', 'lock', 'control', 'fieldshape'];

const state = createInitialState();

async function fetchCalibrationSummary() {
  try {
    const res = await fetch('/api/game/calibration', { credentials: 'same-origin' });
    if (!res.ok) {
      throw new Error(`calibration ${res.status}`);
    }
    const payload = await res.json();
    const items = Array.isArray(payload?.items) ? payload.items : [];
    if (!items.length) {
      setStat('calibration_summary', 'no data');
      return;
    }
    const parts = items.map((it) => `${String(it.preset || '?')}:${formatCompactNumber(it.surface_g, 2)}g`);
    setStat('calibration_summary', parts.join(' | '));
  } catch (err) {
    setStat('calibration_summary', `error: ${err.message || 'failed'}`);
  }
}

function activeScenarioName() {
  return 'free_play';
}

class DualViewRenderer {
  constructor(topCanvas, sideCanvas, worldCanvas) {
    this.topCanvas = topCanvas;
    this.sideCanvas = sideCanvas;
    this.worldCanvas = worldCanvas;
    this.topCtx = topCanvas.getContext('2d');
    this.sideCtx = sideCanvas.getContext('2d');
    this.worldCtx = worldCanvas ? worldCanvas.getContext('2d') : null;
    this.camTop = { x: 0, y: 0 };
    this.camSide = { x: 0, alt: 0 };
    this.planetaryZoom = 2;
    this.planetaryFollow = 'follow_lock';
    this.worldOrbitYaw = 0;
    this.worldOrbitPitch = 0;
    this.resize();
  }

  resize() {
    this.resizeCanvas(this.topCanvas, this.topCtx);
    this.resizeCanvas(this.sideCanvas, this.sideCtx);
    if (this.worldCanvas && this.worldCtx) {
      this.resizeCanvas(this.worldCanvas, this.worldCtx);
    }
  }

  resizeCanvas(canvas, ctx) {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(20, canvas.clientWidth);
    const h = Math.max(20, canvas.clientHeight);
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  setPlanetaryCamera(zoom, followMode) {
    if (Number.isFinite(zoom)) {
      this.planetaryZoom = Math.max(0.25, Math.min(25, zoom));
    }
    if (followMode === 'global' || followMode === 'follow_lock' || followMode === 'follow_local' || followMode === 'follow') {
      this.planetaryFollow = followMode;
    }
  }

  planetaryViewSettings() {
    const zoom = Number.isFinite(this.planetaryZoom) ? this.planetaryZoom : 1;
    const mode = this.planetaryFollow || 'follow_lock';
    const follow = mode !== 'global';
    const lockRoll = mode !== 'follow_local';
    return { zoom, follow, lockRoll, mode };
  }

  planetAtmosphereSpec(name, radius, shellHeightOverride = null) {
    const key = String(name || '').toLowerCase();
    if (!Number.isFinite(radius) || radius <= 0) {
      return null;
    }
    const shellHeight = Number.isFinite(shellHeightOverride) && shellHeightOverride > 0
      ? shellHeightOverride
      : null;
    switch (key) {
      case 'earth':
        return {
          bodyRadius: radius,
          shellHeight: shellHeight || 100_000,
          minPx: 1.5,
          glowInner: 'rgba(118, 214, 255, 0.24)',
          glowOuter: 'rgba(118, 214, 255, 0.02)',
          line: 'rgba(156, 229, 255, 0.68)',
          fillTop: 'rgba(155, 227, 255, 0.16)',
          fillBottom: 'rgba(88, 168, 212, 0.04)',
          legend: '#8cdcff'
        };
      case 'moon':
        return {
          bodyRadius: radius,
          shellHeight: shellHeight || 20_000,
          minPx: 1.1,
          glowInner: 'rgba(232, 241, 255, 0.12)',
          glowOuter: 'rgba(232, 241, 255, 0.01)',
          line: 'rgba(234, 239, 250, 0.34)',
          fillTop: 'rgba(244, 247, 255, 0.06)',
          fillBottom: 'rgba(220, 231, 245, 0.01)',
          legend: '#dfe8f6'
        };
      case 'mars':
        return {
          bodyRadius: radius,
          shellHeight: shellHeight || 80_000,
          minPx: 1.4,
          glowInner: 'rgba(255, 184, 134, 0.18)',
          glowOuter: 'rgba(255, 184, 134, 0.02)',
          line: 'rgba(255, 194, 148, 0.58)',
          fillTop: 'rgba(255, 198, 158, 0.12)',
          fillBottom: 'rgba(194, 104, 72, 0.03)',
          legend: '#f6b38a'
        };
      case 'venus':
        return {
          bodyRadius: radius,
          shellHeight: shellHeight || 160_000,
          minPx: 1.7,
          glowInner: 'rgba(255, 230, 172, 0.2)',
          glowOuter: 'rgba(255, 230, 172, 0.03)',
          line: 'rgba(255, 233, 184, 0.62)',
          fillTop: 'rgba(255, 240, 196, 0.14)',
          fillBottom: 'rgba(214, 170, 104, 0.04)',
          legend: '#f5ddb2'
        };
      case 'jupiter':
        return {
          bodyRadius: radius,
          shellHeight: shellHeight || 220_000,
          minPx: 1.2,
          glowInner: 'rgba(255, 214, 173, 0.14)',
          glowOuter: 'rgba(255, 214, 173, 0.02)',
          line: 'rgba(255, 221, 188, 0.46)',
          fillTop: 'rgba(255, 231, 208, 0.10)',
          fillBottom: 'rgba(204, 150, 107, 0.03)',
          legend: '#efc8a6'
        };
      default:
        return null;
    }
  }

  sampleAtmosphereSpec(sample) {
    if (!sample || !sample.atmosphere_enabled) {
      return null;
    }
    const radius = Number.parseFloat(sample.primary_radius);
    const scaleHeight = Number.parseFloat(sample.atmosphere_scale_height);
    const shellHeight = Number.isFinite(scaleHeight) && scaleHeight > 0
      ? Math.max(20_000, Math.min(radius * 0.06, scaleHeight * 10))
      : null;
    return this.planetAtmosphereSpec(sample.primary_name, radius, shellHeight);
  }

  atmosphereThicknessPx(screenRadius, atmosphere) {
    if (!atmosphere || !Number.isFinite(screenRadius) || screenRadius <= 0) {
      return 0;
    }
    const physical = screenRadius * (atmosphere.shellHeight / Math.max(atmosphere.bodyRadius, 1));
    return Math.max(atmosphere.minPx || 1.2, physical);
  }

  planetaryFollowScale(w, h, baseRange, zoom) {
    if (!Number.isFinite(baseRange) || baseRange <= 0) {
      return Math.min(w, h) / 1000;
    }
    const z = Number.isFinite(zoom) ? zoom : 1;
    return (Math.min(w, h) / (baseRange * 2)) * z;
  }

  planetaryFollowRange(sample, radius, minimumRange = 4000) {
    if (!sample || !Number.isFinite(radius) || radius <= 0) {
      return 50000;
    }
    const rx = Number.isFinite(sample.position?.x) && Number.isFinite(sample.primary_position?.x)
      ? (sample.position.x - sample.primary_position.x)
      : 0;
    const ry = Number.isFinite(sample.position?.y) && Number.isFinite(sample.primary_position?.y)
      ? (sample.position.y - sample.primary_position.y)
      : 0;
    const rz = Number.isFinite(sample.position?.z) && Number.isFinite(sample.primary_position?.z)
      ? (sample.position.z - sample.primary_position.z)
      : 0;
    const relNorm = Math.hypot(rx, ry, rz);
    const altitude = relNorm > radius ? (relNorm - radius) : 0;
    const floorRange = Math.max(minimumRange, radius * 0.001);
    const dynamicRange = (altitude * 6) + floorRange;
    return Math.max(floorRange, Math.min(250000, dynamicRange));
  }

  planetaryProfileScale(w, h, radius, craftDistance, zoom, localScale) {
    const r = Number.isFinite(radius) && radius > 0 ? radius : 1;
    const d = Number.isFinite(craftDistance) && craftDistance > 0 ? craftDistance : r;
    const z = Number.isFinite(zoom) ? zoom : 1;
    const alt = Math.max(0, d - r);
    const nearScale = Number.isFinite(localScale) && localScale > 0
      ? localScale
      : this.planetaryFollowScale(w, h, 50000, z);
    const farScale = ((h * 0.44) / Math.max(d + r, 1)) * z;
    const blend = Math.max(0, Math.min(1, alt / Math.max(r * 2.5, 1)));
    let scale = (nearScale * (1 - blend)) + (farScale * blend);

    // Keep the planet surface line visible while ship remains centered.
    if (alt > 1) {
      const surfaceVisibleMax = (h * 0.47) / alt;
      if (Number.isFinite(surfaceVisibleMax) && surfaceVisibleMax > 0) {
        scale = Math.min(scale, surfaceVisibleMax);
      }
    }
    return Math.max(scale, Math.min(w, h) / (r * 6000));
  }

  planetaryShouldDrawBodyCircle(screenRadius, w, h, follow) {
    if (!Number.isFinite(screenRadius) || screenRadius <= 0.1) {
      return false;
    }
    if (!follow) {
      return true;
    }
    // In follow mode the apparent planet radius can be huge; skip full-disk fill for performance.
    return screenRadius < (Math.max(w, h) * 5);
  }

  planetaryCameraAnchor2D(vx, vy, follow) {
    if (!follow) {
      return { x: 0, y: 0 };
    }
    return { x: vx, y: vy };
  }

  planetaryFrameFromSample(sample) {
    const rx = Number.isFinite(sample.position?.x) && Number.isFinite(sample.primary_position?.x)
      ? (sample.position.x - sample.primary_position.x)
      : 0;
    const ry = Number.isFinite(sample.position?.y) && Number.isFinite(sample.primary_position?.y)
      ? (sample.position.y - sample.primary_position.y)
      : 0;
    const rz = Number.isFinite(sample.position?.z) && Number.isFinite(sample.primary_position?.z)
      ? (sample.position.z - sample.primary_position.z)
      : 0;
    const rel = { x: rx, y: ry, z: rz };
    const up = this.safeDirection(rel, { x: 0, y: 0, z: 1 });
    let tangent = this.cross3({ x: 0, y: 0, z: 1 }, up);
    if (this.norm3(tangent) <= 1e-6) {
      tangent = this.cross3({ x: 0, y: 1, z: 0 }, up);
    }
    tangent = this.safeDirection(tangent, { x: 1, y: 0, z: 0 });
    return { rel, up, tangent };
  }

  sampleLocalUp(sample) {
    const ux = Number.isFinite(sample?.local_up_x) ? sample.local_up_x : NaN;
    const uy = Number.isFinite(sample?.local_up_y) ? sample.local_up_y : NaN;
    const uz = Number.isFinite(sample?.local_up_z) ? sample.local_up_z : NaN;
    if (Number.isFinite(ux) && Number.isFinite(uy) && Number.isFinite(uz)) {
      return this.safeDirection({ x: ux, y: uy, z: uz }, { x: 0, y: 0, z: 1 });
    }
    return null;
  }

  projectToTangentPlane(v, frame) {
    return {
      x: this.dot3(v, frame.tangent),
      y: this.dot3(v, this.cross3(frame.up, frame.tangent))
    };
  }

  projectToSidePlane(v, frame, forward) {
    return {
      x: this.dot3(v, forward),
      y: this.dot3(v, frame.up)
    };
  }

  craftWarpVector(sample) {
    if (!sample) {
      return null;
    }
    const wx = Number.isFinite(sample.control_warp_x) ? sample.control_warp_x : NaN;
    const wy = Number.isFinite(sample.control_warp_y) ? sample.control_warp_y : NaN;
    const wz = Number.isFinite(sample.control_warp_z) ? sample.control_warp_z : NaN;
    if (!Number.isFinite(wx) || !Number.isFinite(wy) || !Number.isFinite(wz)) {
      return null;
    }
    const n = Math.hypot(wx, wy, wz);
    if (!Number.isFinite(n) || n <= 1e-9) {
      return null;
    }
    return { x: wx / n, y: wy / n, z: wz / n };
  }

  craftLocalUp(sample, mode) {
    if (mode === 'planetary' && sample) {
      return this.sampleLocalUp(sample) || this.planetaryFrameFromSample(sample).up;
    }
    return { x: 0, y: 0, z: 1 };
  }

  localFrameFromSample(sample, mode) {
    const up = this.craftLocalUp(sample, mode);
    let forwardRef = { x: 1, y: 0, z: 0 };
    let forward = this.sub3(forwardRef, this.scale3(up, this.dot3(forwardRef, up)));
    if (this.norm3(forward) <= 1e-6) {
      forwardRef = { x: 0, y: 1, z: 0 };
      forward = this.sub3(forwardRef, this.scale3(up, this.dot3(forwardRef, up)));
    }
    forward = this.safeDirection(forward, { x: 1, y: 0, z: 0 });
    const right = this.safeDirection(this.cross3(up, forward), { x: 0, y: 1, z: 0 });
    return { up, forward, right };
  }

  sampleOrientation(sample) {
    const w = Number.parseFloat(sample?.orientation_w);
    const x = Number.parseFloat(sample?.orientation_x);
    const y = Number.parseFloat(sample?.orientation_y);
    const z = Number.parseFloat(sample?.orientation_z);
    if (!Number.isFinite(w) || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      return null;
    }
    const n = Math.hypot(w, x, y, z);
    if (!Number.isFinite(n) || n <= 1e-9) {
      return null;
    }
    return { w: w / n, x: x / n, y: y / n, z: z / n };
  }

  quatMul(a, b) {
    return {
      w: (a.w * b.w) - (a.x * b.x) - (a.y * b.y) - (a.z * b.z),
      x: (a.w * b.x) + (a.x * b.w) + (a.y * b.z) - (a.z * b.y),
      y: (a.w * b.y) - (a.x * b.z) + (a.y * b.w) + (a.z * b.x),
      z: (a.w * b.z) + (a.x * b.y) - (a.y * b.x) + (a.z * b.w)
    };
  }

  quatConj(q) {
    return { w: q.w, x: -q.x, y: -q.y, z: -q.z };
  }

  quatRotate(q, v) {
    const p = { w: 0, x: v.x, y: v.y, z: v.z };
    const r = this.quatMul(this.quatMul(q, p), this.quatConj(q));
    return { x: r.x, y: r.y, z: r.z };
  }

  sampleBodyAxes(sample) {
    const q = this.sampleOrientation(sample);
    if (!q) {
      return null;
    }
    return {
      forward: this.safeDirection(this.quatRotate(q, { x: 1, y: 0, z: 0 }), { x: 1, y: 0, z: 0 }),
      right: this.safeDirection(this.quatRotate(q, { x: 0, y: 1, z: 0 }), { x: 0, y: 1, z: 0 }),
      up: this.safeDirection(this.quatRotate(q, { x: 0, y: 0, z: 1 }), { x: 0, y: 0, z: 1 })
    };
  }

  warpTiltVector(sample, localUp) {
    const warpVec = this.craftWarpVector(sample);
    if (!warpVec) {
      return null;
    }
    const up = this.safeDirection(localUp || { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 1 });
    const vertical = this.dot3(warpVec, up);
    const tilt = this.sub3(warpVec, this.scale3(up, vertical));
    return {
      warp: warpVec,
      up,
      vertical,
      tilt,
      tiltMag: this.norm3(tilt)
    };
  }

  topAttitudeFromWarpTilt(sample, mode) {
    const tilt = this.warpTiltVector(sample, this.craftLocalUp(sample, mode));
    if (!tilt || !Number.isFinite(tilt.tiltMag) || tilt.tiltMag <= 1e-6) {
      return null;
    }
    return this.normalizeAttitude2D(tilt.tilt.x, tilt.tilt.y, tilt.tiltMag);
  }

  sideAttitudeFromWarpTilt(sample, mode) {
    const tilt = this.warpTiltVector(sample, this.craftLocalUp(sample, mode));
    if (!tilt) {
      return null;
    }

    const frame = this.localFrameFromSample(sample, mode);
    const sideForward = this.safeDirection(frame.forward, { x: 1, y: 0, z: 0 });

    // In profile view, the low side of the craft should indicate the
    // direction of induced fall/drift around the planet.
    const visibleTilt = -this.dot3(tilt.warp, sideForward);
    if (!Number.isFinite(visibleTilt) || Math.abs(visibleTilt) <= 1e-6) {
      return null;
    }
    return this.normalizeAttitude2D(tilt.vertical, visibleTilt, Math.abs(visibleTilt));
  }

  topAttitudeFromOrientation(sample, mode) {
    const axes = this.sampleBodyAxes(sample);
    if (!axes) {
      return this.topAttitudeFromWarpTilt(sample, mode);
    }
    const frame = this.localFrameFromSample(sample, mode);
    let heading = {
      x: this.dot3(axes.forward, frame.forward),
      y: this.dot3(axes.forward, frame.right)
    };
    if (Math.hypot(heading.x, heading.y) <= 1e-6) {
      heading = {
        x: this.dot3(axes.right, frame.forward),
        y: this.dot3(axes.right, frame.right)
      };
    }
    const headingNorm = this.normalizeAttitude2D(heading.x, heading.y, 0);
    const tilt = {
      x: this.dot3(axes.up, frame.forward),
      y: this.dot3(axes.up, frame.right)
    };
    const tiltMag = Math.hypot(tilt.x, tilt.y);
    const tiltNorm = tiltMag > 1e-6 ? { x: tilt.x / tiltMag, y: tilt.y / tiltMag } : { x: 0, y: 0 };
    return {
      headingX: headingNorm ? headingNorm.x : 1,
      headingY: headingNorm ? headingNorm.y : 0,
      tiltX: tiltNorm.x,
      tiltY: tiltNorm.y,
      strength: Math.max(0, Math.min(1, tiltMag))
    };
  }

  sideAttitudeFromOrientation(sample, mode) {
    const axes = this.sampleBodyAxes(sample);
    if (!axes) {
      return this.sideAttitudeFromWarpTilt(sample, mode);
    }
    const frame = this.localFrameFromSample(sample, mode);
    const localUp = frame.up;
    const sideForward = this.safeDirection(frame.forward, { x: 1, y: 0, z: 0 });
    const vertical = this.dot3(axes.up, localUp);
    const visibleTilt = -this.dot3(axes.up, sideForward);
    return {
      headingX: vertical,
      headingY: visibleTilt,
      tiltX: vertical,
      tiltY: visibleTilt,
      strength: Math.max(0, Math.min(1, Math.abs(visibleTilt))),
      angle: Math.atan2(visibleTilt, Math.max(0.05, Math.abs(vertical)))
    };
  }

  normalizeAttitude2D(vx, vy, strengthHint) {
    if (!Number.isFinite(vx) || !Number.isFinite(vy)) {
      return null;
    }
    const n = Math.hypot(vx, vy);
    if (!Number.isFinite(n) || n <= 1e-9) {
      return null;
    }
    const strength = Number.isFinite(strengthHint) ? strengthHint : n;
    return {
      x: vx / n,
      y: vy / n,
      strength: Math.max(0, Math.min(1, strength))
    };
  }

  draw(sample, trailTop, trailSide, trail3D, mapMode) {
    this.drawTop(sample, trailTop, mapMode);
    this.drawSide(sample, trailSide, mapMode);
    this.drawWorld(sample, trail3D, mapMode);
  }

  drawTop(sample, trail, mapMode) {
    const ctx = this.topCtx;
    const canvas = this.topCanvas;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const mode = mapMode === 'local' ? 'local' : 'planetary';

    ctx.clearRect(0, 0, w, h);
    this.paintBackdrop(ctx, w, h);
    this.paintGrid(ctx, w, h);

    if (!sample) {
      this.paintMessage(ctx, w, h, 'Start session to render top-down view');
      return;
    }

    const shipType = String(sample.ship_type || 'saucer').toLowerCase();
    const atmosphere = mode === 'planetary' ? this.sampleAtmosphereSpec(sample) : null;
    let craftX = w * 0.5;
    let craftY = h * 0.5;
    let topScale = 1;
    let craftAttitude = null;
    let topGoalProject = null;
    let navVecX = state.input.navTopX;
    let navVecY = state.input.navTopY;
    const craftTiltAttitude = this.topAttitudeFromOrientation(sample, mode);

    if (mode === 'planetary' && Number.isFinite(sample.primary_radius) && sample.primary_radius > 0) {
      const radius = sample.primary_radius;
      const settings = this.planetaryViewSettings();
      const rx = Number.isFinite(sample.position?.x) && Number.isFinite(sample.primary_position?.x)
        ? (sample.position.x - sample.primary_position.x)
        : 0;
      const ry = Number.isFinite(sample.position?.y) && Number.isFinite(sample.primary_position?.y)
        ? (sample.position.y - sample.primary_position.y)
        : 0;
      const craftPlane = { x: rx, y: ry };
      const anchor = this.planetaryCameraAnchor2D(craftPlane.x, craftPlane.y, settings.follow);
      if (settings.follow) {
        const followRange = this.planetaryFollowRange(sample, radius, 6000);
        topScale = this.planetaryFollowScale(w, h, followRange, settings.zoom);
      } else {
        topScale = this.scaleFromPlanetaryTrail(trail, w, h, radius, (point) => {
          const px = Number.isFinite(point.rx) ? point.rx : 0;
          const py = Number.isFinite(point.ry) ? point.ry : 0;
          return [px - anchor.x, py - anchor.y];
        }, 0.6) * settings.zoom;
      }

      const planetCenterX = w * 0.5 - (anchor.x * topScale);
      const planetCenterY = h * 0.5 + (anchor.y * topScale);
      const planetScreenRadius = radius * topScale;
      if (this.planetaryShouldDrawBodyCircle(planetScreenRadius, w, h, settings.follow)) {
        this.paintPlanetCircle(ctx, planetCenterX, planetCenterY, planetScreenRadius, atmosphere);
      } else {
        this.paintPlanetTopFallback(ctx, w, h, planetCenterX, planetCenterY, atmosphere);
      }

      this.paintTrail(ctx, trail, topScale, w, h, (point) => {
        const p = {
          x: Number.isFinite(point.rx) ? point.rx : 0,
          y: Number.isFinite(point.ry) ? point.ry : 0
        };
        return {
          x: ((p.x - anchor.x) * topScale) + w * 0.5,
          y: h * 0.5 - ((p.y - anchor.y) * topScale)
        };
      }, 'rgba(15, 106, 115, 0.45)');

      const craftProjected = { x: rx, y: ry };
      craftX = w * 0.5 + ((craftProjected.x - anchor.x) * topScale);
      craftY = h * 0.5 - ((craftProjected.y - anchor.y) * topScale);
      topGoalProject = (goalX, goalY) => ({
        x: w * 0.5 + ((goalX - anchor.x) * topScale),
        y: h * 0.5 - ((goalY - anchor.y) * topScale)
      });
      if (state.input.navTopActive && state.input.navTopGoalMode === 'planetary') {
        navVecX = state.input.navTopGoalX - craftProjected.x;
        navVecY = state.input.navTopGoalY - craftProjected.y;
      }

      craftAttitude = craftTiltAttitude;
    } else {
      const anchorX = Number.isFinite(sample.position?.x) ? sample.position.x : 0;
      const anchorY = Number.isFinite(sample.position?.y) ? sample.position.y : 0;
      topScale = this.scaleFromTrail(trail, w, h, (point) => [point.x - anchorX, point.y - anchorY], 1200);
      this.paintTrail(ctx, trail, topScale, w, h, (point) => ({
        x: (point.x - anchorX) * topScale + w * 0.5,
        y: h * 0.5 - (point.y - anchorY) * topScale
      }), 'rgba(15, 106, 115, 0.45)');
      craftX = w * 0.5;
      craftY = h * 0.5;
      topGoalProject = (goalX, goalY) => ({
        x: (goalX - anchorX) * topScale + w * 0.5,
        y: h * 0.5 - (goalY - anchorY) * topScale
      });
      if (state.input.navTopActive && state.input.navTopGoalMode === 'local') {
        navVecX = state.input.navTopGoalX - anchorX;
        navVecY = state.input.navTopGoalY - anchorY;
      }
      craftAttitude = craftTiltAttitude;
    }

    this.paintCraft(ctx, craftX, craftY, '#0f6a73', 'top', shipType, craftAttitude);

    const velScale = mode === 'planetary' ? Math.max(14, topScale * sample.primary_radius * 0.05) : 1.9;
    this.paintArrow(
      ctx,
      craftX,
      craftY,
      craftX + sample.velocity.x * velScale,
      craftY - sample.velocity.y * velScale,
      '#2b4a77'
    );

    const gravScale = mode === 'planetary' ? Math.max(22, topScale * sample.primary_radius * 0.08) : 18;
    this.paintArrow(
      ctx,
      craftX,
      craftY,
      craftX + sample.effective_g.x * gravScale,
      craftY - sample.effective_g.y * gravScale,
      '#9b4d1e'
    );

    const legend = [
      ['craft', '#0f6a73'],
      ['velocity', '#2b4a77'],
      ['gravity', '#9b4d1e']
    ];
    if (mode === 'planetary') {
      legend.unshift([String(sample.primary_name || 'planet').toLowerCase(), '#35617f']);
      if (atmosphere) {
        legend.splice(1, 0, ['atmosphere', atmosphere.legend]);
      }
    }
    this.paintLegend(ctx, w, legend);

    if (state.input.navTopActive && topGoalProject) {
      const goalScreen = topGoalProject(state.input.navTopGoalX, state.input.navTopGoalY);
      const gx = goalScreen.x;
      const gy = goalScreen.y;
      const hvx = Number.parseFloat(sample.velocity?.x) || 0;
      const hvy = Number.parseFloat(sample.velocity?.y) || 0;
      const hvm = Math.hypot(hvx, hvy);
      const gvm = Math.hypot(navVecX, navVecY);
      const align = (hvm > 1e-6 && gvm > 1e-6)
        ? ((hvx * navVecX) + (hvy * navVecY)) / (hvm * gvm)
        : 0;
      const tracking = align > 0.25;
      this.paintGoalFlag(ctx, gx, gy, tracking ? '#17855a' : '#9b4d1e', tracking ? 'TRACK' : 'SEEK');
    }
  }

  drawSide(sample, trail, mapMode) {
    const ctx = this.sideCtx;
    const canvas = this.sideCanvas;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const mode = mapMode === 'local' ? 'local' : 'planetary';

    ctx.clearRect(0, 0, w, h);
    this.paintBackdrop(ctx, w, h);
    this.paintGrid(ctx, w, h);

    if (!sample) {
      this.paintMessage(ctx, w, h, 'Profile view appears here once running');
      return;
    }

    const shipType = String(sample.ship_type || 'saucer').toLowerCase();
    const atmosphere = mode === 'planetary' ? this.sampleAtmosphereSpec(sample) : null;
    let craftX = w * 0.5;
    let craftY = h * 0.5;
    let sideScale = 1;
    let craftAttitude = null;
    const craftTiltAttitude = this.sideAttitudeFromOrientation(sample, mode);
    let velSideX = Number.isFinite(sample.velocity?.x) ? sample.velocity.x : 0;
    let velSideY = mode === 'planetary'
      ? (Number.isFinite(sample.velocity?.z) ? sample.velocity.z : 0)
      : (Number.isFinite(sample.vertical_vel) ? sample.vertical_vel : 0);
    let gravSideX = Number.isFinite(sample.effective_g?.x) ? sample.effective_g.x : 0;
    let gravSideY = Number.isFinite(sample.effective_g?.z) ? sample.effective_g.z : 0;

    if (mode === 'planetary' && Number.isFinite(sample.primary_radius) && sample.primary_radius > 0) {
      const radius = sample.primary_radius;
      const settings = this.planetaryViewSettings();
      const rx = Number.isFinite(sample.position?.x) && Number.isFinite(sample.primary_position?.x)
        ? (sample.position.x - sample.primary_position.x)
        : 0;
      const ry = Number.isFinite(sample.position?.y) && Number.isFinite(sample.primary_position?.y)
        ? (sample.position.y - sample.primary_position.y)
        : 0;
      const rz = Number.isFinite(sample.position?.z) && Number.isFinite(sample.primary_position?.z)
        ? (sample.position.z - sample.primary_position.z)
        : 0;
      const craftProjected = { x: rx, y: rz };
      const anchor = { x: craftProjected.x, y: craftProjected.y };
      const followRange = this.planetaryFollowRange(sample, radius, 4000);
      const localScale = this.planetaryFollowScale(w, h, followRange, settings.zoom);
      const craftDistance = Math.hypot(rx, ry, rz);
      sideScale = this.planetaryProfileScale(w, h, radius, craftDistance, settings.zoom, localScale);

      const planetCenterX = w * 0.5 - (anchor.x * sideScale);
      const planetCenterY = h * 0.5 + (anchor.y * sideScale);
      const planetScreenRadius = radius * sideScale;
      const drawPlanetDisk = this.planetaryShouldDrawBodyCircle(planetScreenRadius, w, h, true);
      if (drawPlanetDisk) {
        this.paintPlanetCircle(ctx, planetCenterX, planetCenterY, planetScreenRadius, atmosphere);
      } else {
        const localSurfaceY = h * 0.5 - ((radius - anchor.y) * sideScale);
        this.paintPlanetHorizonBand(ctx, w, h, planetCenterX, planetCenterY, planetScreenRadius, localSurfaceY, atmosphere);
      }
      this.paintTrail(ctx, trail, sideScale, w, h, (point) => {
        const projected = {
          x: Number.isFinite(point.rx) ? point.rx : 0,
          y: Number.isFinite(point.rz) ? point.rz : 0
        };
        return {
          x: ((projected.x - anchor.x) * sideScale) + w * 0.5,
          y: h * 0.5 - ((projected.y - anchor.y) * sideScale)
        };
      }, 'rgba(88, 125, 47, 0.45)');
      craftX = w * 0.5;
      craftY = h * 0.5;

      const velocityProjected = {
        x: Number.isFinite(sample.velocity?.x) ? sample.velocity.x : 0,
        z: Number.isFinite(sample.velocity?.z) ? sample.velocity.z : 0
      };
      const gravityProjected = {
        x: Number.isFinite(sample.effective_g?.x) ? sample.effective_g.x : 0,
        z: Number.isFinite(sample.effective_g?.z) ? sample.effective_g.z : 0
      };
      craftAttitude = craftTiltAttitude;
      velSideX = velocityProjected.x;
      velSideY = velocityProjected.z;
      gravSideX = gravityProjected.x;
      gravSideY = gravityProjected.z;
    } else {
      const anchorX = Number.isFinite(sample.position?.x) ? sample.position.x : 0;
      const anchorAlt = Number.isFinite(sample.altitude) ? sample.altitude : 0;
      sideScale = this.scaleFromTrail(trail, w, h, (point) => [point.x - anchorX, point.alt - anchorAlt], 800);

      const groundY = h * 0.5 + anchorAlt * sideScale;
      ctx.strokeStyle = 'rgba(120, 95, 66, 0.7)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, groundY);
      ctx.lineTo(w, groundY);
      ctx.stroke();

      this.paintTrail(ctx, trail, sideScale, w, h, (point) => ({
        x: (point.x - anchorX) * sideScale + w * 0.5,
        y: h * 0.5 - (point.alt - anchorAlt) * sideScale
      }), 'rgba(88, 125, 47, 0.45)');
      craftX = w * 0.5;
      craftY = h * 0.5;
      craftAttitude = craftTiltAttitude;
    }

    this.paintCraft(ctx, craftX, craftY, '#587d2f', 'side', shipType, craftAttitude);

    const velScale = mode === 'planetary' ? Math.max(14, sideScale * sample.primary_radius * 0.05) : 1.9;
    this.paintArrow(
      ctx,
      craftX,
      craftY,
      craftX + velSideX * velScale,
      craftY - velSideY * velScale,
      '#2b4a77'
    );

    const gravScale = mode === 'planetary' ? Math.max(22, sideScale * sample.primary_radius * 0.08) : 18;
    this.paintArrow(
      ctx,
      craftX,
      craftY,
      craftX + gravSideX * gravScale,
      craftY - gravSideY * gravScale,
      '#9b4d1e'
    );

    const legend = [
      ['craft', '#587d2f'],
      ['velocity', '#2b4a77'],
      ['gravity', '#9b4d1e']
    ];
    if (mode === 'planetary') {
      legend.unshift([String(sample.primary_name || 'planet').toLowerCase(), '#35617f']);
      if (atmosphere) {
        legend.splice(1, 0, ['atmosphere', atmosphere.legend]);
      }
    }
    this.paintLegend(ctx, w, legend);

    if (state.input.navProfileActive) {
      const gx = w * 0.82;
      const altNow = Math.max(0, Number.parseFloat(sample.altitude) || 0);
      const altGoal = Math.max(0, readNumberInput(state.refs?.autoAltitude, altNow));
      const altErr = altGoal - altNow;
      const gy = (h * 0.5) - (altErr * sideScale);
      const vz = Number.parseFloat(sample.vertical_vel) || 0;
      const reached = Math.abs(altErr) < 50 && Math.abs(vz) < 8;
      const tracking = !reached && ((altErr > 0 && vz > 0) || (altErr < 0 && vz < 0));
      this.paintGoalFlag(
        ctx,
        gx,
        gy,
        reached ? '#17855a' : (tracking ? '#2b4a77' : '#9b4d1e'),
        reached ? 'REACHED' : (tracking ? 'TRACK' : 'SEEK')
      );
    }
  }

  drawWorld(sample, trail, mapMode) {
    const ctx = this.worldCtx;
    const canvas = this.worldCanvas;
    if (!ctx || !canvas) {
      return;
    }
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const mode = mapMode === 'planetary' ? 'planetary' : 'local';

    this.paintWorldBackdrop(ctx, w, h, mode);

    if (!sample) {
      this.paintMessage(ctx, w, h, '3D view appears here once running');
      return;
    }

    if (mode === 'planetary') {
      this.drawWorldPlanetary(ctx, w, h, sample, trail);
    } else {
      this.drawWorldLocal(ctx, w, h, sample, trail);
    }
  }

  drawWorldLocal(ctx, w, h, sample, trail) {
    const craft = { x: 0, y: 0, z: Number.parseFloat(sample.altitude) || 0 };
    const forward = this.safeDirection({
      x: Number.parseFloat(sample.velocity?.x) || 0,
      y: Number.parseFloat(sample.velocity?.y) || 0,
      z: Number.parseFloat(sample.vertical_vel) || 0
    }, { x: 1, y: 0, z: 0 });
    const up = { x: 0, y: 0, z: 1 };
    const camPos = this.add3(craft, this.add3(this.scale3(up, 90), this.scale3(forward, -220)));
    const target = this.add3(craft, this.scale3(forward, 140));
    camPos = this.applyWorldOrbit(target, camPos, up);
    const projector = this.makeProjector(camPos, target, up, w, h, 62);

    this.paintWorldGroundGrid(ctx, projector, 1500, 150, 'rgba(121, 102, 69, 0.46)');
    this.paintWorldHorizon(ctx, projector, 2200, 'rgba(72, 93, 121, 0.36)');

    const localTrail = Array.isArray(trail)
      ? trail.map((point) => ({
        x: (Number.parseFloat(point.x) || 0) - (Number.parseFloat(sample.position?.x) || 0),
        y: (Number.parseFloat(point.y) || 0) - (Number.parseFloat(sample.position?.y) || 0),
        z: Number.parseFloat(point.alt) || 0
      }))
      : [];
    this.paintWorldTrail(ctx, localTrail, projector, 'rgba(66, 135, 144, 0.72)', 2.2);

    const shipType = String(sample.ship_type || 'saucer').toLowerCase();
    this.paintWorldShip(ctx, projector, craft, shipType, '#0f6a73', sample, camPos);

    const vel3 = {
      x: Number.parseFloat(sample.velocity?.x) || 0,
      y: Number.parseFloat(sample.velocity?.y) || 0,
      z: Number.parseFloat(sample.vertical_vel) || 0
    };
    const g3 = {
      x: Number.parseFloat(sample.effective_g?.x) || 0,
      y: Number.parseFloat(sample.effective_g?.y) || 0,
      z: Number.parseFloat(sample.effective_g?.z) || 0
    };
    const velScale = Math.min(260, this.norm3(vel3) * 9);
    const gravScale = Math.min(180, this.norm3(g3) * 18);
    this.paintWorldVector(ctx, projector, craft, this.scale3(this.safeDirection(vel3, { x: 1, y: 0, z: 0 }), velScale), '#2b4a77');
    this.paintWorldVector(ctx, projector, craft, this.scale3(this.safeDirection(g3, { x: 0, y: 0, z: -1 }), gravScale), '#9b4d1e');

    this.paintLegend(ctx, w, [
      ['3d craft', '#0f6a73'],
      ['velocity', '#2b4a77'],
      ['gravity', '#9b4d1e'],
      ['flat map', '#796645']
    ]);
  }

  drawWorldPlanetary(ctx, w, h, sample, trail) {
    if (!Number.isFinite(sample.primary_radius) || sample.primary_radius <= 0) {
      this.drawWorldLocal(ctx, w, h, sample, trail);
      return;
    }

    const craft = {
      x: (Number.parseFloat(sample.position?.x) || 0) - (Number.parseFloat(sample.primary_position?.x) || 0),
      y: (Number.parseFloat(sample.position?.y) || 0) - (Number.parseFloat(sample.primary_position?.y) || 0),
      z: (Number.parseFloat(sample.position?.z) || 0) - (Number.parseFloat(sample.primary_position?.z) || 0)
    };
    const up = this.safeDirection(craft, { x: 0, y: 0, z: 1 });
    const vel = {
      x: Number.parseFloat(sample.velocity?.x) || 0,
      y: Number.parseFloat(sample.velocity?.y) || 0,
      z: Number.parseFloat(sample.velocity?.z) || 0
    };
    const vDotUp = this.dot3(vel, up);
    const velTangent = this.sub3(vel, this.scale3(up, vDotUp));
    const forward = this.safeDirection(velTangent, this.crossFallback(up));

    const radius = Number.parseFloat(sample.primary_radius) || 1;
    const atmosphere = this.sampleAtmosphereSpec(sample);
    const settings = this.planetaryViewSettings();
    const zoomInv = 1 / Math.max(0.25, settings.zoom);
    let camPos;
    let target;
    if (settings.follow) {
      const alt = Math.max(0, this.norm3(craft) - radius);
      const altBlend = Math.max(0, Math.min(1, alt / Math.max(1, radius * 0.35)));
      const upDist = this.lerp(radius * 0.035, radius * 0.15, altBlend);
      const backDist = this.lerp(radius * 0.12, radius * 0.34, altBlend);
      camPos = this.add3(craft, this.add3(
        this.scale3(up, (upDist + 1800) * zoomInv),
        this.scale3(forward, -(backDist + 4200) * zoomInv)
      ));
      target = this.add3(craft, this.scale3(forward, Math.max(500, radius * 0.012)));
    } else {
      camPos = {
        x: (radius * 1.6) * zoomInv,
        y: (-radius * 1.4) * zoomInv,
        z: (radius * 1.1) * zoomInv
      };
      target = craft;
    }
    const upHint = settings.lockRoll ? { x: 0, y: 0, z: 1 } : up;
    camPos = this.applyWorldOrbit(target, camPos, upHint);
    const projector = this.makeProjector(camPos, target, upHint, w, h, 60);

    this.paintWorldGlobe(ctx, projector, radius, atmosphere);

    const globeTrail = Array.isArray(trail)
      ? trail.map((point) => ({
        x: Number.parseFloat(point.rx) || 0,
        y: Number.parseFloat(point.ry) || 0,
        z: Number.parseFloat(point.rz) || 0
      }))
      : [];
    this.paintWorldTrail(ctx, globeTrail, projector, 'rgba(72, 151, 128, 0.78)', 2.1);

    const shipType = String(sample.ship_type || 'saucer').toLowerCase();
    const span = Number.parseFloat(sample.craft_span_m);
    const shipVisualLift = Math.max(20, Number.isFinite(span) ? (span * 0.35) : 20);
    const craftVisual = this.add3(craft, this.scale3(up, shipVisualLift));

    const velScale = radius * 0.028;
    const gravScale = radius * 0.022;
    const g3 = {
      x: Number.parseFloat(sample.effective_g?.x) || 0,
      y: Number.parseFloat(sample.effective_g?.y) || 0,
      z: Number.parseFloat(sample.effective_g?.z) || 0
    };
    this.paintWorldVector(ctx, projector, craftVisual, this.scale3(this.safeDirection(vel, forward), velScale), '#2b4a77');
    this.paintWorldVector(ctx, projector, craftVisual, this.scale3(this.safeDirection(g3, this.scale3(up, -1)), gravScale), '#9b4d1e');
    this.paintWorldShip(ctx, projector, craftVisual, shipType, '#3c7b62', sample, camPos);

    this.paintLegend(ctx, w, [
      [`${String(sample.primary_name || 'planet').toLowerCase()} globe`, '#35617f'],
      ...(atmosphere ? [['atmosphere', atmosphere.legend]] : []),
      ['craft', '#3c7b62'],
      ['velocity', '#2b4a77'],
      ['gravity', '#9b4d1e']
    ]);
  }

  paintWorldBackdrop(ctx, w, h, mode) {
    ctx.clearRect(0, 0, w, h);
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    if (mode === 'planetary') {
      gradient.addColorStop(0, '#101f31');
      gradient.addColorStop(1, '#223950');
    } else {
      gradient.addColorStop(0, '#f2fbff');
      gradient.addColorStop(1, '#e6efe0');
    }
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
  }

  paintWorldTrail(ctx, points, projector, color, width) {
    if (!Array.isArray(points) || points.length < 2) {
      return;
    }
    const segCount = points.length - 1;
    const coreWidth = Number.isFinite(width) && width > 0 ? width : 2;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 1; i < points.length; i += 1) {
      const a = projector(points[i - 1]);
      const b = projector(points[i]);
      if (!a || !b) {
        continue;
      }
      const age = i / segCount;
      const glowAlpha = 0.02 + (Math.pow(age, 1.8) * 0.2);
      const coreAlpha = 0.04 + (Math.pow(age, 1.6) * 0.74);

      ctx.strokeStyle = this.trailColorWithAlpha(color, glowAlpha);
      ctx.lineWidth = coreWidth * (1.9 + (age * 0.7));
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();

      ctx.strokeStyle = this.trailColorWithAlpha(color, coreAlpha);
      ctx.lineWidth = coreWidth * (0.45 + (age * 0.72));
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  paintWorldVector(ctx, projector, origin, vec, color) {
    const a = projector(origin);
    const b = projector(this.add3(origin, vec));
    if (!a || !b) {
      return;
    }
    this.paintArrow(ctx, a.x, a.y, b.x, b.y, color);
  }

  paintWorldSegment(ctx, projector, from, to, color, width = 1) {
    const a = projector(from);
    const b = projector(to);
    if (!a || !b) {
      return;
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  paintWorldGroundGrid(ctx, projector, range, spacing, color) {
    for (let x = -range; x <= range; x += spacing) {
      this.paintWorldSegment(
        ctx,
        projector,
        { x, y: -range, z: 0 },
        { x, y: range, z: 0 },
        color
      );
    }
    for (let y = -range; y <= range; y += spacing) {
      this.paintWorldSegment(
        ctx,
        projector,
        { x: -range, y, z: 0 },
        { x: range, y, z: 0 },
        color
      );
    }
  }

  paintWorldHorizon(ctx, projector, range, color) {
    this.paintWorldSegment(
      ctx,
      projector,
      { x: -range, y: 0, z: 0 },
      { x: range, y: 0, z: 0 },
      color,
      1.6
    );
  }

  paintWorldGlobe(ctx, projector, radius, atmosphere = null) {
    const center = projector({ x: 0, y: 0, z: 0 });
    if (!center) {
      return;
    }
    const cameraRight = projector.cameraRight;
    const cameraUp = projector.cameraUp;
    if (!cameraRight || !cameraUp) {
      return;
    }
    const rightEdge = projector({
      x: cameraRight.x * radius,
      y: cameraRight.y * radius,
      z: cameraRight.z * radius
    });
    const upEdge = projector({
      x: cameraUp.x * radius,
      y: cameraUp.y * radius,
      z: cameraUp.z * radius
    });
    if (!rightEdge || !upEdge) {
      return;
    }
    const screenRadius = Math.max(
      Math.hypot(rightEdge.x - center.x, rightEdge.y - center.y),
      Math.hypot(upEdge.x - center.x, upEdge.y - center.y)
    );
    if (!Number.isFinite(screenRadius) || screenRadius <= 1) {
      return;
    }
    if (atmosphere) {
      const outerEdge = projector({ x: radius + atmosphere.shellHeight, y: 0, z: 0 });
      const outerRadius = outerEdge
        ? Math.hypot(outerEdge.x - center.x, outerEdge.y - center.y)
        : (screenRadius + this.atmosphereThicknessPx(screenRadius, atmosphere));
      this.paintAtmosphereAnnulus(ctx, center.x, center.y, screenRadius, outerRadius, atmosphere);
    }
    const radial = ctx.createRadialGradient(
      center.x - (screenRadius * 0.25),
      center.y - (screenRadius * 0.3),
      screenRadius * 0.25,
      center.x,
      center.y,
      screenRadius
    );
    radial.addColorStop(0, 'rgba(105, 174, 195, 0.93)');
    radial.addColorStop(1, 'rgba(42, 84, 118, 0.96)');
    ctx.fillStyle = radial;
    ctx.beginPath();
    ctx.arc(center.x, center.y, screenRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(18, 55, 82, 0.95)';
    ctx.lineWidth = 2;
    ctx.stroke();
    this.paintWorldGraticule(ctx, projector, radius);
  }

  paintWorldGraticule(ctx, projector, radius) {
    if (!Number.isFinite(radius) || radius <= 1) {
      return;
    }
    const camPos = projector.cameraPos;
    if (!camPos) {
      return;
    }
    const isVisible = (p) => {
      const normal = this.safeDirection(p, { x: 0, y: 0, z: 1 });
      const toCam = this.safeDirection(this.sub3(camPos, p), { x: 0, y: 0, z: 1 });
      return this.dot3(normal, toCam) > 0;
    };
    const latStep = 15;
    const lonStep = 15;
    ctx.save();
    ctx.strokeStyle = 'rgba(210, 236, 225, 0.20)';
    ctx.lineWidth = 1;
    for (let lat = -60; lat <= 60; lat += latStep) {
      const latR = (lat * Math.PI) / 180;
      let first = true;
      ctx.beginPath();
      for (let lon = 0; lon <= 360; lon += 6) {
        const lonR = (lon * Math.PI) / 180;
        const wp = {
          x: radius * Math.cos(latR) * Math.cos(lonR),
          y: radius * Math.cos(latR) * Math.sin(lonR),
          z: radius * Math.sin(latR)
        };
        if (!isVisible(wp)) {
          first = true;
          continue;
        }
        const p = projector(wp);
        if (!p) {
          first = true;
          continue;
        }
        if (first) {
          ctx.moveTo(p.x, p.y);
          first = false;
        } else {
          ctx.lineTo(p.x, p.y);
        }
      }
      ctx.stroke();
    }
    for (let lon = 0; lon < 360; lon += lonStep) {
      const lonR = (lon * Math.PI) / 180;
      let first = true;
      ctx.beginPath();
      for (let lat = -89; lat <= 89; lat += 4) {
        const latR = (lat * Math.PI) / 180;
        const wp = {
          x: radius * Math.cos(latR) * Math.cos(lonR),
          y: radius * Math.cos(latR) * Math.sin(lonR),
          z: radius * Math.sin(latR)
        };
        if (!isVisible(wp)) {
          first = true;
          continue;
        }
        const p = projector(wp);
        if (!p) {
          first = true;
          continue;
        }
        if (first) {
          ctx.moveTo(p.x, p.y);
          first = false;
        } else {
          ctx.lineTo(p.x, p.y);
        }
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  paintWorldShip(ctx, projector, point, shipType, color, sample = null, cameraPos = null) {
    const p = projector(point);
    if (!p) {
      return;
    }
    const span = Number.parseFloat(sample?.craft_span_m);
    const scaleFactor = Number.isFinite(span) && span > 0 ? Math.sqrt(span / CRAFT_LAZAR_SPAN_M) : 1;
    const size = Math.max(8, Math.min(28, (760 / Math.max(70, p.depth)) * scaleFactor));
    const type = String(shipType || 'saucer').toLowerCase();
    const axes = this.sampleBodyAxes(sample);
    const viewDir = cameraPos ? this.safeDirection(this.sub3(point, cameraPos), { x: 1, y: 0, z: 0 }) : { x: 1, y: 0, z: 0 };
    const offset = Math.max(6, (Number.isFinite(span) ? span : CRAFT_LAZAR_SPAN_M) * 0.35);
    const forwardTip = axes ? projector(this.add3(point, this.scale3(axes.forward, offset))) : null;
    const projectedHeading = forwardTip
      ? this.normalizeAttitude2D(forwardTip.x - p.x, p.y - forwardTip.y, 1)
      : null;
    const headingAngle = projectedHeading ? Math.atan2(-projectedHeading.y, projectedHeading.x) : 0;
    const tiltTip = axes ? projector(this.add3(point, this.scale3(axes.up, offset))) : null;
    const projectedTilt = tiltTip
      ? this.normalizeAttitude2D(tiltTip.x - p.x, p.y - tiltTip.y, 1)
      : null;
    const faceRatio = axes ? Math.abs(this.dot3(axes.up, viewDir)) : 1;
    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(5, size * 0.72), 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(210, 255, 236, 0.22)';
    ctx.fill();
    ctx.fillStyle = color;
    if (type === 'sphere') {
      ctx.beginPath();
      ctx.arc(p.x, p.y, size * 0.72, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }
    ctx.translate(p.x, p.y);
    if (projectedHeading) {
      ctx.rotate(headingAngle);
    }
    if (type === 'egg') {
      ctx.beginPath();
      ctx.ellipse(0, 0, size * 0.6, size * 0.85, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      if (projectedTilt) {
        this.paintCraftTiltIndicator(ctx, p.x, p.y, projectedTilt.x, projectedTilt.y, 'rgba(12, 52, 60, 0.72)', 8);
      }
      return;
    }

    if (type === 'pyramid') {
      ctx.beginPath();
      ctx.moveTo(0, -(size * 0.92));
      ctx.lineTo(-(size * 0.86), size * 0.74);
      ctx.lineTo(size * 0.86, size * 0.74);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      if (projectedTilt) {
        this.paintCraftTiltIndicator(ctx, p.x, p.y, projectedTilt.x, projectedTilt.y, 'rgba(12, 52, 60, 0.72)', 8);
      }
      return;
    }

    if (type === 'flat_triangle') {
      ctx.beginPath();
      ctx.moveTo(0, -(size * 0.46));
      ctx.lineTo(-(size * 1.15), size * 0.34);
      ctx.lineTo(size * 1.15, size * 0.34);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      if (projectedTilt) {
        this.paintCraftTiltIndicator(ctx, p.x, p.y, projectedTilt.x, projectedTilt.y, 'rgba(12, 52, 60, 0.72)', 8);
      }
      return;
    }
    const minor = Math.max(size * 0.26, size * Math.max(0.36, faceRatio));
    ctx.beginPath();
    ctx.ellipse(0, 0, size, minor, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.36)';
    ctx.beginPath();
    ctx.ellipse(0, -(size * 0.16), size * 0.46, Math.max(size * 0.16, minor * 0.42), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    if (projectedTilt) {
      this.paintCraftTiltIndicator(ctx, p.x, p.y, projectedTilt.x, projectedTilt.y, 'rgba(12, 52, 60, 0.72)', 8.5);
    }
  }

  makeProjector(cameraPos, target, upHint, w, h, fovDeg) {
    const forward = this.safeDirection(this.sub3(target, cameraPos), { x: 1, y: 0, z: 0 });
    let right = this.cross3(forward, upHint);
    if (this.norm3(right) <= 1e-6) {
      right = this.cross3(forward, { x: 0, y: 0, z: 1 });
    }
    right = this.safeDirection(right, { x: 1, y: 0, z: 0 });
    const up = this.safeDirection(this.cross3(right, forward), { x: 0, y: 0, z: 1 });
    const near = 1;
    const focal = (Math.min(w, h) * 0.5) / Math.tan((fovDeg * Math.PI) / 360);

    const project = (point) => {
      const rel = this.sub3(point, cameraPos);
      const cx = this.dot3(rel, right);
      const cy = this.dot3(rel, up);
      const cz = this.dot3(rel, forward);
      if (!Number.isFinite(cz) || cz <= near) {
        return null;
      }
      return {
        x: (w * 0.5) + (cx * focal / cz),
        y: (h * 0.5) - (cy * focal / cz),
        depth: cz
      };
    };
    project.cameraPos = cameraPos;
    project.cameraForward = forward;
    project.cameraRight = right;
    project.cameraUp = up;
    return project;
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

  trailColorWithAlpha(color, alpha) {
    const a = Math.max(0, Math.min(1, Number.isFinite(alpha) ? alpha : 0));
    const match = String(color || '').match(/rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)/i);
    if (match) {
      return `rgba(${match[1]}, ${match[2]}, ${match[3]}, ${a.toFixed(3)})`;
    }
    return color;
  }

  paintTrail(ctx, trail, scale, w, h, projector, color) {
    if (!trail || trail.length < 2) {
      return;
    }
    const segCount = trail.length - 1;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 1; i < trail.length; i += 1) {
      const a = projector(trail[i - 1], scale, w, h);
      const b = projector(trail[i], scale, w, h);
      if (!a || !b) {
        continue;
      }
      const age = i / segCount;
      const glowAlpha = 0.02 + (Math.pow(age, 1.8) * 0.16);
      const coreAlpha = 0.05 + (Math.pow(age, 1.5) * 0.64);

      ctx.strokeStyle = this.trailColorWithAlpha(color, glowAlpha);
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();

      ctx.strokeStyle = this.trailColorWithAlpha(color, coreAlpha);
      ctx.lineWidth = 1.55 + (age * 0.65);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  paintAtmosphereAnnulus(ctx, x, y, innerRadius, outerRadius, atmosphere) {
    if (!atmosphere || !Number.isFinite(innerRadius) || !Number.isFinite(outerRadius) || outerRadius <= innerRadius) {
      return;
    }
    const glow = ctx.createRadialGradient(x, y, innerRadius, x, y, outerRadius);
    glow.addColorStop(0, 'rgba(255, 255, 255, 0)');
    glow.addColorStop(0.45, atmosphere.glowInner);
    glow.addColorStop(1, atmosphere.glowOuter);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, outerRadius, 0, Math.PI * 2);
    ctx.arc(x, y, innerRadius, 0, Math.PI * 2, true);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = atmosphere.line;
    ctx.lineWidth = Math.max(1, (outerRadius - innerRadius) * 0.22);
    ctx.beginPath();
    ctx.arc(x, y, outerRadius - ((outerRadius - innerRadius) * 0.3), 0, Math.PI * 2);
    ctx.stroke();
  }

  paintPlanetCircle(ctx, x, y, radius, atmosphere = null) {
    if (!Number.isFinite(radius) || radius <= 0.2) {
      return;
    }
    const atmosphereThickness = this.atmosphereThicknessPx(radius, atmosphere);
    if (atmosphereThickness > 0) {
      this.paintAtmosphereAnnulus(ctx, x, y, radius, radius + atmosphereThickness, atmosphere);
    }
    const radial = ctx.createRadialGradient(
      x - radius * 0.3,
      y - radius * 0.35,
      radius * 0.2,
      x,
      y,
      radius
    );
    radial.addColorStop(0, 'rgba(94, 154, 180, 0.82)');
    radial.addColorStop(1, 'rgba(53, 97, 127, 0.90)');
    ctx.fillStyle = radial;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(19, 54, 78, 0.85)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  paintPlanetHorizonBand(ctx, w, h, centerX, centerY, radius, surfaceYFallback, atmosphere = null) {
    const fallbackY = Number.isFinite(surfaceYFallback) ? Math.max(-h, Math.min(h * 2, surfaceYFallback)) : (h * 0.5);
    if (!Number.isFinite(centerX) || !Number.isFinite(centerY) || !Number.isFinite(radius) || radius <= 1) {
      this.paintPlanetHorizonFlat(ctx, w, h, fallbackY, atmosphere);
      return;
    }

    const segments = Math.max(28, Math.min(120, Math.floor(w / 10)));
    const limb = [];
    for (let i = 0; i <= segments; i += 1) {
      const x = (w * i) / segments;
      const dx = x - centerX;
      const inside = (radius * radius) - (dx * dx);
      if (inside <= 0) {
        continue;
      }
      const y = centerY - Math.sqrt(inside);
      if (Number.isFinite(y)) {
        limb.push({ x, y });
      }
    }

    if (limb.length < 2) {
      this.paintPlanetHorizonFlat(ctx, w, h, fallbackY, atmosphere);
      return;
    }

    const atmosphereThickness = this.atmosphereThicknessPx(radius, atmosphere);
    if (atmosphereThickness > 0) {
      const outerRadius = radius + atmosphereThickness;
      const outerLimb = [];
      for (let i = 0; i <= segments; i += 1) {
        const x = (w * i) / segments;
        const dx = x - centerX;
        const inside = (outerRadius * outerRadius) - (dx * dx);
        if (inside <= 0) {
          continue;
        }
        const y = centerY - Math.sqrt(inside);
        if (Number.isFinite(y)) {
          outerLimb.push({ x, y });
        }
      }
      if (outerLimb.length >= 2) {
        const skyFill = ctx.createLinearGradient(0, outerLimb[0].y, 0, limb[Math.floor(limb.length * 0.5)].y);
        skyFill.addColorStop(0, atmosphere.fillTop);
        skyFill.addColorStop(1, atmosphere.fillBottom);
        ctx.fillStyle = skyFill;
        ctx.beginPath();
        ctx.moveTo(outerLimb[0].x, outerLimb[0].y);
        for (let i = 1; i < outerLimb.length; i += 1) {
          ctx.lineTo(outerLimb[i].x, outerLimb[i].y);
        }
        for (let i = limb.length - 1; i >= 0; i -= 1) {
          ctx.lineTo(limb[i].x, limb[i].y);
        }
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = atmosphere.line;
        ctx.lineWidth = Math.max(1, atmosphereThickness * 0.3);
        ctx.beginPath();
        ctx.moveTo(outerLimb[0].x, outerLimb[0].y);
        for (let i = 1; i < outerLimb.length; i += 1) {
          ctx.lineTo(outerLimb[i].x, outerLimb[i].y);
        }
        ctx.stroke();
      }
    }

    const mid = limb[Math.floor(limb.length * 0.5)];
    const yMid = Number.isFinite(mid?.y) ? mid.y : fallbackY;
    const fill = ctx.createLinearGradient(0, yMid, 0, h);
    fill.addColorStop(0, 'rgba(94, 154, 180, 0.28)');
    fill.addColorStop(1, 'rgba(53, 97, 127, 0.82)');
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(limb[0].x, h);
    ctx.lineTo(limb[0].x, limb[0].y);
    for (let i = 1; i < limb.length; i += 1) {
      ctx.lineTo(limb[i].x, limb[i].y);
    }
    ctx.lineTo(limb[limb.length - 1].x, h);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = 'rgba(19, 54, 78, 0.86)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(limb[0].x, limb[0].y);
    for (let i = 1; i < limb.length; i += 1) {
      ctx.lineTo(limb[i].x, limb[i].y);
    }
    ctx.stroke();
  }

  paintPlanetHorizonFlat(ctx, w, h, y, atmosphere = null) {
    const yy = Math.max(-h, Math.min(h * 2, y));
    const atmosphereThickness = this.atmosphereThicknessPx(Math.max(w, h) * 0.3, atmosphere);
    if (atmosphere && atmosphereThickness > 0) {
      const sky = ctx.createLinearGradient(0, yy - atmosphereThickness, 0, yy);
      sky.addColorStop(0, atmosphere.fillTop);
      sky.addColorStop(1, atmosphere.fillBottom);
      ctx.fillStyle = sky;
      ctx.fillRect(0, yy - atmosphereThickness, w, atmosphereThickness);
      ctx.strokeStyle = atmosphere.line;
      ctx.lineWidth = Math.max(1, atmosphereThickness * 0.26);
      ctx.beginPath();
      ctx.moveTo(0, yy - (atmosphereThickness * 0.45));
      ctx.lineTo(w, yy - (atmosphereThickness * 0.45));
      ctx.stroke();
    }
    const fill = ctx.createLinearGradient(0, yy, 0, h);
    fill.addColorStop(0, 'rgba(94, 154, 180, 0.24)');
    fill.addColorStop(1, 'rgba(53, 97, 127, 0.76)');
    ctx.fillStyle = fill;
    ctx.fillRect(0, yy, w, h - yy);

    ctx.strokeStyle = 'rgba(19, 54, 78, 0.78)';
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    ctx.moveTo(0, yy);
    ctx.lineTo(w, yy);
    ctx.stroke();
  }

  paintPlanetTopFallback(ctx, w, h, centerX, centerY, atmosphere = null) {
    const radius = Math.max(w, h) * 1.15;
    const atmosphereThickness = this.atmosphereThicknessPx(Math.max(w, h) * 0.9, atmosphere);
    const radial = ctx.createRadialGradient(
      centerX - (radius * 0.18),
      centerY - (radius * 0.22),
      radius * 0.18,
      centerX,
      centerY,
      radius
    );
    radial.addColorStop(0, 'rgba(105, 174, 195, 0.58)');
    radial.addColorStop(1, 'rgba(42, 84, 118, 0.52)');
    ctx.fillStyle = radial;
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(19, 54, 78, 0.52)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(centerX, centerY, Math.max(w, h) * 0.9, 0, Math.PI * 2);
    ctx.stroke();
    if (atmosphere && atmosphereThickness > 0) {
      ctx.strokeStyle = atmosphere.line;
      ctx.lineWidth = Math.max(1, atmosphereThickness * 0.32);
      ctx.beginPath();
      ctx.arc(centerX, centerY, (Math.max(w, h) * 0.9) + (atmosphereThickness * 0.45), 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  paintCraft(ctx, x, y, color, view, shipType, attitude) {
    const type = String(shipType || 'saucer').toLowerCase();
    const mode = view === 'side' ? 'side' : 'top';
    const headingAtt = this.normalizeAttitude2D(
      Number.isFinite(attitude?.headingX) ? attitude.headingX : (Number.isFinite(attitude?.x) ? attitude.x : NaN),
      Number.isFinite(attitude?.headingY) ? attitude.headingY : (Number.isFinite(attitude?.y) ? attitude.y : NaN),
      1
    );
    const tiltAtt = this.normalizeAttitude2D(
      Number.isFinite(attitude?.tiltX) ? attitude.tiltX : (Number.isFinite(attitude?.x) ? attitude.x : NaN),
      Number.isFinite(attitude?.tiltY) ? attitude.tiltY : (Number.isFinite(attitude?.y) ? attitude.y : NaN),
      Number.isFinite(attitude?.strength) ? attitude.strength : NaN
    );
    const heading = headingAtt ? Math.atan2(-headingAtt.y, headingAtt.x) : 0;
    const tiltRatio = Number.isFinite(attitude?.strength) ? Math.max(0, Math.min(1, attitude.strength)) : (tiltAtt ? tiltAtt.strength : 0);
    const sideTiltAngle = Number.isFinite(attitude?.angle)
      ? Math.max(-Math.PI / 3, Math.min(Math.PI / 3, attitude.angle))
      : (tiltAtt
        ? Math.max(-Math.PI / 3, Math.min(Math.PI / 3, Math.atan2(tiltAtt.y, Math.max(0.05, Math.abs(tiltAtt.x)))))
        : 0);

    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;

    if (mode === 'top') {
      if (headingAtt && (type === 'egg' || type === 'pyramid' || type === 'flat_triangle')) {
        ctx.rotate(heading);
      }

      if (type === 'sphere') {
        ctx.beginPath();
        ctx.arc(0, 0, 6.5, 0, Math.PI * 2);
        ctx.fill();
      } else if (type === 'egg') {
        ctx.beginPath();
        ctx.ellipse(0, 0, 5.6, 7.4, 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (type === 'pyramid') {
        ctx.beginPath();
        ctx.moveTo(0, -8.2);
        ctx.lineTo(-6.8, 6.4);
        ctx.lineTo(6.8, 6.4);
        ctx.closePath();
        ctx.fill();
      } else if (type === 'flat_triangle') {
        ctx.beginPath();
        ctx.moveTo(0, -5.9);
        ctx.lineTo(-8.4, 3.6);
        ctx.lineTo(8.4, 3.6);
        ctx.closePath();
        ctx.fill();
      } else {
        if (headingAtt) {
          ctx.rotate(heading);
        }
        const major = 7;
        const minor = Math.max(3.9, major * (1 - (0.42 * tiltRatio)));
        ctx.beginPath();
        ctx.ellipse(0, 0, major, minor, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.36)';
        const hx = tiltAtt ? (-tiltAtt.x * 2.1) : 0;
        const hy = tiltAtt ? (tiltAtt.y * 2.1) : -1.2;
        ctx.beginPath();
        ctx.arc(hx, hy, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      if (tiltAtt) {
        this.paintCraftTiltIndicator(ctx, x, y, tiltAtt.x, tiltAtt.y, 'rgba(21, 47, 73, 0.72)', 10);
      }
      return;
    }

    if (tiltAtt && type !== 'sphere') {
      ctx.rotate(-sideTiltAngle);
    }

    if (type === 'sphere') {
      ctx.beginPath();
      ctx.arc(0, 0, 5.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      if (tiltAtt) {
        this.paintCraftTiltIndicator(ctx, x, y, tiltAtt.x, tiltAtt.y, 'rgba(21, 47, 73, 0.72)', 8);
      }
      return;
    }

    if (type === 'egg') {
      ctx.beginPath();
      ctx.ellipse(0.6, 0, 4.7, 6.9, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      if (tiltAtt) {
        this.paintCraftTiltIndicator(ctx, x, y, tiltAtt.x, tiltAtt.y, 'rgba(21, 47, 73, 0.72)', 8.5);
      }
      return;
    }

    if (type === 'pyramid') {
      ctx.beginPath();
      ctx.moveTo(0, -6.8);
      ctx.lineTo(-7.4, 6.2);
      ctx.lineTo(7.4, 6.2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      if (tiltAtt) {
        this.paintCraftTiltIndicator(ctx, x, y, tiltAtt.x, tiltAtt.y, 'rgba(21, 47, 73, 0.72)', 8.5);
      }
      return;
    }

    if (type === 'flat_triangle') {
      ctx.beginPath();
      ctx.moveTo(-9, 2.5);
      ctx.lineTo(9, 2.5);
      ctx.lineTo(0, -2.8);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      if (tiltAtt) {
        this.paintCraftTiltIndicator(ctx, x, y, tiltAtt.x, tiltAtt.y, 'rgba(21, 47, 73, 0.72)', 8.5);
      }
      return;
    }

    ctx.lineWidth = 3.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-9, 0);
    ctx.lineTo(9, 0);
    ctx.stroke();
    ctx.restore();
    if (tiltAtt) {
      this.paintCraftTiltIndicator(ctx, x, y, tiltAtt.x, tiltAtt.y, 'rgba(21, 47, 73, 0.72)', 8.5);
    }
  }

  paintCraftTiltIndicator(ctx, x, y, vx, vy, color, length = 9) {
    if (!Number.isFinite(vx) || !Number.isFinite(vy)) {
      return;
    }
    const n = Math.hypot(vx, vy);
    if (!Number.isFinite(n) || n <= 1e-9) {
      return;
    }
    const ux = vx / n;
    const uy = vy / n;
    this.paintArrow(
      ctx,
      x,
      y,
      x + (ux * length),
      y - (uy * length),
      color
    );
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

  paintGoalFlag(ctx, x, y, color, label = 'GOAL') {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return;
    }
    const poleH = 12;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y - poleH);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y - poleH);
    ctx.lineTo(x + 9, y - poleH + 3);
    ctx.lineTo(x, y - poleH + 6);
    ctx.closePath();
    ctx.fill();
    ctx.font = '10px "IBM Plex Mono", monospace';
    ctx.fillStyle = 'rgba(22, 38, 45, 0.92)';
    ctx.fillText(label, x + 11, y - poleH + 6);
    ctx.restore();
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

  scaleFromPlanetaryTrail(trail, w, h, bodyRadius, project, minimumRadiusPad) {
    let maxRange = Number.isFinite(bodyRadius) && bodyRadius > 0 ? bodyRadius * (1 + minimumRadiusPad) : 1;
    if (Array.isArray(trail) && trail.length > 0) {
      for (let i = 0; i < trail.length; i += 1) {
        const [dx, dy] = project(trail[i]);
        const r = Math.hypot(dx, dy);
        if (Number.isFinite(r)) {
          maxRange = Math.max(maxRange, r * 1.04);
        }
      }
    }
    if (!Number.isFinite(maxRange) || maxRange <= 1) {
      maxRange = 1;
    }
    return Math.min(w, h) / (maxRange * 2.2);
  }

  add3(a, b) {
    return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
  }

  sub3(a, b) {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
  }

  scale3(v, s) {
    return { x: v.x * s, y: v.y * s, z: v.z * s };
  }

  dot3(a, b) {
    return (a.x * b.x) + (a.y * b.y) + (a.z * b.z);
  }

  cross3(a, b) {
    return {
      x: (a.y * b.z) - (a.z * b.y),
      y: (a.z * b.x) - (a.x * b.z),
      z: (a.x * b.y) - (a.y * b.x)
    };
  }

  norm3(v) {
    return Math.hypot(v.x, v.y, v.z);
  }

  safeDirection(v, fallback) {
    const n = this.norm3(v);
    if (!Number.isFinite(n) || n <= 1e-9) {
      return fallback;
    }
    return this.scale3(v, 1 / n);
  }

  crossFallback(up) {
    let guess = this.cross3(up, { x: 0, y: 0, z: 1 });
    if (this.norm3(guess) <= 1e-6) {
      guess = this.cross3(up, { x: 0, y: 1, z: 0 });
    }
    return this.safeDirection(guess, { x: 1, y: 0, z: 0 });
  }

  lerp(a, b, t) {
    return a + (b - a) * t;
  }

  rotateAroundAxis(v, axis, angle) {
    const k = this.safeDirection(axis, { x: 0, y: 0, z: 1 });
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const kv = this.cross3(k, v);
    const kdot = this.dot3(k, v);
    return this.add3(
      this.scale3(v, cosA),
      this.add3(
        this.scale3(kv, sinA),
        this.scale3(k, kdot * (1 - cosA))
      )
    );
  }

  applyWorldOrbit(target, cameraPos, upRef) {
    const rel = this.sub3(cameraPos, target);
    const dist = this.norm3(rel);
    if (!Number.isFinite(dist) || dist <= 1e-6) {
      return cameraPos;
    }
    let v = rel;
    if (Math.abs(this.worldOrbitYaw) > 1e-6) {
      v = this.rotateAroundAxis(v, upRef, this.worldOrbitYaw);
    }
    if (Math.abs(this.worldOrbitPitch) > 1e-6) {
      const forward = this.safeDirection(this.scale3(v, -1), { x: 1, y: 0, z: 0 });
      const right = this.safeDirection(this.cross3(forward, upRef), { x: 0, y: 1, z: 0 });
      v = this.rotateAroundAxis(v, right, this.worldOrbitPitch);
    }
    return this.add3(target, v);
  }

  nudgeWorldOrbit(deltaYaw, deltaPitch) {
    if (!Number.isFinite(deltaYaw) || !Number.isFinite(deltaPitch)) {
      return;
    }
    this.worldOrbitYaw += deltaYaw;
    this.worldOrbitPitch = Math.max(-1.35, Math.min(1.35, this.worldOrbitPitch + deltaPitch));
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

function selectedShipType() {
  const ship = String(state.refs?.shipType?.value || 'saucer').toLowerCase();
  if (ship === 'sphere' || ship === 'egg' || ship === 'pyramid' || ship === 'flat_triangle') {
    return ship;
  }
  if (ship === 'flat-triangle' || ship === 'flat triangle' || ship === 'triangle' || ship === 'delta') {
    return 'flat_triangle';
  }
  return 'saucer';
}

function selectedWarpDrive() {
  const drive = String(state.refs?.warpDrive?.value || 'resonant_pll').toLowerCase();
  if (drive === 'geodesic' || drive === 'inertial_gradient' || drive === 'plasma_mhd' || drive === 'alcubierre_ag' || drive === 'resonant_pll') {
    return drive;
  }
  return 'resonant_pll';
}

function warpDriveLabel(value) {
  switch (String(value || '').toLowerCase()) {
    case 'geodesic':
      return 'geodesic drive';
    case 'inertial_gradient':
      return 'inertial-gradient drive';
    case 'plasma_mhd':
    case 'plasma_sheath':
      return 'plasma-mhd assist drive';
    case 'alcubierre_ag':
    case 'alcubierre':
      return 'alcubierre-ag drive';
    case 'inertial_vector':
      return 'inertial-gradient drive';
    case 'high_q_resonant':
    case 'pll_standard':
      return 'resonant pll drive';
    default:
      return 'resonant pll drive';
  }
}

function warpDriveUiDefaults(drive) {
  switch (String(drive || '').toLowerCase()) {
    case 'alcubierre_ag':
      return { omega: 80, q: 420, beta: 4.2, plasma: 0.10, throttle: 0.34, emCharge: 1800, eField: 4200, bField: 0.22 };
    case 'geodesic':
      return { omega: 80, q: 220, beta: 2.2, plasma: 0.08, throttle: 0.18, emCharge: 0, eField: 1200, bField: 0.0 };
    case 'inertial_gradient':
      return { omega: 80, q: 320, beta: 3.1, plasma: 0.15, throttle: 0.26, emCharge: 0, eField: 2200, bField: 0.08 };
    case 'plasma_mhd':
      return { omega: 80, q: 180, beta: 2.6, plasma: 0.72, throttle: 0.20, emCharge: 600, eField: 1800, bField: 0.12 };
    default:
      return { omega: 80, q: 120, beta: 1.8, plasma: 0.05, throttle: 0.12, emCharge: 0, eField: 900, bField: 0.0 };
  }
}

function applyWarpDriveUiDefaults(drive, force = false) {
  if (!state.refs) {
    return;
  }
  const d = warpDriveUiDefaults(drive);
  const sample = state.game.latest;
  const hasLiveSession = Boolean(state.game.running && sample);
  if (hasLiveSession && !force) {
    return;
  }
  setInputNumber(state.refs.oscOmegaTarget, d.omega, 1);
  setInputNumber(state.refs.oscQTarget, d.q, 2);
  setInputNumber(state.refs.oscBetaTarget, d.beta, 3);
  setInputNumber(state.refs.plasmaTarget, d.plasma, 2);
  setInputNumber(state.refs.throttleTarget, d.throttle, 2);
  setInputNumber(state.refs.emChargeTarget, d.emCharge, 1);
  setInputNumber(state.refs.eFieldTarget, d.eField, 1);
  setInputNumber(state.refs.bFieldTarget, d.bField, 3);
  updateControlBarReadouts();
  updateHUD(state.game.latest);
}

function currentCraftScale() {
  const raw = readNumberInput(state.refs?.craftScale, CRAFT_SCALE_MIN);
  const value = clampNumber(raw, CRAFT_SCALE_MIN, CRAFT_SCALE_MAX, CRAFT_SCALE_MIN);
  return value;
}

function craftSpanMetersFromScale(scale) {
  const s = clampNumber(scale, CRAFT_SCALE_MIN, CRAFT_SCALE_MAX, CRAFT_SCALE_MIN);
  return CRAFT_LAZAR_SPAN_M * s;
}

function updateCraftScaleReadout() {
  const scale = currentCraftScale();
  if (state.refs?.craftScale) {
    state.refs.craftScale.value = scale.toFixed(2);
  }
  const readout = state.refs?.craftScaleReadout;
  if (!readout) {
    return;
  }
  const spanM = craftSpanMetersFromScale(scale);
  const spanFt = spanM * METERS_TO_FEET;
  readout.textContent = `${formatNumber(scale, 2)}x • ${formatNumber(spanM, 1)} m (${formatNumber(spanFt, 1)} ft)`;
}

function currentMapMode() {
  const mode = String(state.refs?.mapMode?.value || state.game.mapMode || 'planetary').toLowerCase();
  if (mode === 'local') {
    return 'local';
  }
  return 'planetary';
}

function selectedPlanetPreset() {
  const preset = String(state.refs?.planetPreset?.value || 'earth').toLowerCase();
  if (preset === 'earth' || preset === 'mercury' || preset === 'moon' || preset === 'mars' || preset === 'venus' || preset === 'titan' || preset === 'jupiter' || preset === 'neptune') {
    return preset;
  }
  return 'earth';
}

function currentPlanetaryCameraMode() {
  const mode = String(state.refs?.planetaryCamera?.value || 'follow_lock').toLowerCase();
  if (mode === 'global') {
    return 'global';
  }
  if (mode === 'follow_local') {
    return 'follow_local';
  }
  return 'follow_lock';
}

function currentPlanetaryZoom() {
  const raw = readNumberInput(state.refs?.planetaryZoom, 2.0);
  return clampNumber(raw, 0.25, 25, 2.0);
}

function isGuideModalOpen() {
  const modal = state.refs?.guideModal;
  return Boolean(modal && !modal.classList.contains('hidden'));
}

function openGuideModal() {
  const modal = state.refs?.guideModal;
  if (!modal) {
    return;
  }
  modal.classList.remove('hidden');
  document.body.classList.add('overflow-hidden');
}

function closeGuideModal() {
  const modal = state.refs?.guideModal;
  if (!modal) {
    return;
  }
  modal.classList.add('hidden');
  document.body.classList.remove('overflow-hidden');
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
    document.body.classList.remove('overflow-hidden');
    return;
  }

  if (state.labRoot === root) {
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
  const controlReadouts = Object.create(null);
  root.querySelectorAll('[data-control-readout]').forEach((node) => {
    const key = node.getAttribute('data-control-readout');
    if (key) {
      controlReadouts[key] = node;
    }
  });

  state.refs = {
    status: root.querySelector('[data-game-status]'),
    warpDrive: root.querySelector('[data-warp-drive]'),
    shipType: root.querySelector('[data-ship-type]'),
    craftScale: root.querySelector('[data-craft-scale]'),
    craftScaleReadout: root.querySelector('[data-craft-scale-readout]'),
    planetPreset: root.querySelector('[data-planet-preset]'),
    mapMode: root.querySelector('[data-map-mode]'),
    planetaryCamera: root.querySelector('[data-planetary-camera]'),
    planetaryZoom: root.querySelector('[data-planetary-zoom]'),
    speed: root.querySelector('[data-game-speed]'),
    speedReadout: root.querySelector('[data-game-speed-readout]'),
    startGround: root.querySelector('[data-game-start-ground]'),
    holdAmpEnabled: root.querySelector('[data-hold-amp-enabled]'),
    holdAmpTarget: root.querySelector('[data-hold-amp-target]'),
    holdPhiEnabled: root.querySelector('[data-hold-phi-enabled]'),
    holdPhiTarget: root.querySelector('[data-hold-phi-target]'),
    holdYawEnabled: root.querySelector('[data-hold-yaw-enabled]'),
    holdYawTarget: root.querySelector('[data-hold-yaw-target]'),
    holdPitchEnabled: root.querySelector('[data-hold-pitch-enabled]'),
    holdPitchTarget: root.querySelector('[data-hold-pitch-target]'),
    propLateral: root.querySelector('[data-prop-lateral]'),
    propForward: root.querySelector('[data-prop-forward]'),
    oscOmegaTarget: root.querySelector('[data-osc-omega-target]'),
    oscQTarget: root.querySelector('[data-osc-q-target]'),
    oscBetaTarget: root.querySelector('[data-osc-beta-target]'),
    autoResonator: root.querySelector('[data-auto-resonator]'),
    plasmaTarget: root.querySelector('[data-plasma-target]'),
    throttleTarget: root.querySelector('[data-throttle-target]'),
    emChargeTarget: root.querySelector('[data-em-charge-target]'),
    eFieldTarget: root.querySelector('[data-e-field-target]'),
    bFieldTarget: root.querySelector('[data-b-field-target]'),
    autoTrim: root.querySelector('[data-auto-trim]'),
    autoWeight: root.querySelector('[data-auto-weight]'),
    autoVertical: root.querySelector('[data-auto-vertical]'),
    autoAltitude: root.querySelector('[data-auto-altitude]'),
    assistSpeedCap: root.querySelector('[data-assist-speed-cap]'),
    assistBrakeGain: root.querySelector('[data-assist-brake-gain]'),
    navMaxSpeed: root.querySelector('[data-nav-max-speed]'),
    navStopRadius: root.querySelector('[data-nav-stop-radius]'),
    energyHorizon: root.querySelector('[data-energy-horizon]'),
    pauseButton: root.querySelector('[data-game-pause]'),
    guideModal: root.querySelector('[data-guide-modal]'),
    controlReadouts,
    stats,
    canvasTop: root.querySelector('[data-game-canvas-top]'),
    canvasSide: root.querySelector('[data-game-canvas-side]'),
    canvas3D: root.querySelector('[data-game-canvas-3d]'),
    speedometerCanvas: root.querySelector('[data-game-speedometer]'),
    telemetryCharts: Array.from(root.querySelectorAll('[data-telemetry-chart]'))
    ,
    telemetryNormalize: root.querySelector('[data-telemetry-normalize]')
  };

  state.game.mapMode = currentMapMode();

  state.renderer = new DualViewRenderer(state.refs.canvasTop, state.refs.canvasSide, state.refs.canvas3D);
  renderLatestSample();

  window.addEventListener('resize', () => {
    if (state.renderer) {
      state.renderer.resize();
    }
  }, { once: true });

  updateControlBarReadouts();
  updateSimSpeedReadout();
  updateCraftScaleReadout();
  applyWarpDriveUiDefaults(selectedWarpDrive(), false);
  void fetchCalibrationSummary();
  setStatus(`ready • ${UI_BUILD_MARK}`);
  updateHUD(state.game.latest);
  closeGuideModal();
}

function setStatus(message) {
  if (!state.refs?.status) {
    return;
  }
  state.refs.status.textContent = message;
}

function updateSimSpeedReadout() {
  if (!state.refs?.speedReadout) {
    return;
  }
  const speed = clampNumber(readNumberInput(state.refs?.speed, 1), 0.25, 8, 1);
  state.refs.speedReadout.textContent = `${formatNumber(speed, 2)}x`;
}

function resetPropulsionStickIntent() {
  if (state.refs?.propLateral) {
    state.refs.propLateral.value = '0';
  }
  if (state.refs?.propForward) {
    state.refs.propForward.value = '0';
  }
  if (state.refs?.holdAmpTarget) {
    state.refs.holdAmpTarget.value = '0';
  }
  if (state.refs?.holdYawTarget) {
    state.refs.holdYawTarget.value = '0';
  }
  if (state.refs?.holdPitchTarget) {
    state.refs.holdPitchTarget.value = '0';
  }
  if (state.refs?.throttleTarget) {
    state.refs.throttleTarget.value = '0';
  }
}

function applyPropulsionStickIntent() {
  if (!state.refs?.propLateral || !state.refs?.propForward) {
    return;
  }
  const lateral = clampUnit(readNumberInput(state.refs.propLateral, 0));
  const forward = clampUnit(readNumberInput(state.refs.propForward, 0));
  const mag = clampNumber(Math.hypot(lateral, forward), 0, 1, 0);
  const ampAxis = clampUnit(mag);
  const yawAxis = clampUnit(lateral);
  const pitchAxis = clampUnit(forward);
  const throttle = clampNumber((Math.max(0, forward) * 0.82) - (Math.max(0, -forward) * 0.35), -1, 1, 0);
  const plasma = clampNumber(0.10 + (0.65 * mag), 0, 1, 0);

  if (state.refs.holdAmpTarget) {
    state.refs.holdAmpTarget.value = ampAxis.toFixed(2);
  }
  if (state.refs.holdYawTarget) {
    state.refs.holdYawTarget.value = yawAxis.toFixed(2);
  }
  if (state.refs.holdPitchTarget) {
    state.refs.holdPitchTarget.value = pitchAxis.toFixed(2);
  }
  if (state.refs.throttleTarget) {
    state.refs.throttleTarget.value = throttle.toFixed(2);
  }
  if (state.refs.plasmaTarget) {
    state.refs.plasmaTarget.value = plasma.toFixed(2);
  }
}

function flashStatusToast(message) {
  const node = state.refs?.status;
  if (!node) {
    return;
  }
  if (message) {
    node.textContent = message;
  }
  node.classList.remove('is-toast-flash');
  void node.offsetWidth;
  node.classList.add('is-toast-flash');
  window.setTimeout(() => node.classList.remove('is-toast-flash'), 950);
}

function unlockAllHoldLocks(reason = '') {
  if (!state.refs) {
    return false;
  }
  const hadAnyLock = Boolean(
    state.refs.holdAmpEnabled?.checked ||
    state.refs.holdPhiEnabled?.checked ||
    state.refs.holdYawEnabled?.checked ||
    state.refs.holdPitchEnabled?.checked
  );
  if (state.refs.holdAmpEnabled) {
    state.refs.holdAmpEnabled.checked = false;
  }
  if (state.refs.holdPhiEnabled) {
    state.refs.holdPhiEnabled.checked = false;
  }
  if (state.refs.holdYawEnabled) {
    state.refs.holdYawEnabled.checked = false;
  }
  if (state.refs.holdPitchEnabled) {
    state.refs.holdPitchEnabled.checked = false;
  }
  if (hadAnyLock) {
    updateControlBarReadouts();
    if (reason) {
      flashStatusToast(reason);
    }
  }
  return hadAnyLock;
}

function maybeWarnBlockedByLocks(sample) {
  const autoTrimRequested = Boolean(state.refs?.autoTrim?.checked);
  const navActive = Boolean(state.input.navTopActive || state.input.navProfileActive);
  if (!autoTrimRequested && !navActive) {
    return;
  }
  const locked = [];
  if (state.refs?.holdAmpEnabled?.checked) {
    locked.push('amp');
  }
  if (state.refs?.holdPhiEnabled?.checked) {
    locked.push('phase');
  }
  if (state.refs?.holdYawEnabled?.checked) {
    locked.push('yaw');
  }
  if (state.refs?.holdPitchEnabled?.checked) {
    locked.push('pitch');
  }
  if (!locked.length) {
    return;
  }
  const phase = String(sample?.assist_phase || '').toLowerCase();
  const blockedLikely = navActive || autoTrimRequested || phase.includes('blocked');
  if (!blockedLikely) {
    return;
  }
  const now = Date.now();
  const lastAt = Number(state.input.lastLockToastAt || 0);
  if ((now - lastAt) < 1500) {
    return;
  }
  state.input.lastLockToastAt = now;
  flashStatusToast(`lock blocks assist/nav: ${locked.join(', ')}`);
}

function formatNumber(value, digits = 3, suffix = '') {
  if (!Number.isFinite(value)) {
    return '-';
  }
  return `${value.toFixed(digits)}${suffix}`;
}

function formatCompactNumber(value, maxDigits = 2) {
  if (!Number.isFinite(value)) {
    return '-';
  }
  const abs = Math.abs(value);
  if (abs >= 100) {
    return value.toFixed(0);
  }
  if (abs >= 10) {
    return value.toFixed(Math.min(maxDigits, 1));
  }
  return value.toFixed(maxDigits);
}

function formatPower(value) {
  if (!Number.isFinite(value)) {
    return '-';
  }
  const abs = Math.abs(value);
  if (abs >= 1e9) {
    return `${(value / 1e9).toFixed(3)} GW`;
  }
  if (abs >= 1e6) {
    return `${(value / 1e6).toFixed(3)} MW`;
  }
  if (abs >= 1e3) {
    return `${(value / 1e3).toFixed(3)} kW`;
  }
  return `${value.toFixed(1)} W`;
}

function formatPowerCompact(value) {
  if (!Number.isFinite(value)) {
    return '-';
  }
  const abs = Math.abs(value);
  if (abs >= 1e9) {
    return `${formatCompactNumber(value / 1e9, 2)} GW`;
  }
  if (abs >= 1e6) {
    return `${formatCompactNumber(value / 1e6, 2)} MW`;
  }
  if (abs >= 1e3) {
    return `${formatCompactNumber(value / 1e3, 2)} kW`;
  }
  return `${formatCompactNumber(value, 1)} W`;
}

function formatEnergy(valueJ) {
  if (!Number.isFinite(valueJ)) {
    return '-';
  }
  const abs = Math.abs(valueJ);
  if (abs >= 1e9) {
    return `${(valueJ / 1e9).toFixed(3)} GJ`;
  }
  if (abs >= 1e6) {
    return `${(valueJ / 1e6).toFixed(3)} MJ`;
  }
  if (abs >= 1e3) {
    return `${(valueJ / 1e3).toFixed(3)} kJ`;
  }
  return `${valueJ.toFixed(1)} J`;
}

function formatDistanceCompact(valueM) {
  if (!Number.isFinite(valueM)) {
    return '-';
  }
  const abs = Math.abs(valueM);
  if (abs >= 1e9) {
    return `${formatCompactNumber(valueM / 1e9, 2)} Gm`;
  }
  if (abs >= 1e6) {
    return `${formatCompactNumber(valueM / 1e6, 2)} Mm`;
  }
  if (abs >= 1e3) {
    return `${formatCompactNumber(valueM / 1e3, 2)} km`;
  }
  return `${formatCompactNumber(valueM, 1)} m`;
}

function formatVelocityCompact(valueMps) {
  if (!Number.isFinite(valueMps)) {
    return '-';
  }
  const abs = Math.abs(valueMps);
  if (abs >= 1e6) {
    return `${formatCompactNumber(valueMps / 1e6, 2)} Mm/s`;
  }
  if (abs >= 1e3) {
    return `${formatCompactNumber(valueMps / 1e3, 2)} km/s`;
  }
  return `${formatCompactNumber(valueMps, 1)} m/s`;
}

function formatKmhCompact(valueMps) {
  if (!Number.isFinite(valueMps)) {
    return '-';
  }
  const kmh = valueMps * 3.6;
  const abs = Math.abs(kmh);
  if (abs >= 1e6) {
    return `${formatCompactNumber(kmh / 1e6, 2)}M km/h`;
  }
  if (abs >= 1e3) {
    return `${formatCompactNumber(kmh / 1e3, 2)}k km/h`;
  }
  return `${formatCompactNumber(kmh, 1)} km/h`;
}

function formatSpecificPowerCompact(valueWkg) {
  if (!Number.isFinite(valueWkg)) {
    return '-';
  }
  const abs = Math.abs(valueWkg);
  if (abs >= 1e9) {
    return `${formatCompactNumber(valueWkg / 1e9, 2)} GW/kg`;
  }
  if (abs >= 1e6) {
    return `${formatCompactNumber(valueWkg / 1e6, 2)} MW/kg`;
  }
  if (abs >= 1e3) {
    return `${formatCompactNumber(valueWkg / 1e3, 2)} kW/kg`;
  }
  return `${formatCompactNumber(valueWkg, 2)} W/kg`;
}

function formatPercentCompact(value) {
  if (!Number.isFinite(value)) {
    return '-';
  }
  return `${formatCompactNumber(value * 100, 2)}%`;
}

function clampNumber(value, min, max, fallback = 0) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, value));
}

function clampUnit(value) {
  return clampNumber(value, -1, 1, 0);
}

function readNumberInput(node, fallback) {
  const raw = Number.parseFloat(node?.value ?? '');
  if (!Number.isFinite(raw)) {
    return fallback;
  }
  return raw;
}

function wrapRadians(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  let out = value;
  while (out > Math.PI) {
    out -= TWO_PI;
  }
  while (out < -Math.PI) {
    out += TWO_PI;
  }
  return out;
}

function wrapPositiveRadians(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  let out = value;
  while (out < 0) {
    out += TWO_PI;
  }
  while (out >= TWO_PI) {
    out -= TWO_PI;
  }
  return out;
}

function phaseCycle(value) {
  return wrapPositiveRadians(value) / TWO_PI;
}

function updateControlEffect(prev, next) {
  if (!next) {
    state.input.lastEffect = 'none';
    return;
  }
  if (!prev) {
    state.input.lastEffect = `session start @ t=${formatNumber(next.time, 2)}s`;
    return;
  }

  const changed = [];
  const eps = 1e-6;
  if (Math.abs((next.control_amp_target || 0) - (prev.control_amp_target || 0)) > eps) {
    changed.push('amp');
  }
  if (Math.abs((next.control_theta_target || 0) - (prev.control_theta_target || 0)) > eps) {
    changed.push('phase');
  }
  if (Math.abs((next.control_omega_target || 0) - (prev.control_omega_target || 0)) > eps) {
    changed.push('omega');
  }
  if (Math.abs((next.control_q_target || 0) - (prev.control_q_target || 0)) > eps) {
    changed.push('Q');
  }
  if (Math.abs((next.control_beta_target || 0) - (prev.control_beta_target || 0)) > eps) {
    changed.push('pump');
  }
  if (Math.abs((next.control_plasma_target || 0) - (prev.control_plasma_target || 0)) > eps) {
    changed.push('plasma');
  }
  if (Math.abs((next.control_axis_yaw || 0) - (prev.control_axis_yaw || 0)) > eps) {
    changed.push('yaw');
  }
  if (Math.abs((next.control_axis_pitch || 0) - (prev.control_axis_pitch || 0)) > eps) {
    changed.push('pitch');
  }
  if (changed.length === 0) {
    state.input.lastEffect = `no target change @ t=${formatNumber(next.time, 2)}s`;
    return;
  }
  state.input.lastEffect = `${changed.join(', ')} changed @ t=${formatNumber(next.time, 2)}s`;
}

function localVerticalMetrics(sample) {
  if (!sample || !sample.g_raw || !sample.effective_g) {
    return null;
  }

  let ux = Number.isFinite(sample.local_up_x) ? sample.local_up_x : NaN;
  let uy = Number.isFinite(sample.local_up_y) ? sample.local_up_y : NaN;
  let uz = Number.isFinite(sample.local_up_z) ? sample.local_up_z : NaN;
  if (!Number.isFinite(ux) || !Number.isFinite(uy) || !Number.isFinite(uz)) {
    if (!sample.position || !sample.primary_position) {
      return null;
    }
    const rx = sample.position.x - sample.primary_position.x;
    const ry = sample.position.y - sample.primary_position.y;
    const rz = sample.position.z - sample.primary_position.z;
    const rMag = Math.hypot(rx, ry, rz);
    if (!Number.isFinite(rMag) || rMag <= 1e-9) {
      return null;
    }
    ux = rx / rMag;
    uy = ry / rMag;
    uz = rz / rMag;
  }
  const uMag = Math.hypot(ux, uy, uz);
  if (!Number.isFinite(uMag) || uMag <= 1e-9) {
    return null;
  }
  ux /= uMag;
  uy /= uMag;
  uz /= uMag;

  const downRaw = -(sample.g_raw.x * ux + sample.g_raw.y * uy + sample.g_raw.z * uz);
  const downEff = -(sample.effective_g.x * ux + sample.effective_g.y * uy + sample.effective_g.z * uz);
  const ratio = Math.abs(downRaw) > 1e-9 ? downEff / downRaw : NaN;
  return { downRaw, downEff, ratio };
}

function estimateLocalAtmosDensity(sample) {
  if (!sample || !sample.atmosphere_enabled) {
    return 0;
  }
  const rho0 = Number.parseFloat(sample.atmosphere_rho0);
  const h = Number.parseFloat(sample.atmosphere_scale_height);
  const alt = Math.max(0, Number.parseFloat(sample.altitude) || 0);
  if (!Number.isFinite(rho0) || rho0 <= 0 || !Number.isFinite(h) || h <= 1) {
    return 0;
  }
  return rho0 * Math.exp(-alt / h);
}

function smartAssistTargets(sample, goal, uiWeight, uiVertical) {
  const key = String(goal || 'off').toLowerCase();
  if (!sample || key === 'off' || key === 'neutral') {
    return {
      weight: uiWeight,
      vertical: uiVertical,
      speedCap: Number.POSITIVE_INFINITY,
      brake: false
    };
  }
  const altitude = Math.max(0, Number.parseFloat(sample.altitude) || 0);
  const gRawMag = Math.max(0, Number.parseFloat(sample.g_raw_mag) || 0);
  const bodyRadius = Math.max(1, Number.parseFloat(sample.primary_radius) || 0);
  const r = bodyRadius + altitude;
  const mu = gRawMag > 0 ? (gRawMag * r * r) : 0;
  const vEscape = mu > 0 ? Math.sqrt(Math.max(0, (2 * mu) / r)) : 2000;
  const rho = estimateLocalAtmosDensity(sample);
  const rho0 = Math.max(1e-9, Number.parseFloat(sample.atmosphere_rho0) || 1.225);
  const densRatio = Math.max(0, Math.min(1, rho / rho0));
  const speedNow = Math.max(0, Number.parseFloat(sample.speed) || 0);
  const capFactor = clampNumber(readNumberInput(state.refs?.assistSpeedCap, 0.24), 0.05, 2.0, 0.24);
  const brakeGain = clampNumber(readNumberInput(state.refs?.assistBrakeGain, 1.0), 0.1, 3.0, 1.0);

  const thinAirFactor = 0.65 + (0.35 * densRatio);
  const speedCap = Math.max(120, Math.min(5000, vEscape * capFactor * thinAirFactor));
  const overSpeed = speedNow - speedCap;
  const brake = overSpeed > 0;
  const brakeScale = brake ? Math.min(2.0, 1.0 + ((overSpeed / Math.max(speedCap, 1)) * brakeGain)) : 1.0;

  if (key === 'hover') {
    return {
      weight: brake ? 1.08 : 0.0,
      vertical: 0.0,
      speedCap,
      brake
    };
  }
  return {
    weight: uiWeight,
    vertical: uiVertical,
    speedCap,
    brake
  };
}

function drawSpeedometer(sample) {
  const canvas = state.refs?.speedometerCanvas;
  if (!canvas) {
    return;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }

  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(120, canvas.clientWidth);
  const h = Math.max(120, canvas.clientHeight);
  const bw = Math.floor(w * dpr);
  const bh = Math.floor(h * dpr);
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const speed = Number.parseFloat(sample?.speed);
  const speedMps = Number.isFinite(speed) ? Math.max(0, speed) : 0;
  const minScale = 120;
  const prevScale = Number.isFinite(state.game.speedometerScale) ? state.game.speedometerScale : 400;
  const targetScale = Math.max(minScale, Math.min(6000, Math.max(speedMps * 1.25, prevScale * 0.994)));
  state.game.speedometerScale = targetScale;
  const maxMps = targetScale;
  const ratio = Math.max(0, Math.min(1, speedMps / Math.max(maxMps, 1)));

  const cx = w * 0.5;
  const cy = h * 0.82;
  const r = Math.min(w * 0.42, h * 0.75);
  const compactDial = h < 120 || w < 180;
  const start = Math.PI * 0.78;
  const end = Math.PI * 0.22;
  const sweep = end - start;

  const dial = ctx.createRadialGradient(cx, cy, r * 0.12, cx, cy, r * 1.05);
  dial.addColorStop(0, 'rgba(20, 37, 52, 0.96)');
  dial.addColorStop(0.7, 'rgba(11, 23, 34, 0.98)');
  dial.addColorStop(1, 'rgba(6, 14, 21, 0.99)');
  ctx.fillStyle = dial;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 1.06, Math.PI, 0);
  ctx.lineTo(cx + (r * 1.06), cy);
  ctx.lineTo(cx - (r * 1.06), cy);
  ctx.closePath();
  ctx.fill();

  const sweepGlow = ctx.createLinearGradient(cx - r, cy, cx + r, cy);
  sweepGlow.addColorStop(0, 'rgba(41, 132, 148, 0.08)');
  sweepGlow.addColorStop(Math.max(0.12, ratio * 0.85), 'rgba(73, 207, 224, 0.38)');
  sweepGlow.addColorStop(Math.min(1, ratio + 0.08), 'rgba(255, 151, 87, 0.44)');
  sweepGlow.addColorStop(1, 'rgba(255, 255, 255, 0.04)');
  ctx.strokeStyle = sweepGlow;
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.9, start, end, false);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(144, 201, 214, 0.22)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, start, end, false);
  ctx.stroke();

  const tickCount = compactDial ? 6 : 8;
  const tickFont = compactDial ? 9 : 11;
  const speedFont = compactDial ? 13 : 17;
  const metaFont = compactDial ? 10 : 12;
  ctx.font = `${tickFont}px "IBM Plex Mono", monospace`;
  ctx.fillStyle = 'rgba(228, 240, 243, 0.78)';
  for (let i = 0; i <= tickCount; i += 1) {
    const t = i / tickCount;
    const a = start + (sweep * t);
    const cosA = Math.cos(a);
    const sinA = Math.sin(a);
    const x0 = cx + (cosA * r * 0.78);
    const y0 = cy + (sinA * r * 0.78);
    const x1 = cx + (cosA * r * 0.96);
    const y1 = cy + (sinA * r * 0.96);
    ctx.strokeStyle = 'rgba(171, 214, 222, 0.7)';
    ctx.lineWidth = i % 2 === 0 ? 2 : 1.4;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();

    if (i % 2 === 0) {
      const labelMps = Math.round((maxMps * t) / 10) * 10;
      const lx = cx + (cosA * r * 0.62);
      const ly = cy + (sinA * r * 0.62);
      ctx.textAlign = 'center';
      ctx.fillText(`${labelMps}`, lx, ly + 3);
    }
  }

  // Dial arc is drawn clockwise from start->end. Needle needs inverse mapping
  // so higher speed points toward the high-speed side of the arc.
  const needleAngle = start + (sweep * (1 - ratio));
  const needleX = cx + (Math.cos(needleAngle) * r * 0.86);
  const needleY = cy + (Math.sin(needleAngle) * r * 0.86);
  ctx.strokeStyle = 'rgba(255, 149, 83, 0.98)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(needleX, needleY);
  ctx.stroke();

  ctx.fillStyle = 'rgba(255, 149, 83, 0.98)';
  ctx.beginPath();
  ctx.arc(cx, cy, 6, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = 'rgba(245, 250, 251, 0.92)';
  ctx.beginPath();
  ctx.arc(cx, cy, 2.5, 0, TWO_PI);
  ctx.fill();

  const kmh = speedMps * 3.6;
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(242, 247, 248, 0.92)';
  ctx.font = `600 ${speedFont}px "IBM Plex Mono", monospace`;
  ctx.fillText(`${formatNumber(speedMps, 1)} m/s`, cx, h * 0.56);
  ctx.font = `${metaFont}px "IBM Plex Mono", monospace`;
  ctx.fillStyle = 'rgba(181, 213, 219, 0.8)';
  ctx.fillText(`${formatNumber(kmh, 1)} km/h`, cx, h * 0.63);
  if (!compactDial) {
    ctx.fillText(`scale ${formatNumber(maxMps, 0)} m/s`, cx, h * 0.70);
  }
  ctx.textAlign = 'start';
}

function telemetrySampleFromState(sample) {
  if (!sample) {
    return null;
  }
  const vertical = localVerticalMetrics(sample);
  const warpX = Number.parseFloat(sample.control_warp_x);
  const warpY = Number.parseFloat(sample.control_warp_y);
  const warpZ = Number.parseFloat(sample.control_warp_z);
  const warpMag = Math.hypot(
    Number.isFinite(warpX) ? warpX : 0,
    Number.isFinite(warpY) ? warpY : 0,
    Number.isFinite(warpZ) ? warpZ : 0
  );
  const warpTiltMag = Math.hypot(
    Number.isFinite(warpX) ? warpX : 0,
    Number.isFinite(warpY) ? warpY : 0
  ) / Math.max(1e-9, warpMag);
  return {
    t: Number.parseFloat(sample.time) || 0,
    downRaw: vertical ? Number.parseFloat(vertical.downRaw) : NaN,
    downEff: vertical ? Number.parseFloat(vertical.downEff) : NaN,
    gLoad: Number.parseFloat(sample.g_load),
    speed: Number.parseFloat(sample.speed),
    verticalV: Number.parseFloat(sample.vertical_vel),
    altitude: Number.parseFloat(sample.altitude),
    requiredPower: Number.parseFloat(sample.required_power),
    drivePower: Number.parseFloat(sample.drive_power),
    plasmaPower: Number.parseFloat(sample.plasma_power),
    dynamicPressure: Number.parseFloat(sample.dynamic_pressure),
    mach: Number.parseFloat(sample.mach),
    dragPower: Number.parseFloat(sample.drag_power),
    lockQuality: Number.parseFloat(sample.lock_quality),
    phaseError: Number.parseFloat(sample.phase_error),
    oscMag: Number.parseFloat(sample.osc_mag),
    warpX,
    warpY,
    warpZ,
    warpTiltMag,
    couplingC: Number.parseFloat(sample.coupling_c),
    gEffMag: Number.parseFloat(sample.effective_g_mag)
  };
}

function pushTelemetryHistory(sample) {
  const entry = telemetrySampleFromState(sample);
  if (!entry) {
    return;
  }
  state.game.telemetryHistory.push(entry);
  while (state.game.telemetryHistory.length > state.game.telemetryHistoryMax) {
    state.game.telemetryHistory.shift();
  }
}

function drawTelemetrySeries(ctx, w, h, history, key) {
  const insetL = 30;
  const insetR = 8;
  const insetT = 6;
  const insetB = 8;
  const plotW = Math.max(1, w - insetL - insetR);
  const plotH = Math.max(1, h - insetT - insetB);
  const items = history.filter((it) => Number.isFinite(it.t));
  const defs = {
    gravity: [{ k: 'downRaw', c: '#1565c0' }, { k: 'downEff', c: '#ef6c00' }, { k: 'gLoad', c: '#2e7d32' }],
    motion: [{ k: 'speed', c: '#0d47a1' }, { k: 'verticalV', c: '#6a1b9a' }, { k: 'altitude', c: '#00897b' }],
    power: [{ k: 'requiredPower', c: '#ad1457' }, { k: 'drivePower', c: '#2e7d32' }, { k: 'plasmaPower', c: '#0277bd' }],
    aero: [{ k: 'dynamicPressure', c: '#5d4037' }, { k: 'mach', c: '#00838f' }, { k: 'dragPower', c: '#ef6c00' }],
    lock: [{ k: 'lockQuality', c: '#1b5e20' }, { k: 'phaseError', c: '#6d4c41' }, { k: 'oscMag', c: '#283593' }],
    control: [{ k: 'warpX', c: '#1565c0' }, { k: 'warpY', c: '#ef6c00' }, { k: 'warpZ', c: '#2e7d32' }]
    ,
    fieldshape: [{ k: 'warpTiltMag', c: '#7b1fa2' }, { k: 'couplingC', c: '#ef6c00' }, { k: 'gEffMag', c: '#2e7d32' }]
  };
  const seriesDefs = defs[key] || [];
  const units = {
    gravity: 'm/s^2, g',
    motion: 'm/s, m',
    power: 'W',
    aero: 'Pa, Mach, W',
    lock: 'ratio',
    control: 'axis',
    fieldshape: 'shape'
  };
  const yLabels = {
    gravity: 'g / accel',
    motion: 'velocity / altitude',
    power: 'power',
    aero: 'aero',
    lock: 'lock',
    control: 'warp axis',
    fieldshape: 'field shape'
  };
  const normalize = Boolean(state.refs?.telemetryNormalize?.checked);
  if (!items.length || !seriesDefs.length) {
    return;
  }
  let yMin = Number.POSITIVE_INFINITY;
  let yMax = Number.NEGATIVE_INFINITY;
  const normalizedSeriesStats = Object.create(null);
  if (normalize) {
    for (const s of seriesDefs) {
      let sMin = Number.POSITIVE_INFINITY;
      let sMax = Number.NEGATIVE_INFINITY;
      for (const item of items) {
        const v = item[s.k];
        if (Number.isFinite(v)) {
          sMin = Math.min(sMin, v);
          sMax = Math.max(sMax, v);
        }
      }
      if (!Number.isFinite(sMin) || !Number.isFinite(sMax) || Math.abs(sMax - sMin) < 1e-9) {
        sMin = 0;
        sMax = 1;
      }
      normalizedSeriesStats[s.k] = { min: sMin, max: sMax };
    }
    yMin = 0;
    yMax = 1;
  } else {
    for (const item of items) {
      for (const s of seriesDefs) {
        const v = item[s.k];
        if (Number.isFinite(v)) {
          yMin = Math.min(yMin, v);
          yMax = Math.max(yMax, v);
        }
      }
    }
  }
  if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) {
    return;
  }
  if (Math.abs(yMax - yMin) < 1e-9) {
    yMin -= 1;
    yMax += 1;
  }
  const t0 = items[0].t;
  const t1 = items[items.length - 1].t;
  const tSpan = Math.max(1e-6, t1 - t0);
  const xOf = (t) => insetL + (((t - t0) / tSpan) * plotW);
  const yOf = (v) => insetT + ((1 - ((v - yMin) / (yMax - yMin))) * plotH);

  for (const s of seriesDefs) {
    let opened = false;
    ctx.strokeStyle = s.c;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (const item of items) {
      const v = item[s.k];
      if (!Number.isFinite(v)) {
        continue;
      }
      const vv = normalize
        ? ((v - normalizedSeriesStats[s.k].min) / Math.max(1e-9, normalizedSeriesStats[s.k].max - normalizedSeriesStats[s.k].min))
        : v;
      const x = xOf(item.t);
      const y = yOf(vv);
      if (!opened) {
        ctx.moveTo(x, y);
        opened = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    if (opened) {
      ctx.stroke();
    }
  }

  ctx.save();
  ctx.font = '10px "IBM Plex Mono", monospace';
  ctx.fillStyle = 'rgba(40, 58, 65, 0.88)';
  ctx.textAlign = 'left';
  ctx.fillText(`${formatCompactNumber(yMax, 3)} max`, insetL + 2, insetT + 10);
  ctx.fillText(`${formatCompactNumber(yMin, 3)} min`, insetL + 2, h - 4);
  ctx.textAlign = 'right';
  ctx.fillText(`${formatCompactNumber(tSpan, 1)}s`, w - insetR - 2, h - 4);
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(72, 86, 93, 0.86)';
  ctx.fillText(normalize ? 'normalized 0..1' : (units[key] || ''), insetL + 2, h - 16);

  let lx = insetL + 72;
  const ly = insetT + 10;
  for (const s of seriesDefs) {
    ctx.fillStyle = s.c;
    ctx.fillRect(lx, ly - 7, 9, 3);
    lx += 12;
    ctx.fillStyle = 'rgba(36, 55, 63, 0.86)';
    ctx.fillText(s.k, lx, ly);
    lx += ctx.measureText(s.k).width + 10;
    if (lx > w - 80) {
      break;
    }
  }
  ctx.save();
  ctx.translate(10, h * 0.5);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(40, 58, 65, 0.88)';
  ctx.fillText(yLabels[key] || 'value', 0, 0);
  ctx.restore();
  ctx.restore();
}

function drawTelemetryGraphs() {
  const canvases = state.refs?.telemetryCharts;
  if (!Array.isArray(canvases) || !canvases.length) {
    return;
  }
  const history = state.game.telemetryHistory || [];
  for (const canvas of canvases) {
    if (!canvas) {
      continue;
    }
    const key = canvas.getAttribute('data-telemetry-chart') || '';
    if (!TELEMETRY_GRAPH_KEYS.includes(key)) {
      continue;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      continue;
    }
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(180, canvas.clientWidth);
    const h = Math.max(110, canvas.clientHeight);
    const bw = Math.floor(w * dpr);
    const bh = Math.floor(h * dpr);
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(248, 252, 254, 0.98)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(93, 126, 136, 0.16)';
    ctx.lineWidth = 1;
    for (let i = 1; i <= 4; i += 1) {
      const y = (h * i) / 5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    drawTelemetrySeries(ctx, w, h, history, key);
  }
}

function setStat(key, value) {
  const node = state.refs?.stats?.[key];
  if (!node) {
    return;
  }
  node.textContent = value;
}

function setInputNumber(node, value, digits = 3) {
  if (!node || !Number.isFinite(value)) {
    return;
  }
  node.value = value.toFixed(digits);
}

function setControlCardLive(inputNode, isLive) {
  const card = inputNode?.closest?.('.lab-control-card');
  if (!card) {
    return;
  }
  card.classList.toggle('is-live', Boolean(isLive));
}

function setResonatorFieldAlert(fieldKey, enabled) {
  const node = state.labRoot?.querySelector?.(`[data-resonator-field="${fieldKey}"]`);
  const card = node?.closest?.('.lab-control-card');
  if (!card) {
    return;
  }
  card.classList.toggle('is-alert', Boolean(enabled));
}

function currentOscillatorTargets(sample = state.game.latest) {
  const omegaBase = clampNumber(
    readNumberInput(state.refs?.oscOmegaTarget, Number.parseFloat(sample?.control_omega_target)),
    OSC_OMEGA_MIN,
    OSC_OMEGA_MAX,
    80
  );
  const qBase = clampNumber(
    readNumberInput(state.refs?.oscQTarget, Number.parseFloat(sample?.control_q_target)),
    OSC_Q_MIN,
    OSC_Q_MAX,
    45
  );
  const betaBase = clampNumber(
    readNumberInput(state.refs?.oscBetaTarget, Number.parseFloat(sample?.control_beta_target)),
    OSC_BETA_MIN,
    OSC_BETA_MAX,
    1.2
  );
  const autoResonator = Boolean(state.refs?.autoResonator?.checked);
  if (!autoResonator || !sample) {
    return { omega: omegaBase, q: qBase, beta: betaBase };
  }

  const lockQuality = clampNumber(Number.parseFloat(sample.lock_quality), 0, 1.5, 0);
  const phaseErr = clampNumber(Number.parseFloat(sample.phase_error), -5, 5, 0);
  const oscMag = clampNumber(Number.parseFloat(sample.osc_mag), 0, 1e6, 0);
  const omegaNow = clampNumber(Number.parseFloat(sample.drive_omega), OSC_OMEGA_MIN, OSC_OMEGA_MAX, omegaBase);
  const requiredPower = Math.max(0, Number.parseFloat(sample.required_power) || 0);
  const drivePower = Math.max(0, Number.parseFloat(sample.drive_power) || 0);
  const curtailFrac = clampNumber(Number.parseFloat(sample.power_curtail_frac), 0, 1, 0);
  const powerNeedRatio = requiredPower > 0 ? (drivePower / requiredPower) : 1;
  const powerDeficit = clampNumber(1 - powerNeedRatio, 0, 1, 0);

  // Auto tune strategy:
  // 1) Pull omega target toward measured drive omega when phase error rises.
  // 2) Raise Q as lock improves; soften Q when lock is weak or phase error grows.
  // 3) Raise beta for weak oscillation/lock recovery and power deficits.
  const phaseAbs = Math.abs(phaseErr);
  const lockNeed = clampNumber(1 - lockQuality, 0, 1, 0);
  const omegaBlend = clampNumber((phaseAbs * 0.35) + (lockNeed * 0.25), 0, 0.85, 0);
  const omegaTarget = clampNumber(
    (omegaBase * (1 - omegaBlend)) + (omegaNow * omegaBlend),
    OSC_OMEGA_MIN,
    OSC_OMEGA_MAX,
    omegaBase
  );

  const qLockBoost = clampNumber(lockQuality * 850, 0, 1600, 0);
  const qPowerBoost = clampNumber((powerDeficit + curtailFrac) * 420, 0, 620, 0);
  const qPenalty = clampNumber((phaseAbs * 260) + (lockNeed * 700), 0, 1600, 0);
  const qTarget = clampNumber(qBase + qLockBoost + qPowerBoost - qPenalty, OSC_Q_MIN, OSC_Q_MAX, qBase);

  const magTarget = 10.0;
  const magErr = clampNumber(magTarget - oscMag, -30, 30, 0);
  const betaTarget = clampNumber(
    betaBase +
      (lockNeed * 1.25) +
      (phaseAbs * 0.18) +
      (magErr * 0.06) +
      (powerDeficit * 2.1) +
      (curtailFrac * 2.6),
    OSC_BETA_MIN,
    OSC_BETA_MAX,
    betaBase
  );

  return { omega: omegaTarget, q: qTarget, beta: betaTarget };
}

function currentPlasmaTarget(sample = state.game.latest) {
  return clampNumber(
    readNumberInput(state.refs?.plasmaTarget, Number.parseFloat(sample?.control_plasma_target)),
    PLASMA_MIN,
    PLASMA_MAX,
    0
  );
}

function oscillatorTargetSummary(sample = state.game.latest) {
  const osc = currentOscillatorTargets(sample);
  const plasma = currentPlasmaTarget(sample);
  return `osc:[omega ${formatNumber(osc.omega, 1)} Q ${formatNumber(osc.q, 1)} beta ${formatNumber(osc.beta, 3)} plasma ${formatNumber(plasma, 2)}]`;
}

function isSystemDriving() {
  return Boolean(
    state.input.lockAssist ||
    state.input.navTopActive ||
    state.input.navProfileActive ||
    state.refs?.autoTrim?.checked ||
    state.refs?.autoResonator?.checked
  );
}

function setSystemDrivingComponentState(enabled) {
  void enabled;
}

function mirrorAllDialsFromSample(sample) {
  if (!sample || !state.refs) {
    return;
  }
  const a = clampUnit(Number.parseFloat(sample.control_amp_axis));
  const p = clampUnit(Number.parseFloat(sample.control_phi_axis));
  const y = clampUnit(Number.parseFloat(sample.control_yaw_axis));
  const t = clampUnit(Number.parseFloat(sample.control_pitch_axis));
  if (state.refs.holdAmpTarget && Number.isFinite(a)) {
    state.refs.holdAmpTarget.value = a.toFixed(2);
  }
  if (state.refs.holdPhiTarget && Number.isFinite(p)) {
    state.refs.holdPhiTarget.value = p.toFixed(2);
  }
  if (state.refs.holdYawTarget && Number.isFinite(y)) {
    state.refs.holdYawTarget.value = y.toFixed(2);
  }
  if (state.refs.holdPitchTarget && Number.isFinite(t)) {
    state.refs.holdPitchTarget.value = t.toFixed(2);
  }
  if (state.refs.oscOmegaTarget && Number.isFinite(sample.control_omega_target)) {
    const v = Number(sample.control_omega_target);
    state.refs.oscOmegaTarget.value = v.toFixed(1);
  }
  if (state.refs.oscQTarget && Number.isFinite(sample.control_q_target)) {
    const v = Number(sample.control_q_target);
    state.refs.oscQTarget.value = v.toFixed(0);
  }
  if (state.refs.oscBetaTarget && Number.isFinite(sample.control_beta_target)) {
    const v = Number(sample.control_beta_target);
    state.refs.oscBetaTarget.value = v.toFixed(3);
  }
  if (state.refs.plasmaTarget && Number.isFinite(sample.control_plasma_target)) {
    const v = Number(sample.control_plasma_target);
    state.refs.plasmaTarget.value = v.toFixed(2);
  }
  if (state.refs.throttleTarget && Number.isFinite(sample.control_throttle_target)) {
    const v = Number.isFinite(sample.control_throttle_applied)
      ? Number(sample.control_throttle_applied)
      : Number(sample.control_throttle_target);
    state.refs.throttleTarget.value = v.toFixed(2);
  }
  if (state.refs.emChargeTarget && Number.isFinite(sample.control_em_charge_target)) {
    const v = Number(sample.control_em_charge_target);
    state.refs.emChargeTarget.value = v.toFixed(1);
  }
  if (state.refs.eFieldTarget && Number.isFinite(sample.control_e_field_target)) {
    const v = Number(sample.control_e_field_target);
    state.refs.eFieldTarget.value = v.toFixed(1);
  }
  if (state.refs.bFieldTarget && Number.isFinite(sample.control_b_field_target)) {
    const v = Number(sample.control_b_field_target);
    state.refs.bFieldTarget.value = v.toFixed(3);
  }
}

function updateControlBarReadouts() {
  if (!state.refs?.controlReadouts) {
    return;
  }
  const sample = state.game.latest;
  const systemDriving = isSystemDriving();
  setSystemDrivingComponentState(systemDriving);
  const amp = systemDriving
    ? clampUnit(Number.parseFloat(sample?.control_amp_axis))
    : clampUnit(readNumberInput(state.refs?.holdAmpTarget, 0));
  const phi = systemDriving
    ? clampUnit(Number.parseFloat(sample?.control_phi_axis))
    : clampUnit(readNumberInput(state.refs?.holdPhiTarget, 0));
  const yaw = systemDriving
    ? clampUnit(Number.parseFloat(sample?.control_yaw_axis))
    : clampUnit(readNumberInput(state.refs?.holdYawTarget, 0));
  const pitch = systemDriving
    ? clampUnit(Number.parseFloat(sample?.control_pitch_axis))
    : clampUnit(readNumberInput(state.refs?.holdPitchTarget, 0));
  const sAmp = Number.parseFloat(sample?.control_amp_target);
  const sPhi = Number.parseFloat(sample?.control_theta_target);
  const sYaw = Number.parseFloat(sample?.control_axis_yaw);
  const sPitch = Number.parseFloat(sample?.control_axis_pitch);
  const osc = currentOscillatorTargets();
  const axisLabel = systemDriving ? 'SYS' : 'L';
  const sysAxisAmp = clampUnit(Number.parseFloat(sample?.control_amp_axis));
  const sysAxisPhi = clampUnit(Number.parseFloat(sample?.control_phi_axis));
  const sysAxisYaw = clampUnit(Number.parseFloat(sample?.control_yaw_axis));
  const sysAxisPitch = clampUnit(Number.parseFloat(sample?.control_pitch_axis));
  const axisTouchEps = 0.015;
  const ampTouch = Math.abs(sysAxisAmp) > axisTouchEps;
  const phiTouch = Math.abs(sysAxisPhi) > axisTouchEps;
  const yawTouch = Math.abs(sysAxisYaw) > axisTouchEps;
  const pitchTouch = Math.abs(sysAxisPitch) > axisTouchEps;

  if (state.refs.controlReadouts.amp) {
    state.refs.controlReadouts.amp.textContent = systemDriving
      ? `${ampTouch ? 'SYS' : 'HOLD'} ${formatNumber(sAmp, 3)} | AX ${formatNumber(sysAxisAmp, 2)}`
      : `${axisLabel} ${formatNumber(amp, 2)} | S ${formatNumber(sAmp, 3)}`;
  }
  if (state.refs.controlReadouts.phi) {
    state.refs.controlReadouts.phi.textContent = systemDriving
      ? `${phiTouch ? 'SYS' : 'HOLD'} ${formatNumber(sPhi, 3)} | AX ${formatNumber(sysAxisPhi, 2)}`
      : `${axisLabel} ${formatNumber(phi, 2)} | S ${formatNumber(sPhi, 3)}`;
  }
  if (state.refs.controlReadouts.yaw) {
    state.refs.controlReadouts.yaw.textContent = systemDriving
      ? `${yawTouch ? 'SYS' : 'HOLD'} ${formatNumber(sYaw, 3)} | AX ${formatNumber(sysAxisYaw, 2)}`
      : `${axisLabel} ${formatNumber(yaw, 2)} | S ${formatNumber(sYaw, 3)}`;
  }
  if (state.refs.controlReadouts.pitch) {
    state.refs.controlReadouts.pitch.textContent = systemDriving
      ? `${pitchTouch ? 'SYS' : 'HOLD'} ${formatNumber(sPitch, 3)} | AX ${formatNumber(sysAxisPitch, 2)}`
      : `${axisLabel} ${formatNumber(pitch, 2)} | S ${formatNumber(sPitch, 3)}`;
  }
  if (state.refs.controlReadouts.propstick) {
    const l = clampUnit(readNumberInput(state.refs?.propLateral, 0));
    const f = clampUnit(readNumberInput(state.refs?.propForward, 0));
    state.refs.controlReadouts.propstick.textContent = `L ${formatNumber(l, 2)} | F ${formatNumber(f, 2)}`;
  }
  if (state.refs.controlReadouts.omega) {
    state.refs.controlReadouts.omega.textContent = formatNumber(osc.omega, 2);
  }
  if (state.refs.controlReadouts.q) {
    state.refs.controlReadouts.q.textContent = formatNumber(osc.q, 1);
  }
  if (state.refs.controlReadouts.beta) {
    state.refs.controlReadouts.beta.textContent = formatNumber(osc.beta, 3);
  }
  if (state.refs.controlReadouts.plasma) {
    state.refs.controlReadouts.plasma.textContent = formatNumber(currentPlasmaTarget(), 3);
  }
  if (state.refs.controlReadouts.throttle) {
    const tApplied = Number.parseFloat(sample?.control_throttle_applied);
    const tTarget = Number.parseFloat(sample?.control_throttle_target);
    if (Number.isFinite(tApplied) && Number.isFinite(tTarget)) {
      state.refs.controlReadouts.throttle.textContent = systemDriving
        ? `SYS ${formatNumber(tApplied, 3)} | T ${formatNumber(tTarget, 3)}`
        : `SYS ${formatNumber(tApplied, 3)} | T ${formatNumber(tTarget, 3)}`;
    } else {
      state.refs.controlReadouts.throttle.textContent = formatNumber(readNumberInput(state.refs?.throttleTarget, tTarget), 3);
    }
  }
  if (state.refs.controlReadouts.emcharge) {
    state.refs.controlReadouts.emcharge.textContent = formatNumber(readNumberInput(state.refs?.emChargeTarget, Number.parseFloat(sample?.control_em_charge_target)), 1);
  }
  if (state.refs.controlReadouts.efield) {
    state.refs.controlReadouts.efield.textContent = formatNumber(readNumberInput(state.refs?.eFieldTarget, Number.parseFloat(sample?.control_e_field_target)), 1);
  }
  if (state.refs.controlReadouts.bfield) {
    state.refs.controlReadouts.bfield.textContent = formatNumber(readNumberInput(state.refs?.bFieldTarget, Number.parseFloat(sample?.control_b_field_target)), 3);
  }

  setControlCardLive(state.refs?.holdAmpTarget, !state.refs?.holdAmpEnabled?.checked);
  setControlCardLive(state.refs?.holdPhiTarget, !state.refs?.holdPhiEnabled?.checked);
  setControlCardLive(state.refs?.holdYawTarget, !state.refs?.holdYawEnabled?.checked);
  setControlCardLive(state.refs?.holdPitchTarget, !state.refs?.holdPitchEnabled?.checked);
}

function centerControlBars() {
  if (state.refs?.holdAmpTarget) {
    state.refs.holdAmpTarget.value = '0';
  }
  if (state.refs?.holdPhiTarget) {
    state.refs.holdPhiTarget.value = '0';
  }
  if (state.refs?.holdYawTarget) {
    state.refs.holdYawTarget.value = '0';
  }
  if (state.refs?.holdPitchTarget) {
    state.refs.holdPitchTarget.value = '0';
  }
  resetPropulsionStickIntent();
  updateControlBarReadouts();
  setStatus('warp setpoint centered');
}

function maybeSpringReturnLever(target) {
  if (!(target instanceof Element)) {
    return;
  }
  if (target.matches('[data-hold-amp-target]') && !state.refs?.holdAmpEnabled?.checked) {
    target.value = '0';
  } else if (target.matches('[data-hold-phi-target]') && !state.refs?.holdPhiEnabled?.checked) {
    target.value = '0';
  } else if (target.matches('[data-hold-yaw-target]') && !state.refs?.holdYawEnabled?.checked) {
    target.value = '0';
  } else if (target.matches('[data-hold-pitch-target]') && !state.refs?.holdPitchEnabled?.checked) {
    target.value = '0';
  } else {
    return;
  }
  updateControlBarReadouts();
}

function syncControlBarsToSample(sample) {
  if (!sample) {
    return;
  }
  setInputNumber(state.refs?.holdAmpTarget, 0, 2);
  setInputNumber(state.refs?.holdPhiTarget, 0, 2);
  setInputNumber(state.refs?.holdYawTarget, 0, 2);
  setInputNumber(state.refs?.holdPitchTarget, 0, 2);
  setInputNumber(state.refs?.propLateral, 0, 2);
  setInputNumber(state.refs?.propForward, 0, 2);
  setInputNumber(state.refs?.oscOmegaTarget, Number.parseFloat(sample.control_omega_target), 1);
  setInputNumber(state.refs?.oscQTarget, Number.parseFloat(sample.control_q_target), 0);
  setInputNumber(state.refs?.oscBetaTarget, Number.parseFloat(sample.control_beta_target), 2);
  setInputNumber(state.refs?.plasmaTarget, Number.parseFloat(sample.control_plasma_target), 2);
  setInputNumber(state.refs?.throttleTarget, Number.parseFloat(sample.control_throttle_target), 2);
  setInputNumber(state.refs?.emChargeTarget, Number.parseFloat(sample.control_em_charge_target), 1);
  setInputNumber(state.refs?.eFieldTarget, Number.parseFloat(sample.control_e_field_target), 1);
  setInputNumber(state.refs?.bFieldTarget, Number.parseFloat(sample.control_b_field_target), 3);
  updateControlBarReadouts();
}

function syncUnlockedControlBarsToSample(sample) {
  if (!sample) {
    return;
  }
  // Always mirror backend-applied control values while the session is running.
  // This guarantees UI dials cannot drift/stall relative to sim truth.
  mirrorAllDialsFromSample(sample);
  updateControlBarReadouts();
}

function applyResonatorPreset(name) {
  const key = String(name || '').toLowerCase();
  const sample = state.game.latest;
  const currentOmega = Number.parseFloat(sample?.control_omega_target);
  const omega = Number.isFinite(currentOmega) ? currentOmega : 80;
  const currentQ = Number.parseFloat(sample?.control_q_target);
  const currentBeta = Number.parseFloat(sample?.control_beta_target);
  const currentAmp = Number.parseFloat(sample?.control_amp_target);
  const q0 = Number.isFinite(currentQ) ? currentQ : 45;
  const beta0 = Number.isFinite(currentBeta) ? currentBeta : 1.2;
  const amp0 = Number.isFinite(currentAmp) ? currentAmp : 2.5;

  if (!state.refs) {
    return;
  }

  if (key === 'recover') {
    setInputNumber(state.refs.oscOmegaTarget, Math.max(OSC_OMEGA_MIN, omega * 0.98), 1);
    setInputNumber(state.refs.oscQTarget, Math.max(OSC_Q_MIN, q0 * 0.75), 2);
    setInputNumber(state.refs.oscBetaTarget, Math.max(OSC_BETA_MIN, beta0 * 0.85), 3);
    setInputNumber(state.refs.holdAmpTarget, 0.35, 2);
    setStatus('resonator preset: recover lock');
  } else if (key === 'build') {
    setInputNumber(state.refs.oscOmegaTarget, omega, 1);
    setInputNumber(state.refs.oscQTarget, Math.min(OSC_Q_MAX, Math.max(5, q0 * 1.6)), 2);
    setInputNumber(state.refs.oscBetaTarget, Math.min(OSC_BETA_MAX, Math.max(0.2, beta0 * 1.45)), 3);
    setInputNumber(state.refs.holdAmpTarget, Math.min(1, Math.max(0.45, amp0 * 0.08)), 2);
    setStatus('resonator preset: build Q');
  } else if (key === 'push') {
    setInputNumber(state.refs.oscOmegaTarget, Math.min(OSC_OMEGA_MAX, omega * 1.05), 1);
    setInputNumber(state.refs.oscQTarget, Math.min(OSC_Q_MAX, Math.max(8, q0 * 2.4)), 2);
    setInputNumber(state.refs.oscBetaTarget, Math.min(OSC_BETA_MAX, Math.max(0.3, beta0 * 2.1)), 3);
    setInputNumber(state.refs.holdAmpTarget, Math.min(1, Math.max(0.65, amp0 * 0.12)), 2);
    setStatus('resonator preset: push power');
  }

  if (key === 'recover' || key === 'build' || key === 'push') {
    if (state.refs.holdAmpEnabled) {
      state.refs.holdAmpEnabled.checked = true;
    }
    updateControlBarReadouts();
    updateHUD(sample);
  }
}

function nudgeRangeInput(node, step, min, max, digits = 3) {
  if (!node || !Number.isFinite(step)) {
    return NaN;
  }
  const curr = readNumberInput(node, 0);
  const next = clampNumber(curr + step, min, max, curr);
  node.value = next.toFixed(digits);
  return next;
}

function nudgeControlBarsFromKey(key, shift = false) {
  const coarse = shift ? 3 : 1;
  let result = NaN;
  let label = '';
  switch (key) {
    case 'a':
      result = nudgeRangeInput(state.refs?.holdAmpTarget, -0.08 * coarse, -1, 1, 2);
      label = 'amp';
      break;
    case 'd':
      result = nudgeRangeInput(state.refs?.holdAmpTarget, 0.08 * coarse, -1, 1, 2);
      label = 'amp';
      break;
    case 's':
      result = nudgeRangeInput(state.refs?.holdPhiTarget, -0.08 * coarse, -1, 1, 2);
      label = 'phase';
      break;
    case 'w':
      result = nudgeRangeInput(state.refs?.holdPhiTarget, 0.08 * coarse, -1, 1, 2);
      label = 'phase';
      break;
    case 'q':
      result = nudgeRangeInput(state.refs?.holdYawTarget, -0.08 * coarse, -1, 1, 2);
      label = 'yaw';
      break;
    case 'e':
      result = nudgeRangeInput(state.refs?.holdYawTarget, 0.08 * coarse, -1, 1, 2);
      label = 'yaw';
      break;
    case 'k':
      result = nudgeRangeInput(state.refs?.holdPitchTarget, -0.08 * coarse, -1, 1, 2);
      label = 'pitch';
      break;
    case 'i':
      result = nudgeRangeInput(state.refs?.holdPitchTarget, 0.08 * coarse, -1, 1, 2);
      label = 'pitch';
      break;
    default:
      return false;
  }

  updateControlBarReadouts();
  if (label) {
    state.input.lastNudge = `${label}=${formatNumber(result, 3)}${shift ? ' (coarse)' : ''}`;
    setStatus(`nudge ${state.input.lastNudge}`);
  }
  return true;
}

function normalizedCanvasPoint(event, canvas) {
  if (!event || !canvas || typeof canvas.getBoundingClientRect !== 'function') {
    return null;
  }
  const rect = canvas.getBoundingClientRect();
  if (!rect || rect.width <= 1 || rect.height <= 1) {
    return null;
  }
  const x = clampNumber((event.clientX - rect.left - (rect.width * 0.5)) / (rect.width * 0.5), -1, 1, 0);
  const y = clampNumber(((rect.height * 0.5) - (event.clientY - rect.top)) / (rect.height * 0.5), -1, 1, 0);
  return { x, y };
}

function releaseAllKeys() {
  const keys = state.input.keys || {};
  for (const key of Object.keys(keys)) {
    keys[key] = false;
  }
  state.input.activeInput = `locks:[A ${state.refs?.holdAmpEnabled?.checked ? 'on' : 'off'} Φ ${state.refs?.holdPhiEnabled?.checked ? 'on' : 'off'} Y ${state.refs?.holdYawEnabled?.checked ? 'on' : 'off'} P ${state.refs?.holdPitchEnabled?.checked ? 'on' : 'off'}] | levers:[A ${formatNumber(readNumberInput(state.refs?.holdAmpTarget, NaN), 2)} Φ ${formatNumber(readNumberInput(state.refs?.holdPhiTarget, NaN), 2)} Y ${formatNumber(readNumberInput(state.refs?.holdYawTarget, NaN), 2)} P ${formatNumber(readNumberInput(state.refs?.holdPitchTarget, NaN), 2)}] | ${oscillatorTargetSummary()} | final:[A 0.00 Φ 0.00 Y 0.00 P 0.00] | nudge:${state.input.lastNudge || 'none'}`;
  state.input.vectorCommand = 'none';
}

function captureCurrentTargets() {
  const sample = state.game.latest;
  if (!sample) {
    setStatus('no sample to capture yet');
    return;
  }
  syncControlBarsToSample(sample);
  setStatus('captured current coupler targets');
}

function clearNavGoals(reason = '') {
  const hadTop = Boolean(state.input.navTopActive);
  const hadProfile = Boolean(state.input.navProfileActive);
  if (!hadTop && !hadProfile) {
    return false;
  }
  state.input.navTopActive = false;
  state.input.navProfileActive = false;
  state.input.navTopX = 0;
  state.input.navTopY = 0;
  state.input.navTopGoalX = 0;
  state.input.navTopGoalY = 0;
  state.input.navTopGoalZ = 0;
  state.input.navTopGoalMode = 'local';
  state.input.navProfileY = 0;
  if (reason) {
    setStatus(reason);
  }
  return true;
}

function applyAssistPreset(name) {
  const key = String(name || '').toLowerCase();
  if (!state.refs) {
    return;
  }
  state.input.lockAssist = true;
  state.input.assistGoal = 'hold_altitude';
  if (state.refs.autoResonator) {
    state.refs.autoResonator.checked = true;
  }
  if (state.refs.autoTrim) {
    state.refs.autoTrim.checked = true;
  }
  clearNavGoals('nav goals cleared by assist preset');
  unlockAllHoldLocks('assist request: control locks released');

  switch (key) {
    case 'neutral':
      setInputNumber(state.refs.autoWeight, 1.0, 2);
      setInputNumber(state.refs.autoVertical, 0.0, 2);
      setStatus('assist profile: normal-g');
      break;
    default:
      state.input.assistGoal = 'off';
      break;
  }
}

function updateHUD(sample) {
  if (!state.refs || !state.refs.stats) {
    return;
  }
  if (!sample) {
    setResonatorFieldAlert('omega', false);
    setResonatorFieldAlert('q', false);
    setResonatorFieldAlert('beta', false);
    for (const key of Object.keys(state.refs.stats)) {
      setStat(key, '-');
    }
    setStat('map_mode', currentMapMode());
    setStat('ship', selectedShipType());
    setStat('planet', selectedPlanetPreset());
    setStat('model', warpDriveLabel(selectedWarpDrive()));
    setStat('craft_scale', `${formatNumber(currentCraftScale(), 2)} x`);
    setStat('craft_span', `${formatNumber(craftSpanMetersFromScale(currentCraftScale()), 1)} m`);
    setStat('pilot_lock_cmd', state.input.lockAssist ? 'on' : 'off');
    setStat('pilot_auto_trim', state.refs?.autoTrim?.checked ? 'on' : 'off');
    setStat('pilot_active_input', state.input.activeInput || 'none');
    setStat('pilot_last_effect', state.input.lastEffect || 'none');
    setStat('view_speed_sub', 'km/h | vz');
    setStat('view_speed_overlay_main', '-');
    setStat('view_speed_overlay_sub', '-');
    setStat('view_power_required_sub', 'drag | thrust | em | climb');
    setStat('view_power_draw_sub', 'spec | hp');
    setStat('view_altitude', '-');
    setStat('view_weight', '-');
    setStat('view_lock', state.input.lockAssist ? 'cmd on' : '-');
    setStat('view_lock_sub', 'sig na');
    setStat('res_lock_mini', '-');
    setStat('res_phase_mini', '-');
    setStat('res_osc_mini', '-');
    setStat('res_k_mini', '-');
    setStat('res_c_mini', '-');
    setStat('res_power_mini', '-');
    return;
  }

  setStat('time', `${formatNumber(sample.time, 2)} s`);
  setStat('step', `${sample.step}`);
  setStat('altitude', `${formatNumber(sample.altitude, 1)} m`);
  setStat('speed', `${formatNumber(sample.speed, 2)} m/s`);
  setStat('vertical', `${formatNumber(sample.vertical_vel, 2)} m/s`);
  const modelLabel = sample.warp_drive
    ? `${warpDriveLabel(sample.warp_drive)} • ${sample.gravity_model || '-'}${sample.coupler_enabled ? '' : ' off'}`
    : (sample.coupler_enabled
      ? `${sample.gravity_model || '-'} (coupler on)`
      : `${sample.gravity_model || '-'} (coupler off)`);
  setStat('model', modelLabel);
  setStat('ship', String(sample.ship_type || 'saucer').toLowerCase());
  setStat('planet', String(sample.primary_name || selectedPlanetPreset()).toLowerCase());
  setStat('map_mode', currentMapMode());
  const drive = selectedWarpDrive();
  const qStaged = readNumberInput(state.refs?.oscQTarget, Number.parseFloat(sample?.control_q_target));
  const betaStaged = readNumberInput(state.refs?.oscBetaTarget, Number.parseFloat(sample?.control_beta_target));
  const plasmaStaged = readNumberInput(state.refs?.plasmaTarget, Number.parseFloat(sample?.control_plasma_target));
  const throttleStaged = readNumberInput(state.refs?.throttleTarget, Number.parseFloat(sample?.control_throttle_target));
  const emChargeStaged = readNumberInput(state.refs?.emChargeTarget, Number.parseFloat(sample?.control_em_charge_target));
  const eFieldStaged = readNumberInput(state.refs?.eFieldTarget, Number.parseFloat(sample?.control_e_field_target));
  const bFieldStaged = readNumberInput(state.refs?.bFieldTarget, Number.parseFloat(sample?.control_b_field_target));
  setStat(
    'drive_profile',
    `${warpDriveLabel(drive)} | Q ${formatCompactNumber(qStaged, 2)} β ${formatCompactNumber(betaStaged, 3)} plasma ${formatCompactNumber(plasmaStaged, 2)} | thr ${formatCompactNumber(throttleStaged, 2)} em ${formatCompactNumber(emChargeStaged, 1)}C E ${formatCompactNumber(eFieldStaged, 1)}N/C B ${formatCompactNumber(bFieldStaged, 3)}T`
  );
  const craftScale = Number.parseFloat(sample.craft_scale);
  const appliedScale = Number.isFinite(craftScale) ? craftScale : currentCraftScale();
  const craftSpanM = Number.parseFloat(sample.craft_span_m);
  const appliedSpanM = Number.isFinite(craftSpanM) ? craftSpanM : craftSpanMetersFromScale(appliedScale);
  setStat('craft_scale', `${formatNumber(appliedScale, 2)} x`);
  setStat('craft_span', `${formatNumber(appliedSpanM, 1)} m`);

  const mass = Number.parseFloat(sample.craft_mass);
  const vertical = localVerticalMetrics(sample);
  const downRaw = vertical ? vertical.downRaw : NaN;
  const downEff = vertical ? vertical.downEff : NaN;
  const weightN = Number.isFinite(mass) && Number.isFinite(downEff) ? (mass * downEff) : NaN;
  const weightKGF = Number.isFinite(weightN) ? (weightN / 9.80665) : NaN;
  const thetaTarget = Number.parseFloat(sample.control_theta_target);
  const thetaCycle = Number.isFinite(thetaTarget) ? phaseCycle(thetaTarget) : NaN;
  const drivePower = Number.parseFloat(sample.drive_power);
  const plasmaPower = Number.parseFloat(sample.plasma_power);
  const gravPower = Number.parseFloat(sample.grav_power);
  const dragPower = Number.parseFloat(sample.drag_power);
  const thrustPower = Number.parseFloat(sample.thrust_power);
  const emPower = Number.parseFloat(sample.em_power);
  const climbPowerTelemetry = Number.parseFloat(sample.climb_power);
  const requiredPowerTelemetry = Number.parseFloat(sample.required_power);
  const energyRemainingJ = Number.parseFloat(sample.energy);
  const horizonMin = clampNumber(readNumberInput(state.refs?.energyHorizon, 10), 1, 720, 10);
  const specificPower = Number.isFinite(drivePower) && Number.isFinite(mass) && mass > 0 ? (drivePower / mass) : NaN;
  const kWhPerHour = Number.isFinite(drivePower) ? (drivePower / 1000) : NaN;
  const mjPerMin = Number.isFinite(drivePower) ? ((drivePower * 60) / 1e6) : NaN;
  const missionEnergyJ = Number.isFinite(drivePower) ? (drivePower * horizonMin * 60) : NaN;
  const missionKWh = Number.isFinite(missionEnergyJ) ? (missionEnergyJ / 3.6e6) : NaN;
  const batteryNeed100KWh = Number.isFinite(missionKWh) ? (missionKWh / 100) : NaN;
  const gasolineEqLh = Number.isFinite(kWhPerHour) ? (kWhPerHour / 8.9) : NaN;
  const horsepower = Number.isFinite(drivePower) ? (drivePower * 0.00134102209) : NaN;
  const verticalVel = Number.parseFloat(sample.vertical_vel);
  const climbMinPower = Number.isFinite(mass) && Number.isFinite(downRaw) && Number.isFinite(verticalVel)
    ? (mass * downRaw * Math.max(0, verticalVel))
    : NaN;
  const climbPower = Number.isFinite(climbPowerTelemetry) ? Math.max(0, climbPowerTelemetry) : Math.max(0, climbMinPower || 0);
  const reqPlasma = Number.parseFloat(sample.power_req_plasma);
  const reqThrust = Number.parseFloat(sample.power_req_thrust);
  const reqEM = Number.parseFloat(sample.power_req_em);
  const reqCoupler = Number.parseFloat(sample.power_req_coupler);
  const grantCoupler = Number.parseFloat(sample.power_grant_coupler);
  const grantPlasma = Number.parseFloat(sample.power_grant_plasma);
  const grantThrust = Number.parseFloat(sample.power_grant_thrust);
  const grantEM = Number.parseFloat(sample.power_grant_em);
  const curtailFrac = Number.parseFloat(sample.power_curtail_frac);
  const energyPool = Number.parseFloat(sample.energy_pool);
  const climbToDriveRatio = Number.isFinite(climbMinPower) && Number.isFinite(drivePower) && Math.abs(drivePower) > 1e-9
    ? (climbMinPower / drivePower)
    : NaN;
  const fieldWorkRate = Number.isFinite(gravPower) ? Math.abs(gravPower) : NaN;
  const requiredPowerNow = Number.isFinite(requiredPowerTelemetry)
    ? Math.max(0, requiredPowerTelemetry)
    : (
      Math.max(0, dragPower || 0) +
      Math.max(0, thrustPower || 0) +
      Math.max(0, emPower || 0) +
      Math.max(0, climbPower || 0) +
      Math.max(0, plasmaPower || 0)
    );
  const energyInitialJ = state.game.initialEnergy;
  const runUsedJ = Number.isFinite(energyInitialJ) && Number.isFinite(energyRemainingJ)
    ? Math.max(0, energyInitialJ - energyRemainingJ)
    : NaN;
  const runRemainingPct = Number.isFinite(energyInitialJ) && energyInitialJ > 0 && Number.isFinite(energyRemainingJ)
    ? ((energyRemainingJ / energyInitialJ) * 100)
    : NaN;

  setStat('mass', `${formatNumber(mass, 1)} kg`);
  setStat('weight_n', `${formatNumber(weightN, 1)} N`);
  setStat('weight_kgf', `${formatNumber(weightKGF, 2)} kgf`);
  setStat('weight_ratio', `${formatNumber(vertical ? vertical.ratio : NaN, 3)} x`);
  setStat('down_g_raw', `${formatNumber(downRaw, 3)} m/s^2`);
  setStat('down_g_eff', `${formatNumber(downEff, 3)} m/s^2`);
  setStat('view_speed_main', formatVelocityCompact(sample.speed));
  setStat('view_speed_sub', `${formatKmhCompact(sample.speed)} | vz ${formatVelocityCompact(sample.vertical_vel)}`);
  setStat('view_speed_overlay_main', formatVelocityCompact(sample.speed));
  setStat('view_speed_overlay_sub', `${formatKmhCompact(sample.speed)} | vz ${formatVelocityCompact(sample.vertical_vel)}`);
  setStat('view_power_required', formatPowerCompact(requiredPowerNow));
  setStat('view_power_required_sub', `req[c ${formatPowerCompact(reqCoupler)} p ${formatPowerCompact(reqPlasma)} t ${formatPowerCompact(reqThrust)} e ${formatPowerCompact(reqEM)}] grant[c ${formatPowerCompact(grantCoupler)} p ${formatPowerCompact(grantPlasma)} t ${formatPowerCompact(grantThrust)} e ${formatPowerCompact(grantEM)}] cut ${formatPercentCompact(curtailFrac)}`);
  setStat('view_power_draw', formatPowerCompact(drivePower));
  setStat('view_power_draw_sub', `${formatSpecificPowerCompact(specificPower)} | ${formatCompactNumber(horsepower, 1)} hp`);
  setStat('view_altitude', formatDistanceCompact(sample.altitude));
  setStat('view_weight', `${formatCompactNumber(vertical ? vertical.ratio : NaN, 3)} xg`);
  setStat('view_lock', `${formatCompactNumber(sample.lock_quality, 3)} ${sample.lock_flag ? 'lock' : 'open'}`);
  const warn = String(sample.warning_flags || '').trim();
  setStat('view_lock_sub', `sig ${invariantSampleSignature(sample)} • ${validateTrailParity(sample) ? 'sync ok' : 'sync warn'}${warn ? ` • ${warn}` : ''}`);

  setStat('c', formatNumber(sample.coupling_c, 4));
  setStat('k', formatNumber(sample.coupling_k, 4));
  setStat('phi', formatNumber(sample.coupling_phi, 4));
  setStat('res_lock_mini', `${formatCompactNumber(sample.lock_quality, 3)} ${sample.lock_flag ? 'lock' : 'open'}`);
  setStat('res_phase_mini', formatNumber(sample.phase_error, 3));
  setStat('res_osc_mini', formatCompactNumber(sample.osc_mag, 2));
  setStat('res_k_mini', formatNumber(sample.coupling_k, 3));
  setStat('res_c_mini', formatNumber(sample.coupling_c, 3));
  setStat('res_power_mini', formatPowerCompact(drivePower));
  setStat('res_omega0', `${formatNumber(sample.resonator_omega0, 2)} rad/s`);
  setStat('res_q', formatNumber(sample.resonator_q, 1));
  setStat('res_beta', formatNumber(sample.resonator_beta, 3));
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
  setStat('energy_power', `${formatPower(drivePower)} (${formatNumber(horsepower, 1)} hp)`);
  setStat('energy_specific', `${formatNumber(specificPower, 2)} W/kg`);
  setStat('energy_rate', `${formatNumber(kWhPerHour, 3)} kWh/h • ${formatNumber(mjPerMin, 3)} MJ/min`);
  setStat('energy_mission', `${formatNumber(horizonMin, 0)} min -> ${formatNumber(missionKWh, 3)} kWh (${formatEnergy(missionEnergyJ)})`);
  setStat('energy_battery', `${formatNumber(batteryNeed100KWh, 3)} x 100 kWh`);
  setStat('energy_fuel_eq', `${formatNumber(gasolineEqLh, 3)} L/h gasoline-eq`);
  setStat('energy_run_used', `${formatEnergy(runUsedJ)} (${formatNumber(runUsedJ / 3.6e6, 3)} kWh)`);
  setStat('energy_run_remaining', `${formatEnergy(energyRemainingJ)} (${formatNumber(runRemainingPct, 1)}%)`);
  setStat('energy_climb_min', formatPower(climbPower));
  setStat('energy_climb_ratio', `${formatNumber(climbToDriveRatio * 100, 1)}% | pool ${formatEnergy(energyPool)}`);
  setStat('atm_enabled', sample.atmosphere_enabled ? 'on' : 'off');
  setStat('atm_rho0', `${formatCompactNumber(sample.atmosphere_rho0, 3)} kg/m^3`);
  setStat('atm_scale_height', formatDistanceCompact(sample.atmosphere_scale_height));
  setStat('atm_t0', `${formatCompactNumber(sample.atmosphere_temperature0, 2)} K`);
  setStat('atm_lapse', `${formatCompactNumber(sample.atmosphere_lapse_rate, 5)} K/m`);
  setStat('atm_gamma', formatCompactNumber(sample.atmosphere_gamma, 3));
  setStat('atm_r', `${formatCompactNumber(sample.atmosphere_gas_constant, 2)} J/kgK`);
  setStat('mach', formatCompactNumber(sample.mach, 3));
  setStat('aoa', `${formatCompactNumber((sample.aoa_rad || 0) * (180 / Math.PI), 2)} deg`);
  setStat('lift_force', `${formatCompactNumber(sample.lift_force_mag, 3)} N`);
  setStat('thrust_force', `${formatCompactNumber(sample.thrust_force_mag, 3)} N`);
  setStat('em_force', `${formatCompactNumber(sample.em_force_mag, 3)} N`);
  setStat('g_load', `${formatCompactNumber(sample.g_load, 3)} g`);
  setStat('dynamic_q', `${formatPowerCompact(sample.dynamic_pressure)} Pa`);
  setStat('heat_flux', `${formatPowerCompact(sample.heat_flux)} W/m^2`);
  setStat('skin_temp', `${formatCompactNumber(sample.skin_temp_k, 2)} K`);
  setStat('struct_ok', sample.struct_ok ? 'ok' : 'limit');
  setStat('struct_fatigue', formatCompactNumber(sample.struct_fatigue, 3));
  setStat('pilot_ok', sample.pilot_ok ? 'ok' : 'limit');
  setStat('pilot_stress', formatCompactNumber(sample.pilot_stress, 3));
  setStat('g_long', `${formatCompactNumber(sample.g_axis_long, 3)} g`);
  setStat('g_lat', `${formatCompactNumber(sample.g_axis_lat, 3)} g`);
  setStat('g_vert', `${formatCompactNumber(sample.g_axis_vert, 3)} g`);
  setStat('rel_beta', formatCompactNumber(sample.rel_beta, 6));
  setStat('rel_gamma', formatCompactNumber(sample.rel_gamma, 6));
  setStat('warn_flags', warn || 'clear');
  setStat('plasma_target', formatNumber(sample.control_plasma_target, 3));
  setStat('plasma_reduction', formatPercentCompact(sample.plasma_drag_reduction));
  setStat('plasma_power', formatPower(sample.plasma_power));
  setStat('drag_force', `${formatNumber(sample.drag_force_mag, 1)} N`);
  setStat('drag_power', formatPower(dragPower));
  setStat('drag_cd_eff', formatNumber(sample.drag_cd_eff, 3));
  setStat('drag_area_ref', `${formatNumber(sample.drag_area_ref, 2)} m^2`);
  setStat('amp_target', formatNumber(sample.control_amp_target, 3));
  setStat('theta_target', `${formatNumber(thetaTarget, 3)} rad`);
  setStat('theta_cycle', `${formatNumber(thetaCycle, 3)} cyc`);
  setStat('omega_target', `${formatNumber(sample.control_omega_target, 2)} rad/s`);
  setStat('q_target', formatNumber(sample.control_q_target, 1));
  setStat('beta_target', formatNumber(sample.control_beta_target, 3));
  setStat('plasma_target_control', formatNumber(sample.control_plasma_target, 3));
  setStat('axis_yaw', formatNumber(sample.control_axis_yaw, 3));
  setStat('axis_pitch', formatNumber(sample.control_axis_pitch, 3));
  setStat('warp_x', formatNumber(sample.control_warp_x, 3));
  setStat('warp_y', formatNumber(sample.control_warp_y, 3));
  setStat('warp_z', formatNumber(sample.control_warp_z, 3));
  setStat('lock_assist', sample.control_lock_assist ? 'on' : 'off');
  setStat('amp_axis', formatNumber(sample.control_amp_axis, 2));
  setStat('phi_axis', formatNumber(sample.control_phi_axis, 2));
  setStat('yaw_axis', formatNumber(sample.control_yaw_axis, 2));
  setStat('pitch_axis', formatNumber(sample.control_pitch_axis, 2));
  setStat('pilot_set_amp', formatNumber(sample.control_amp_target, 3));
  setStat('pilot_set_phase', `${formatNumber(thetaCycle, 3)} cyc (${formatNumber(thetaTarget, 3)} rad)`);
  setStat('pilot_set_yaw', formatNumber(sample.control_axis_yaw, 3));
  setStat('pilot_set_pitch', formatNumber(sample.control_axis_pitch, 3));
  setStat('pilot_lock_cmd', state.input.lockAssist ? 'on' : 'off');
  setStat('pilot_auto_trim', state.refs?.autoTrim?.checked ? 'on' : 'off');
  setStat('pilot_active_input', state.input.activeInput || 'none');
  setStat(
    'pilot_last_effect',
    `${state.input.lastEffect || 'none'} | phase:${sample.assist_phase || '-'} dist:${formatNumber(sample.nav_distance, 1)}m valong:${formatNumber(sample.nav_v_along, 2)}m/s coast:${sample.coast_capture ? 'yes' : 'no'} | applied:[A ${formatNumber(sample.control_amp_axis, 2)} Φ ${formatNumber(sample.control_phi_axis, 2)} Y ${formatNumber(sample.control_yaw_axis, 2)} P ${formatNumber(sample.control_pitch_axis, 2)}]`
  );

  const last = state.input.lastControl || {};
  setStat('control_mode', `${last.mode || 'manual'} | ${sample.assist_phase || '-'}`);
  setStat('manual_amp', formatNumber(last.manualAmp, 2));
  setStat('manual_phi', formatNumber(last.manualPhi, 2));
  setStat('manual_yaw', formatNumber(last.manualYaw, 2));
  setStat('manual_pitch', formatNumber(last.manualPitch, 2));
  setStat('auto_amp', formatNumber(last.autoAmp, 2));
  setStat('auto_phi', formatNumber(last.autoPhi, 2));
  setStat('auto_yaw', formatNumber(last.autoYaw, 2));
  setStat('auto_pitch', formatNumber(last.autoPitch, 2));

  const lockQuality = Number.parseFloat(sample.lock_quality);
  const phaseErrAbs = Math.abs(Number.parseFloat(sample.phase_error) || 0);
  const oscMag = Number.parseFloat(sample.osc_mag);
  const lowLock = !Number.isFinite(lockQuality) || lockQuality < 0.9;
  const highPhaseErr = phaseErrAbs > 0.08;
  const lowOscMag = !Number.isFinite(oscMag) || oscMag < 8.0;
  setResonatorFieldAlert('omega', lowLock && highPhaseErr);
  setResonatorFieldAlert('q', lowLock || lowOscMag);
  setResonatorFieldAlert('beta', lowLock || lowOscMag || highPhaseErr);
}

function pushTrail(sample) {
  if (!sample || !sample.position) {
    return;
  }
  const rx = Number.isFinite(sample.position?.x) && Number.isFinite(sample.primary_position?.x)
    ? (sample.position.x - sample.primary_position.x)
    : 0;
  const ry = Number.isFinite(sample.position?.y) && Number.isFinite(sample.primary_position?.y)
    ? (sample.position.y - sample.primary_position.y)
    : 0;
  const rz = Number.isFinite(sample.position?.z) && Number.isFinite(sample.primary_position?.z)
    ? (sample.position.z - sample.primary_position.z)
    : 0;
  state.game.trailTop.push({
    x: sample.position.x,
    y: sample.position.y,
    rx,
    ry,
    rz
  });
  state.game.trailSide.push({
    x: sample.position.x,
    z: sample.position.z,
    alt: sample.altitude,
    rx,
    ry,
    rz
  });
  state.game.trail3D.push({
    x: sample.position.x,
    y: sample.position.y,
    z: sample.position.z,
    alt: sample.altitude,
    rx,
    ry,
    rz
  });

  while (state.game.trailTop.length > state.game.maxTrail) {
    state.game.trailTop.shift();
  }
  while (state.game.trailSide.length > state.game.maxTrail) {
    state.game.trailSide.shift();
  }
  while (state.game.trail3D.length > state.game.maxTrail) {
    state.game.trail3D.shift();
  }
}

function validateTrailParity(sample) {
  if (!sample || !sample.position || !state.game.trail3D.length) {
    return true;
  }
  const tail = state.game.trail3D[state.game.trail3D.length - 1];
  if (!tail) {
    return true;
  }
  const dx = Math.abs((Number.parseFloat(tail.x) || 0) - (Number.parseFloat(sample.position.x) || 0));
  const dy = Math.abs((Number.parseFloat(tail.y) || 0) - (Number.parseFloat(sample.position.y) || 0));
  const dz = Math.abs((Number.parseFloat(tail.z) || 0) - (Number.parseFloat(sample.position.z) || 0));
  return dx < 1e-3 && dy < 1e-3 && dz < 1e-3;
}

function clearTrails() {
  state.game.trailTop = [];
  state.game.trailSide = [];
  state.game.trail3D = [];
  state.game.telemetryHistory = [];
}

function renderLatestSample() {
  if (!state.renderer) {
    return;
  }
  state.renderer.setPlanetaryCamera(currentPlanetaryZoom(), currentPlanetaryCameraMode());
  state.renderer.draw(state.game.latest, state.game.trailTop, state.game.trailSide, state.game.trail3D, currentMapMode());
  drawTelemetryGraphs();
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

  const scenario = activeScenarioName();
  const formatKey = String(format || 'zip').toLowerCase();
  const ext = formatKey === 'csv' ? 'csv' : formatKey === 'meta' ? 'meta.json' : 'zip';
  const fallbackName = `free_play-export.${ext}`;

  state.exporting = true;
  setStatus(`exporting free_play (${formatKey})...`);
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

  await stopGameSession(true);

  const scenario = activeScenarioName();
  const warpDrive = selectedWarpDrive();
  const shipType = selectedShipType();
  const craftScale = currentCraftScale();
  const planetPreset = selectedPlanetPreset();
  state.game.mapMode = currentMapMode();
  setStatus(`starting free_play • ${warpDriveLabel(warpDrive)}...`);
  const startOnGround = Boolean(state.refs?.startGround?.checked);

  try {
    const payload = await apiPost('/api/game/start', {
      scenario,
      start_on_ground: startOnGround,
      ship_type: shipType,
      warp_drive: warpDrive,
      planet_preset: planetPreset,
      craft_scale: craftScale
    });
    state.game.sessionId = payload.session_id || '';
    state.game.dt = Number.parseFloat(payload.dt) || Number.parseFloat(payload?.state?.dt) || (1 / 120);
    state.game.running = true;
    state.game.paused = false;
    state.game.requestInFlight = false;
    state.game.lastFrameTs = 0;
    state.game.accumulator = 0;
    state.game.latest = payload.state || null;
    state.game.initialEnergy = Number.parseFloat(state.game.latest?.energy);
    if (!Number.isFinite(state.game.initialEnergy)) {
      state.game.initialEnergy = NaN;
    }
    if (state.refs?.holdAmpEnabled) {
      state.refs.holdAmpEnabled.checked = false;
    }
    if (state.refs?.holdPhiEnabled) {
      state.refs.holdPhiEnabled.checked = false;
    }
    if (state.refs?.holdYawEnabled) {
      state.refs.holdYawEnabled.checked = false;
    }
    if (state.refs?.holdPitchEnabled) {
      state.refs.holdPitchEnabled.checked = false;
    }
    if (state.refs?.autoTrim) {
      state.refs.autoTrim.checked = false;
    }
    if (state.refs?.autoResonator) {
      state.refs.autoResonator.checked = false;
    }
    syncControlBarsToSample(state.game.latest);
    clearTrails();
    pushTrail(state.game.latest);
    pushTelemetryHistory(state.game.latest);
    state.input.lockAssist = false;
    state.input.assistGoal = 'off';
    state.input.lastControl = {
      mode: 'manual',
      manualAmp: 0,
      manualPhi: 0,
      manualYaw: 0,
      manualPitch: 0,
      autoAmp: 0,
      autoPhi: 0,
      autoYaw: 0,
      autoPitch: 0,
      finalAmp: 0,
      finalPhi: 0,
      finalYaw: 0,
      finalPitch: 0
    };
    state.input.lastNudge = 'none';
    state.input.navTopActive = false;
    state.input.navProfileActive = false;
    state.input.navTopX = 0;
    state.input.navTopY = 0;
    state.input.navTopGoalX = 0;
    state.input.navTopGoalY = 0;
    state.input.navTopGoalZ = 0;
    state.input.navTopGoalMode = 'local';
    state.input.navProfileY = 0;
    state.input.overrideUntilS = 0;
    state.input.activeInput = `locks:[A off Φ off Y off P off] | free mode | ${oscillatorTargetSummary(state.game.latest)} | nudge:none`;
    updateControlEffect(null, state.game.latest);
    if (state.refs?.pauseButton) {
      state.refs.pauseButton.textContent = 'Pause';
    }
    updateHUD(state.game.latest);
    renderLatestSample();
    const couplerEnabled = Boolean(state.game.latest?.coupler_enabled);
    if (!couplerEnabled) {
      setStatus('running free_play • coupler off • pilot/assist controls are telemetry-only here');
    } else {
      setStatus(`running free_play • planet=${planetPreset} • ship=${shipType} • scale=${formatNumber(craftScale, 2)}x • map=${state.game.mapMode} • dt=${state.game.dt.toFixed(4)} s • ${startOnGround ? 'ground start' : 'default start'}`);
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
  state.game.initialEnergy = NaN;
  state.game.speedometerScale = 400;
  state.game.telemetryHistory = [];
  if (state.game.rafId) {
    window.cancelAnimationFrame(state.game.rafId);
    state.game.rafId = 0;
  }
  if (state.refs?.pauseButton) {
    state.refs.pauseButton.textContent = 'Pause';
  }
  state.input.activeInput = 'none';
  state.input.lastEffect = 'none';
  state.input.lastNudge = 'none';
  state.input.navTopActive = false;
  state.input.navProfileActive = false;
  state.input.navTopX = 0;
  state.input.navTopY = 0;
  state.input.navTopGoalX = 0;
  state.input.navTopGoalY = 0;
  state.input.navTopGoalZ = 0;
  state.input.navTopGoalMode = 'local';
  state.input.navProfileY = 0;
  state.input.overrideUntilS = 0;
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
  const holdAmpEnabled = Boolean(state.refs?.holdAmpEnabled?.checked);
  const holdPhiEnabled = Boolean(state.refs?.holdPhiEnabled?.checked);
  const holdYawEnabled = Boolean(state.refs?.holdYawEnabled?.checked);
  const holdPitchEnabled = Boolean(state.refs?.holdPitchEnabled?.checked);
  const leverAmp = clampUnit(readNumberInput(state.refs?.holdAmpTarget, 0));
  const leverPhi = clampUnit(readNumberInput(state.refs?.holdPhiTarget, 0));
  const leverYaw = clampUnit(readNumberInput(state.refs?.holdYawTarget, 0));
  const leverPitch = clampUnit(readNumberInput(state.refs?.holdPitchTarget, 0));
  const oscTargets = currentOscillatorTargets(sample);
  const plasmaTarget = currentPlasmaTarget(sample);
  const throttleTarget = clampNumber(
    readNumberInput(state.refs?.throttleTarget, Number.parseFloat(sample?.control_throttle_target)),
    -1, 1, 0
  );
  const emChargeTarget = clampNumber(
    readNumberInput(state.refs?.emChargeTarget, Number.parseFloat(sample?.control_em_charge_target)),
    -20000, 20000, 0
  );
  const eFieldTarget = clampNumber(
    readNumberInput(state.refs?.eFieldTarget, Number.parseFloat(sample?.control_e_field_target)),
    -100000, 100000, 0
  );
  const bFieldTarget = clampNumber(
    readNumberInput(state.refs?.bFieldTarget, Number.parseFloat(sample?.control_b_field_target)),
    -5, 5, 0
  );
  const navTopTxt = state.input.navTopActive ? 'on' : 'off';
  const navProfileTxt = state.input.navProfileActive ? 'on' : 'off';
  state.input.lastControl = {
    mode: state.input.lockAssist ? 'assist-intent' : 'manual-intent',
    manualAmp: leverAmp,
    manualPhi: leverPhi,
    manualYaw: leverYaw,
    manualPitch: leverPitch,
    autoAmp: 0,
    autoPhi: 0,
    autoYaw: 0,
    autoPitch: 0,
    finalAmp: leverAmp,
    finalPhi: leverPhi,
    finalYaw: leverYaw,
    finalPitch: leverPitch
  };
  state.input.activeInput = `locks:[A ${holdAmpEnabled ? 'on' : 'off'} Φ ${holdPhiEnabled ? 'on' : 'off'} Y ${holdYawEnabled ? 'on' : 'off'} P ${holdPitchEnabled ? 'on' : 'off'}] | levers:[A ${formatNumber(leverAmp, 2)} Φ ${formatNumber(leverPhi, 2)} Y ${formatNumber(leverYaw, 2)} P ${formatNumber(leverPitch, 2)}] nav[top ${navTopTxt} | side ${navProfileTxt}] | ${oscillatorTargetSummary(sample)} | nudge:${state.input.lastNudge || 'none'}`;

  return {
    amp_axis: leverAmp,
    phi_axis: leverPhi,
    yaw_axis: leverYaw,
    pitch_axis: leverPitch,
    hold_amp_lock: holdAmpEnabled,
    hold_phi_lock: holdPhiEnabled,
    hold_yaw_lock: holdYawEnabled,
    hold_pitch_lock: holdPitchEnabled,
    omega_target: oscTargets.omega,
    q_target: oscTargets.q,
    beta_target: oscTargets.beta,
    plasma_target: plasmaTarget,
    throttle_target: throttleTarget,
    em_charge_target: emChargeTarget,
    e_field_target: eFieldTarget,
    b_field_target: bFieldTarget,
    lock_assist: state.input.lockAssist,
    auto_trim: Boolean(state.refs?.autoTrim?.checked),
    assist_goal: String(state.input.assistGoal || 'off'),
    auto_weight: readNumberInput(state.refs?.autoWeight, 1.0),
    auto_vertical: readNumberInput(state.refs?.autoVertical, 0.0),
    auto_altitude: Math.max(0, readNumberInput(state.refs?.autoAltitude, Number.parseFloat(sample?.altitude))),
    assist_speed_cap: readNumberInput(state.refs?.assistSpeedCap, 0.24),
    assist_brake_gain: readNumberInput(state.refs?.assistBrakeGain, 1.0),
    nav_max_speed: readNumberInput(state.refs?.navMaxSpeed, 320),
    nav_stop_radius: readNumberInput(state.refs?.navStopRadius, 120),
    nav_top_active: Boolean(state.input.navTopActive),
    nav_top_goal_x: Number.parseFloat(state.input.navTopGoalX) || 0,
    nav_top_goal_y: Number.parseFloat(state.input.navTopGoalY) || 0,
    nav_top_goal_z: Number.parseFloat(state.input.navTopGoalZ) || 0,
    nav_top_goal_mode: String(state.input.navTopGoalMode || 'local'),
    nav_profile_active: Boolean(state.input.navProfileActive)
  };
}

async function requestStep(steps) {
  if (!state.game.running || state.game.requestInFlight || !state.game.sessionId) {
    return;
  }

  state.game.requestInFlight = true;
  try {
    const prevSample = state.game.latest;
    const payload = await apiPost('/api/game/step', {
      session_id: state.game.sessionId,
      steps,
      controls: currentControlPayload(state.game.latest)
    });
    const sample = payload?.state || null;
    if (!sample) {
      throw new Error('empty step response');
    }
    const validity = validateSample(sample);
    if (!validity.ok) {
      throw new Error(`invalid sample: ${validity.reason}`);
    }
    const monotonic = validateMonotonicTransition(prevSample, sample);
    if (!monotonic.ok) {
      throw new Error(`invalid transition: ${monotonic.reason}`);
    }
    state.game.latest = sample;
    if (sample.nav_top_reached) {
      state.input.navTopActive = false;
      state.input.navTopX = 0;
      state.input.navTopY = 0;
      setStatus('nav target reached (top)');
    }
    if (sample.nav_profile_reached) {
      state.input.navProfileActive = false;
      state.input.navProfileY = 0;
      setStatus('nav target reached (profile)');
    }
    maybeWarnBlockedByLocks(sample);
    updateControlEffect(prevSample, sample);
    syncUnlockedControlBarsToSample(sample);
    pushTrail(sample);
    pushTelemetryHistory(sample);
    const moved = Boolean(
      prevSample && prevSample.position && sample.position &&
      (
        Math.abs((sample.position.x || 0) - (prevSample.position.x || 0)) > 1e-9 ||
        Math.abs((sample.position.y || 0) - (prevSample.position.y || 0)) > 1e-9 ||
        Math.abs((sample.position.z || 0) - (prevSample.position.z || 0)) > 1e-9
      )
    );
    if (moved && !validateTrailParity(sample)) {
      setStatus('sync warning: trail/render source mismatch');
    }
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

  if ((ts - state.game.lastFrameTs) < BROWSER_FRAME_INTERVAL_MS) {
    state.game.rafId = window.requestAnimationFrame(gameLoop);
    return;
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

  renderLatestSample();
  state.game.rafId = window.requestAnimationFrame(gameLoop);
}

function isTypingTarget(target) {
  if (!target) {
    return false;
  }
  const tag = target.tagName ? target.tagName.toLowerCase() : '';
  return tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'button' || target.isContentEditable;
}

function setupEvents() {
  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-guide-open]')) {
      event.preventDefault();
      openGuideModal();
      return;
    }

    if (event.target.closest('[data-guide-close]')) {
      event.preventDefault();
      closeGuideModal();
      return;
    }

    if (event.target instanceof Element && event.target.matches('[data-guide-modal]')) {
      event.preventDefault();
      closeGuideModal();
      return;
    }

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

    if (event.target.closest('[data-calibration-refresh]')) {
      event.preventDefault();
      void fetchCalibrationSummary();
      return;
    }

    if (event.target.closest('[data-control-bars-center]')) {
      event.preventDefault();
      centerControlBars();
      return;
    }

    if (event.target.closest('[data-hold-capture]')) {
      event.preventDefault();
      captureCurrentTargets();
      return;
    }

    const presetButton = event.target.closest('[data-assist-preset]');
    if (presetButton) {
      event.preventDefault();
      const preset = presetButton.getAttribute('data-assist-preset') || '';
      applyAssistPreset(preset);
      return;
    }

    const resonatorPresetButton = event.target.closest('[data-resonator-preset]');
    if (resonatorPresetButton) {
      event.preventDefault();
      const preset = resonatorPresetButton.getAttribute('data-resonator-preset') || '';
      applyResonatorPreset(preset);
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
    const key = (event.key || '').toLowerCase();
    if (key === 'escape' && isGuideModalOpen()) {
      event.preventDefault();
      closeGuideModal();
      return;
    }
    if (isGuideModalOpen()) {
      return;
    }

    if (isTypingTarget(event.target)) {
      return;
    }
    if (key === ' ') {
      event.preventDefault();
      if (!event.repeat) {
        state.input.lockAssist = !state.input.lockAssist;
        setStatus(`lock assist ${state.input.lockAssist ? 'on' : 'off'}`);
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
    if (key === 'w' || key === 'a' || key === 's' || key === 'd' || key === 'q' || key === 'e' || key === 'i' || key === 'k') {
      event.preventDefault();
      nudgeControlBarsFromKey(key, Boolean(event.shiftKey));
      clearNavGoals('nav goals cleared by manual control input');
    }
  }, true);

  document.addEventListener('keyup', (event) => {
    const key = (event.key || '').toLowerCase();
    if (key === 'w' || key === 'a' || key === 's' || key === 'd' || key === 'q' || key === 'e' || key === 'i' || key === 'k') {
      event.preventDefault();
      state.input.keys[key] = false;
    }
  }, true);

  document.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    if (target.matches('[data-map-mode]')) {
      state.game.mapMode = currentMapMode();
      updateHUD(state.game.latest);
      renderLatestSample();
      return;
    }
    if (target.matches('[data-telemetry-normalize]')) {
      renderLatestSample();
      return;
    }
    if (target.matches('[data-planetary-camera]') || target.matches('[data-planetary-zoom]')) {
      renderLatestSample();
      return;
    }
    if (target.matches('[data-planet-preset]')) {
      updateHUD(state.game.latest);
      return;
    }
    if (target.matches('[data-warp-drive]')) {
      applyWarpDriveUiDefaults(selectedWarpDrive(), false);
      updateHUD(state.game.latest);
      if (state.game.running) {
        setStatus(`${warpDriveLabel(selectedWarpDrive())} selected • reset/start session to apply`);
      } else {
        setStatus(`${warpDriveLabel(selectedWarpDrive())} profile staged`);
      }
      return;
    }
    if (target.matches('[data-craft-scale]')) {
      updateCraftScaleReadout();
      updateHUD(state.game.latest);
      if (state.game.running) {
        setStatus(`craft scale set to ${formatNumber(currentCraftScale(), 2)}x • reset/start session to apply`);
      }
      return;
    }
    if (target.matches('[data-game-speed]')) {
      updateSimSpeedReadout();
      setStatus(`sim speed ${formatNumber(clampNumber(readNumberInput(state.refs?.speed, 1), 0.25, 8, 1), 2)}x`);
      return;
    }
    if (target.matches('[data-ship-type]')) {
      updateHUD(state.game.latest);
      return;
    }
    if (target.matches('[data-auto-resonator]')) {
      setStatus(Boolean(state.refs?.autoResonator?.checked) ? 'auto resonator on' : 'auto resonator off');
      updateControlBarReadouts();
      updateHUD(state.game.latest);
      return;
    }
    if (target.matches('[data-auto-trim]')) {
      const enabled = Boolean(state.refs?.autoTrim?.checked);
      if (!enabled) {
        state.input.assistGoal = 'off';
        setStatus('assist disabled');
      } else {
        unlockAllHoldLocks('auto trim enabled: control locks released');
        state.input.assistGoal = 'hold_altitude';
        setStatus('assist enabled • target altitude hold active');
      }
      updateHUD(state.game.latest);
      return;
    }
    if (
      target.matches('[data-hold-amp-target]') ||
      target.matches('[data-hold-phi-target]') ||
      target.matches('[data-osc-omega-target]') ||
      target.matches('[data-osc-q-target]') ||
      target.matches('[data-osc-beta-target]') ||
      target.matches('[data-auto-resonator]') ||
      target.matches('[data-plasma-target]') ||
      target.matches('[data-throttle-target]') ||
      target.matches('[data-em-charge-target]') ||
      target.matches('[data-e-field-target]') ||
      target.matches('[data-b-field-target]') ||
      target.matches('[data-assist-speed-cap]') ||
      target.matches('[data-assist-brake-gain]') ||
      target.matches('[data-nav-max-speed]') ||
      target.matches('[data-nav-stop-radius]') ||
      target.matches('[data-auto-weight]') ||
      target.matches('[data-auto-vertical]') ||
      target.matches('[data-auto-altitude]') ||
      target.matches('[data-hold-yaw-target]') ||
      target.matches('[data-hold-pitch-target]') ||
      target.matches('[data-prop-lateral]') ||
      target.matches('[data-prop-forward]') ||
      target.matches('[data-hold-amp-enabled]') ||
      target.matches('[data-hold-phi-enabled]') ||
      target.matches('[data-hold-yaw-enabled]') ||
      target.matches('[data-hold-pitch-enabled]')
    ) {
      if (
        target.matches('[data-hold-amp-target]') ||
        target.matches('[data-hold-phi-target]') ||
        target.matches('[data-hold-yaw-target]') ||
        target.matches('[data-hold-pitch-target]') ||
        target.matches('[data-plasma-target]') ||
        target.matches('[data-throttle-target]') ||
        target.matches('[data-em-charge-target]') ||
        target.matches('[data-e-field-target]') ||
        target.matches('[data-b-field-target]') ||
        target.matches('[data-prop-lateral]') ||
        target.matches('[data-prop-forward]') ||
        target.matches('[data-hold-amp-enabled]') ||
        target.matches('[data-hold-phi-enabled]') ||
        target.matches('[data-hold-yaw-enabled]') ||
        target.matches('[data-hold-pitch-enabled]')
      ) {
        clearNavGoals('nav goals cleared by direct control override');
        if (target.matches('[data-prop-lateral]') || target.matches('[data-prop-forward]')) {
          unlockAllHoldLocks('propulsion stick: control locks released');
          applyPropulsionStickIntent();
        }
      }
      syncUnlockedControlBarsToSample(state.game.latest);
      updateControlBarReadouts();
      updateHUD(state.game.latest);
    }
  }, true);

  document.addEventListener('input', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    if (
      target.matches('[data-craft-scale]') ||
      target.matches('[data-game-speed]') ||
      target.matches('[data-hold-amp-target]') ||
      target.matches('[data-hold-phi-target]') ||
      target.matches('[data-osc-omega-target]') ||
      target.matches('[data-osc-q-target]') ||
      target.matches('[data-osc-beta-target]') ||
      target.matches('[data-auto-resonator]') ||
      target.matches('[data-plasma-target]') ||
      target.matches('[data-throttle-target]') ||
      target.matches('[data-em-charge-target]') ||
      target.matches('[data-e-field-target]') ||
      target.matches('[data-b-field-target]') ||
      target.matches('[data-assist-speed-cap]') ||
      target.matches('[data-assist-brake-gain]') ||
      target.matches('[data-nav-max-speed]') ||
      target.matches('[data-nav-stop-radius]') ||
      target.matches('[data-auto-weight]') ||
      target.matches('[data-auto-vertical]') ||
      target.matches('[data-auto-altitude]') ||
      target.matches('[data-hold-yaw-target]') ||
      target.matches('[data-hold-pitch-target]') ||
      target.matches('[data-prop-lateral]') ||
      target.matches('[data-prop-forward]')
    ) {
      if (
        target.matches('[data-hold-amp-target]') ||
        target.matches('[data-hold-phi-target]') ||
        target.matches('[data-hold-yaw-target]') ||
        target.matches('[data-hold-pitch-target]') ||
        target.matches('[data-plasma-target]') ||
        target.matches('[data-throttle-target]') ||
        target.matches('[data-em-charge-target]') ||
        target.matches('[data-e-field-target]') ||
        target.matches('[data-b-field-target]') ||
        target.matches('[data-prop-lateral]') ||
        target.matches('[data-prop-forward]')
      ) {
        clearNavGoals('nav goals cleared by direct control override');
        if (target.matches('[data-prop-lateral]') || target.matches('[data-prop-forward]')) {
          unlockAllHoldLocks('propulsion stick: control locks released');
          applyPropulsionStickIntent();
        }
      }
      if (target.matches('[data-craft-scale]')) {
        updateCraftScaleReadout();
        updateHUD(state.game.latest);
      }
      if (target.matches('[data-game-speed]')) {
        updateSimSpeedReadout();
        setStatus(`sim speed ${formatNumber(clampNumber(readNumberInput(state.refs?.speed, 1), 0.25, 8, 1), 2)}x`);
      }
      updateControlBarReadouts();
    }
  }, true);

  document.addEventListener('pointerup', (event) => {
    state.game.worldCameraDragging = false;
    maybeSpringReturnLever(event.target);
    if (state.input?.propulsionStickActive) {
      state.input.propulsionStickActive = false;
      resetPropulsionStickIntent();
      updateControlBarReadouts();
    }
  }, true);
  document.addEventListener('pointercancel', () => {
    state.game.worldCameraDragging = false;
    if (state.input?.propulsionStickActive) {
      state.input.propulsionStickActive = false;
      resetPropulsionStickIntent();
      updateControlBarReadouts();
    }
  }, true);
  document.addEventListener('pointerdown', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    if (target.matches('[data-prop-lateral]') || target.matches('[data-prop-forward]')) {
      state.input.propulsionStickActive = true;
      unlockAllHoldLocks('propulsion stick: control locks released');
      clearNavGoals('nav goals cleared by direct control override');
      return;
    }
    if (target.matches('[data-game-canvas-top]') || target.matches('[data-game-canvas-side]')) {
      const canvas = target;
      const point = normalizedCanvasPoint(event, canvas);
      if (!point) {
        return;
      }
      state.input.lockAssist = true;
      if (state.refs?.autoTrim) {
        state.refs.autoTrim.checked = true;
      }
      if (state.refs?.autoResonator) {
        state.refs.autoResonator.checked = true;
      }
      unlockAllHoldLocks('nav goal set: control locks released');
      if (target.matches('[data-game-canvas-top]')) {
        const latest = state.game.latest;
        const scale = state.renderer ? state.renderer.planetaryZoom : 1;
        const mode = String(state.game.mapMode || 'planetary').toLowerCase() === 'local' ? 'local' : 'planetary';
        const clickX = point.x * 0.42;
        const clickY = point.y * 0.42;
        if (latest && mode === 'planetary' && Number.isFinite(latest.primary_radius) && latest.primary_radius > 0) {
          const radius = latest.primary_radius;
          const rx = Number.isFinite(latest.position?.x) && Number.isFinite(latest.primary_position?.x)
            ? (latest.position.x - latest.primary_position.x)
            : 0;
          const ry = Number.isFinite(latest.position?.y) && Number.isFinite(latest.primary_position?.y)
            ? (latest.position.y - latest.primary_position.y)
            : 0;
          const rz = Number.isFinite(latest.position?.z) && Number.isFinite(latest.primary_position?.z)
            ? (latest.position.z - latest.primary_position.z)
            : 0;
          const followRange = state.renderer ? state.renderer.planetaryFollowRange(latest, radius, 6000) : 6000;
          const topScale = state.renderer ? state.renderer.planetaryFollowScale(canvas.clientWidth, canvas.clientHeight, followRange, scale) : 1;
          state.input.navTopGoalX = rx + ((clickX * canvas.clientWidth) / Math.max(1e-6, 2 * topScale));
          state.input.navTopGoalY = ry + ((clickY * canvas.clientHeight) / Math.max(1e-6, 2 * topScale));
          state.input.navTopGoalZ = rz;
          state.input.navTopGoalMode = 'planetary';
        } else {
          const anchorX = Number.isFinite(latest?.position?.x) ? latest.position.x : 0;
          const anchorY = Number.isFinite(latest?.position?.y) ? latest.position.y : 0;
          const scaleNow = state.renderer
            ? state.renderer.scaleFromTrail(state.game.trailTop, canvas.clientWidth, canvas.clientHeight, (trailPoint) => [trailPoint.x - anchorX, trailPoint.y - anchorY], 1200)
            : 1;
          state.input.navTopGoalX = anchorX + ((clickX * canvas.clientWidth) / Math.max(1e-6, 2 * scaleNow));
          state.input.navTopGoalY = anchorY + ((clickY * canvas.clientHeight) / Math.max(1e-6, 2 * scaleNow));
          state.input.navTopGoalZ = Number.isFinite(latest?.position?.z) ? latest.position.z : 0;
          state.input.navTopGoalMode = 'local';
        }
        state.input.navTopX = clickX;
        state.input.navTopY = clickY;
        state.input.navTopActive = true;
        setStatus(`nav set (top): x=${formatNumber(clickX, 2)} y=${formatNumber(clickY, 2)}`);
      } else {
        state.input.navProfileY = point.y;
        state.input.navProfileActive = true;
        const altNow = Math.max(0, Number.parseFloat(state.game.latest?.altitude) || 0);
        const altGoal = Math.max(0, altNow + (point.y * 6000));
        setInputNumber(state.refs?.autoAltitude, altGoal, 1);
        setStatus(`nav set (profile): y=${formatNumber(point.y, 2)} alt=${formatNumber(altGoal, 1)} m`);
      }
      updateHUD(state.game.latest);
      event.preventDefault();
      return;
    }
    if (!target.matches('[data-game-canvas-3d]')) {
      return;
    }
    state.game.worldCameraDragging = true;
    state.game.worldCameraLastX = event.clientX;
    state.game.worldCameraLastY = event.clientY;
    event.preventDefault();
  }, true);
  document.addEventListener('pointermove', (event) => {
    if (!state.game.worldCameraDragging || !state.renderer) {
      return;
    }
    const dx = event.clientX - state.game.worldCameraLastX;
    const dy = event.clientY - state.game.worldCameraLastY;
    state.game.worldCameraLastX = event.clientX;
    state.game.worldCameraLastY = event.clientY;
    const sensitivity = 0.0045;
    state.renderer.nudgeWorldOrbit(-dx * sensitivity, -dy * sensitivity);
    renderLatestSample();
    event.preventDefault();
  }, true);
  document.addEventListener('mouseup', (event) => {
    state.game.worldCameraDragging = false;
    maybeSpringReturnLever(event.target);
  }, true);
  document.addEventListener('touchend', (event) => {
    const touch = event.changedTouches && event.changedTouches[0];
    const target = touch ? document.elementFromPoint(touch.clientX, touch.clientY) : event.target;
    maybeSpringReturnLever(target);
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

  window.addEventListener('blur', () => {
    releaseAllKeys();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') {
      releaseAllKeys();
    }
  });
}

async function boot() {
  ensureRecyclrMount();
  normalizePaperNavSelection();
  setupEvents();
  maybeInitLab();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  void boot();
}
