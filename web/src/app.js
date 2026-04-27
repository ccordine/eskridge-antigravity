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
    trail3D: [],
    maxTrail: 900,
    mapMode: 'planetary'
  },
  input: {
    keys: Object.create(null),
    lockAssist: true,
    lastControl: {
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
    }
  },
  exporting: false
};

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
    let craftX = w * 0.5;
    let craftY = h * 0.5;
    let topScale = 1;

    if (mode === 'planetary' && Number.isFinite(sample.primary_radius) && sample.primary_radius > 0) {
      topScale = this.scaleFromPlanetaryTrail(trail, w, h, sample.primary_radius, (point) => [point.rx, point.ry], 0.6);
      this.paintPlanetCircle(ctx, w * 0.5, h * 0.5, sample.primary_radius * topScale);
      this.paintTrail(ctx, trail, topScale, w, h, (point) => ({
        x: (point.rx * topScale) + w * 0.5,
        y: h * 0.5 - (point.ry * topScale)
      }), 'rgba(15, 106, 115, 0.45)');
      const rx = Number.isFinite(sample.position?.x) && Number.isFinite(sample.primary_position?.x)
        ? (sample.position.x - sample.primary_position.x)
        : 0;
      const ry = Number.isFinite(sample.position?.y) && Number.isFinite(sample.primary_position?.y)
        ? (sample.position.y - sample.primary_position.y)
        : 0;
      craftX = w * 0.5 + (rx * topScale);
      craftY = h * 0.5 - (ry * topScale);
    } else {
      this.camTop.x = this.lerp(this.camTop.x, sample.position.x, 0.14);
      this.camTop.y = this.lerp(this.camTop.y, sample.position.y, 0.14);
      topScale = this.scaleFromTrail(trail, w, h, (point) => [point.x - this.camTop.x, point.y - this.camTop.y], 1200);
      this.paintTrail(ctx, trail, topScale, w, h, (point) => ({
        x: (point.x - this.camTop.x) * topScale + w * 0.5,
        y: h * 0.5 - (point.y - this.camTop.y) * topScale
      }), 'rgba(15, 106, 115, 0.45)');
    }

    this.paintCraft(ctx, craftX, craftY, '#0f6a73', 'top', shipType);

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
      legend.unshift(['earth', '#35617f']);
    }
    this.paintLegend(ctx, w, legend);
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
    let craftX = w * 0.5;
    let craftY = h * 0.5;
    let sideScale = 1;

    if (mode === 'planetary' && Number.isFinite(sample.primary_radius) && sample.primary_radius > 0) {
      sideScale = this.scaleFromPlanetaryTrail(trail, w, h, sample.primary_radius, (point) => [point.rx, point.rz], 0.56);
      this.paintPlanetCircle(ctx, w * 0.5, h * 0.5, sample.primary_radius * sideScale);
      this.paintTrail(ctx, trail, sideScale, w, h, (point) => ({
        x: (point.rx * sideScale) + w * 0.5,
        y: h * 0.5 - (point.rz * sideScale)
      }), 'rgba(88, 125, 47, 0.45)');
      const rx = Number.isFinite(sample.position?.x) && Number.isFinite(sample.primary_position?.x)
        ? (sample.position.x - sample.primary_position.x)
        : 0;
      const rz = Number.isFinite(sample.position?.z) && Number.isFinite(sample.primary_position?.z)
        ? (sample.position.z - sample.primary_position.z)
        : 0;
      craftX = w * 0.5 + (rx * sideScale);
      craftY = h * 0.5 - (rz * sideScale);
    } else {
      this.camSide.x = this.lerp(this.camSide.x, sample.position.x, 0.14);
      this.camSide.alt = this.lerp(this.camSide.alt, sample.altitude, 0.12);
      sideScale = this.scaleFromTrail(trail, w, h, (point) => [point.x - this.camSide.x, point.alt - this.camSide.alt], 800);

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
    }

    this.paintCraft(ctx, craftX, craftY, '#587d2f', 'side', shipType);

    const velScale = mode === 'planetary' ? Math.max(14, sideScale * sample.primary_radius * 0.05) : 1.9;
    this.paintArrow(
      ctx,
      craftX,
      craftY,
      craftX + sample.velocity.x * velScale,
      craftY - (mode === 'planetary' ? sample.velocity.z : sample.vertical_vel) * velScale,
      '#2b4a77'
    );

    const gravScale = mode === 'planetary' ? Math.max(22, sideScale * sample.primary_radius * 0.08) : 18;
    this.paintArrow(
      ctx,
      craftX,
      craftY,
      craftX + sample.effective_g.x * gravScale,
      craftY - sample.effective_g.z * gravScale,
      '#9b4d1e'
    );

    const legend = [
      ['craft', '#587d2f'],
      ['velocity', '#2b4a77'],
      ['gravity', '#9b4d1e']
    ];
    if (mode === 'planetary') {
      legend.unshift(['earth', '#35617f']);
    }
    this.paintLegend(ctx, w, legend);
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
    this.paintWorldShip(ctx, projector, craft, shipType, '#0f6a73');

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
    const camPos = this.add3(craft, this.add3(
      this.scale3(up, (radius * 0.24) + 180000),
      this.scale3(forward, -(radius * 0.52 + 260000))
    ));
    const target = this.add3(craft, this.scale3(forward, radius * 0.04));
    const projector = this.makeProjector(camPos, target, up, w, h, 60);

    this.paintWorldGlobe(ctx, projector, radius);

    const globeTrail = Array.isArray(trail)
      ? trail.map((point) => ({
        x: Number.parseFloat(point.rx) || 0,
        y: Number.parseFloat(point.ry) || 0,
        z: Number.parseFloat(point.rz) || 0
      }))
      : [];
    this.paintWorldTrail(ctx, globeTrail, projector, 'rgba(72, 151, 128, 0.78)', 2.1);

    const shipType = String(sample.ship_type || 'saucer').toLowerCase();
    this.paintWorldShip(ctx, projector, craft, shipType, '#3c7b62');

    const velScale = radius * 0.028;
    const gravScale = radius * 0.022;
    const g3 = {
      x: Number.parseFloat(sample.effective_g?.x) || 0,
      y: Number.parseFloat(sample.effective_g?.y) || 0,
      z: Number.parseFloat(sample.effective_g?.z) || 0
    };
    this.paintWorldVector(ctx, projector, craft, this.scale3(this.safeDirection(vel, forward), velScale), '#2b4a77');
    this.paintWorldVector(ctx, projector, craft, this.scale3(this.safeDirection(g3, this.scale3(up, -1)), gravScale), '#9b4d1e');

    this.paintLegend(ctx, w, [
      ['earth globe', '#35617f'],
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
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    let drawing = false;
    for (let i = 0; i < points.length; i += 1) {
      const p = projector(points[i]);
      if (!p) {
        drawing = false;
        continue;
      }
      if (!drawing) {
        ctx.moveTo(p.x, p.y);
        drawing = true;
      } else {
        ctx.lineTo(p.x, p.y);
      }
    }
    ctx.stroke();
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

  paintWorldGlobe(ctx, projector, radius) {
    const center = projector({ x: 0, y: 0, z: 0 });
    if (!center) {
      return;
    }
    const rightEdge = projector({ x: radius, y: 0, z: 0 });
    if (!rightEdge) {
      return;
    }
    const screenRadius = Math.hypot(rightEdge.x - center.x, rightEdge.y - center.y);
    if (!Number.isFinite(screenRadius) || screenRadius <= 1) {
      return;
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
  }

  paintWorldShip(ctx, projector, point, shipType, color) {
    const p = projector(point);
    if (!p) {
      return;
    }
    const size = Math.max(4, Math.min(12, 360 / Math.max(80, p.depth)));
    const type = String(shipType || 'saucer').toLowerCase();
    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    if (type === 'sphere') {
      ctx.beginPath();
      ctx.arc(p.x, p.y, size * 0.72, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }
	    if (type === 'egg') {
	      ctx.beginPath();
	      ctx.ellipse(p.x, p.y, size * 0.6, size * 0.85, 0, 0, Math.PI * 2);
	      ctx.fill();
	      ctx.restore();
	      return;
	    }

	    if (type === 'pyramid') {
	      ctx.beginPath();
	      ctx.moveTo(p.x, p.y - (size * 0.92));
	      ctx.lineTo(p.x - (size * 0.86), p.y + (size * 0.74));
	      ctx.lineTo(p.x + (size * 0.86), p.y + (size * 0.74));
	      ctx.closePath();
	      ctx.fill();
	      ctx.restore();
	      return;
	    }

	    if (type === 'flat_triangle') {
	      ctx.beginPath();
	      ctx.moveTo(p.x, p.y - (size * 0.46));
	      ctx.lineTo(p.x - (size * 1.15), p.y + (size * 0.34));
	      ctx.lineTo(p.x + (size * 1.15), p.y + (size * 0.34));
	      ctx.closePath();
	      ctx.fill();
	      ctx.restore();
	      return;
	    }
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, size, size * 0.46, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.36)';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y - (size * 0.16), size * 0.46, size * 0.24, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
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

  paintPlanetCircle(ctx, x, y, radius) {
    if (!Number.isFinite(radius) || radius <= 0.2) {
      return;
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

  paintCraft(ctx, x, y, color, view, shipType) {
    const type = String(shipType || 'saucer').toLowerCase();
    const mode = view === 'side' ? 'side' : 'top';

    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;

	    if (mode === 'top') {
	      if (type === 'sphere') {
	        ctx.beginPath();
	        ctx.arc(x, y, 6.5, 0, Math.PI * 2);
	        ctx.fill();
	      } else if (type === 'egg') {
	        ctx.beginPath();
	        ctx.ellipse(x, y, 5.6, 7.4, 0, 0, Math.PI * 2);
	        ctx.fill();
	      } else if (type === 'pyramid') {
	        ctx.beginPath();
	        ctx.moveTo(x, y - 8.2);
	        ctx.lineTo(x - 6.8, y + 6.4);
	        ctx.lineTo(x + 6.8, y + 6.4);
	        ctx.closePath();
	        ctx.fill();
	      } else if (type === 'flat_triangle') {
	        ctx.beginPath();
	        ctx.moveTo(x, y - 5.9);
	        ctx.lineTo(x - 8.4, y + 3.6);
	        ctx.lineTo(x + 8.4, y + 3.6);
	        ctx.closePath();
	        ctx.fill();
	      } else {
	        ctx.beginPath();
	        ctx.arc(x, y, 7, 0, Math.PI * 2);
	        ctx.fill();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.36)';
        ctx.beginPath();
        ctx.arc(x, y, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      return;
    }

    if (type === 'sphere') {
      ctx.beginPath();
      ctx.arc(x, y, 5.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

	    if (type === 'egg') {
	      ctx.beginPath();
	      ctx.ellipse(x + 0.6, y, 4.7, 6.9, 0, 0, Math.PI * 2);
	      ctx.fill();
	      ctx.restore();
	      return;
	    }

	    if (type === 'pyramid') {
	      ctx.beginPath();
	      ctx.moveTo(x, y - 6.8);
	      ctx.lineTo(x - 7.4, y + 6.2);
	      ctx.lineTo(x + 7.4, y + 6.2);
	      ctx.closePath();
	      ctx.fill();
	      ctx.restore();
	      return;
	    }

	    if (type === 'flat_triangle') {
	      ctx.beginPath();
	      ctx.moveTo(x - 9, y + 2.5);
	      ctx.lineTo(x + 9, y + 2.5);
	      ctx.lineTo(x, y - 2.8);
	      ctx.closePath();
	      ctx.fill();
	      ctx.restore();
	      return;
	    }

    ctx.lineWidth = 3.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - 9, y);
    ctx.lineTo(x + 9, y);
    ctx.stroke();
    ctx.restore();
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
    const freePlay = Array.from(select.options).find((opt) => opt.value === 'free_play');
    select.value = freePlay ? freePlay.value : select.options[0].value;
  }
}

function selectedScenario(root) {
  const selected = root.querySelector('[data-scenario-select]')?.value || '';
  if (selected) {
    return selected;
  }
  if (state.scenarios.some((item) => item.name === 'free_play')) {
    return 'free_play';
  }
  if (state.scenarios.length > 0) {
    return state.scenarios[0].name;
  }
  return 'free_play';
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

function currentMapMode() {
  const mode = String(state.refs?.mapMode?.value || state.game.mapMode || 'planetary').toLowerCase();
  if (mode === 'local') {
    return 'local';
  }
  return 'planetary';
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
    shipType: root.querySelector('[data-ship-type]'),
    mapMode: root.querySelector('[data-map-mode]'),
    speed: root.querySelector('[data-game-speed]'),
    startGround: root.querySelector('[data-game-start-ground]'),
    stickAmp: root.querySelector('[data-stick-amp]'),
    stickPhi: root.querySelector('[data-stick-phi]'),
    stickYaw: root.querySelector('[data-stick-yaw]'),
    stickPitch: root.querySelector('[data-stick-pitch]'),
    holdAmpEnabled: root.querySelector('[data-hold-amp-enabled]'),
    holdAmpTarget: root.querySelector('[data-hold-amp-target]'),
    holdPhiEnabled: root.querySelector('[data-hold-phi-enabled]'),
    holdPhiTarget: root.querySelector('[data-hold-phi-target]'),
    holdYawEnabled: root.querySelector('[data-hold-yaw-enabled]'),
    holdYawTarget: root.querySelector('[data-hold-yaw-target]'),
    autoTrim: root.querySelector('[data-auto-trim]'),
    autoWeight: root.querySelector('[data-auto-weight]'),
    autoVertical: root.querySelector('[data-auto-vertical]'),
    pauseButton: root.querySelector('[data-game-pause]'),
    stats,
    canvasTop: root.querySelector('[data-game-canvas-top]'),
    canvasSide: root.querySelector('[data-game-canvas-side]'),
    canvas3D: root.querySelector('[data-game-canvas-3d]')
  };

  state.game.mapMode = currentMapMode();

  state.renderer = new DualViewRenderer(state.refs.canvasTop, state.refs.canvasSide, state.refs.canvas3D);
  state.renderer.draw(state.game.latest, state.game.trailTop, state.game.trailSide, state.game.trail3D, currentMapMode());

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

function wrapRadians(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  let out = value;
  const twoPi = Math.PI * 2;
  while (out > Math.PI) {
    out -= twoPi;
  }
  while (out < -Math.PI) {
    out += twoPi;
  }
  return out;
}

function yawPitchFromVector(x, y, z) {
  const horizontal = Math.hypot(x, y);
  let yaw = 0;
  if (horizontal > 1e-9) {
    yaw = Math.atan2(y, x);
  }
  const pitch = Math.atan2(z, horizontal);
  return { yaw, pitch };
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

function setInputNumber(node, value, digits = 3) {
  if (!node || !Number.isFinite(value)) {
    return;
  }
  node.value = value.toFixed(digits);
}

function centerSticks() {
  if (state.refs?.stickAmp) {
    state.refs.stickAmp.value = '0';
  }
  if (state.refs?.stickPhi) {
    state.refs.stickPhi.value = '0';
  }
  if (state.refs?.stickYaw) {
    state.refs.stickYaw.value = '0';
  }
  if (state.refs?.stickPitch) {
    state.refs.stickPitch.value = '0';
  }
  setStatus('sticks centered');
}

function captureCurrentTargets() {
  const sample = state.game.latest;
  if (!sample) {
    setStatus('no sample to capture yet');
    return;
  }
  setInputNumber(state.refs?.holdAmpTarget, Number.parseFloat(sample.control_amp_target), 3);
  setInputNumber(state.refs?.holdPhiTarget, Number.parseFloat(sample.control_theta_target), 3);
  setInputNumber(state.refs?.holdYawTarget, Number.parseFloat(sample.control_axis_yaw), 3);
  setStatus('captured current coupler targets');
}

function applyAssistPreset(name) {
  const key = String(name || '').toLowerCase();
  if (!state.refs) {
    return;
  }
  if (state.refs.autoTrim) {
    state.refs.autoTrim.checked = true;
  }

  switch (key) {
    case 'hover':
      setInputNumber(state.refs.autoWeight, 0.0, 2);
      setInputNumber(state.refs.autoVertical, 0.0, 2);
      setStatus('assist preset: hover');
      break;
    case 'neutral':
      setInputNumber(state.refs.autoWeight, 1.0, 2);
      setInputNumber(state.refs.autoVertical, 0.0, 2);
      setStatus('assist preset: normal-g');
      break;
    case 'ascend':
      setInputNumber(state.refs.autoWeight, -0.15, 2);
      setInputNumber(state.refs.autoVertical, 4.0, 2);
      setStatus('assist preset: ascend');
      break;
    case 'descend':
      setInputNumber(state.refs.autoWeight, 1.2, 2);
      setInputNumber(state.refs.autoVertical, -3.0, 2);
      setStatus('assist preset: descend');
      break;
    default:
      break;
  }
}

function updateHUD(sample) {
  if (!state.refs || !state.refs.stats) {
    return;
  }
  if (!sample) {
    for (const key of Object.keys(state.refs.stats)) {
      setStat(key, '-');
    }
    setStat('map_mode', currentMapMode());
    setStat('ship', selectedShipType());
    return;
  }

  setStat('time', `${formatNumber(sample.time, 2)} s`);
  setStat('step', `${sample.step}`);
  setStat('altitude', `${formatNumber(sample.altitude, 1)} m`);
  setStat('speed', `${formatNumber(sample.speed, 2)} m/s`);
  setStat('vertical', `${formatNumber(sample.vertical_vel, 2)} m/s`);
  const modelLabel = sample.coupler_enabled
    ? `${sample.gravity_model || '-'} (coupler on)`
    : `${sample.gravity_model || '-'} (coupler off)`;
  setStat('model', modelLabel);
  setStat('ship', String(sample.ship_type || 'saucer').toLowerCase());
  setStat('map_mode', currentMapMode());

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
  setStat('axis_pitch', formatNumber(sample.control_axis_pitch, 3));
  setStat('warp_x', formatNumber(sample.control_warp_x, 3));
  setStat('warp_y', formatNumber(sample.control_warp_y, 3));
  setStat('warp_z', formatNumber(sample.control_warp_z, 3));
  setStat('lock_assist', sample.control_lock_assist ? 'on' : 'off');
  setStat('amp_axis', formatNumber(sample.control_amp_axis, 2));
  setStat('phi_axis', formatNumber(sample.control_phi_axis, 2));
  setStat('yaw_axis', formatNumber(sample.control_yaw_axis, 2));
  setStat('pitch_axis', formatNumber(sample.control_pitch_axis, 2));

  const last = state.input.lastControl || {};
  setStat('control_mode', last.mode || 'manual');
  setStat('manual_amp', formatNumber(last.manualAmp, 2));
  setStat('manual_phi', formatNumber(last.manualPhi, 2));
  setStat('manual_yaw', formatNumber(last.manualYaw, 2));
  setStat('manual_pitch', formatNumber(last.manualPitch, 2));
  setStat('auto_amp', formatNumber(last.autoAmp, 2));
  setStat('auto_phi', formatNumber(last.autoPhi, 2));
  setStat('auto_yaw', formatNumber(last.autoYaw, 2));
  setStat('auto_pitch', formatNumber(last.autoPitch, 2));
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
    ry
  });
  state.game.trailSide.push({
    x: sample.position.x,
    z: sample.position.z,
    alt: sample.altitude,
    rx,
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

function clearTrails() {
  state.game.trailTop = [];
  state.game.trailSide = [];
  state.game.trail3D = [];
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
  const shipType = selectedShipType();
  state.game.mapMode = currentMapMode();
  setStatus(`starting ${scenario}...`);
  const startOnGround = Boolean(state.refs?.startGround?.checked);

  try {
    const payload = await apiPost('/api/game/start', { scenario, start_on_ground: startOnGround, ship_type: shipType });
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
    if (state.refs?.pauseButton) {
      state.refs.pauseButton.textContent = 'Pause';
    }
    updateHUD(state.game.latest);
    if (state.renderer) {
      state.renderer.draw(state.game.latest, state.game.trailTop, state.game.trailSide, state.game.trail3D, currentMapMode());
    }
    const mode = String(state.game.latest?.gravity_model || '').toLowerCase();
    const couplerEnabled = Boolean(state.game.latest?.coupler_enabled);
    if (!couplerEnabled) {
      setStatus(`running ${scenario} • coupler off • pilot/assist controls are telemetry-only here`);
    } else if (mode && mode !== 'coupling') {
      setStatus(`running ${scenario} • ${mode} model • coupler controls are telemetry-only here`);
    } else {
      setStatus(`running ${scenario} • ship=${shipType} • map=${state.game.mapMode} • dt=${state.game.dt.toFixed(4)} s • ${startOnGround ? 'ground start' : 'scenario start'}`);
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
  const keyAmp = (keys.d ? 1 : 0) + (keys.a ? -1 : 0);
  const keyPhi = (keys.w ? 1 : 0) + (keys.s ? -1 : 0);
  const keyYaw = (keys.e ? 1 : 0) + (keys.q ? -1 : 0);
  const keyPitch = (keys.i ? 1 : 0) + (keys.k ? -1 : 0);
  const stickAmp = clampUnit(readNumberInput(state.refs?.stickAmp, 0));
  const stickPhi = clampUnit(readNumberInput(state.refs?.stickPhi, 0));
  const stickYaw = clampUnit(readNumberInput(state.refs?.stickYaw, 0));
  const stickPitch = clampUnit(readNumberInput(state.refs?.stickPitch, 0));

  const manualAmp = clampUnit(keyAmp + stickAmp);
  const manualPhi = clampUnit(keyPhi + stickPhi);
  const manualYaw = clampUnit(keyYaw + stickYaw);
  const manualPitch = clampUnit(keyPitch + stickPitch);

  let autoAmp = 0;
  let autoPhi = 0;
  let autoYaw = 0;
  let autoPitch = 0;
  let mode = 'manual';

  const couplerEnabled = Boolean(sample?.coupler_enabled);
  const couplingModel = String(sample?.gravity_model || '').toLowerCase() === 'coupling';
  const canAssist = couplerEnabled && couplingModel;

  const holdAmpEnabled = Boolean(state.refs?.holdAmpEnabled?.checked);
  const holdPhiEnabled = Boolean(state.refs?.holdPhiEnabled?.checked);
  const holdYawEnabled = Boolean(state.refs?.holdYawEnabled?.checked);
  const targetAssistEnabled = canAssist && (holdAmpEnabled || holdPhiEnabled || holdYawEnabled);
  const autoTrimEnabled = Boolean(state.refs?.autoTrim?.checked) && canAssist;

  if (targetAssistEnabled) {
    const ampTarget = readNumberInput(state.refs?.holdAmpTarget, Number.parseFloat(sample?.control_amp_target));
    const phiTarget = readNumberInput(state.refs?.holdPhiTarget, Number.parseFloat(sample?.control_theta_target));
    const yawTarget = readNumberInput(state.refs?.holdYawTarget, Number.parseFloat(sample?.control_axis_yaw));

    const ampCurrent = Number.parseFloat(sample?.control_amp_target);
    const phiCurrent = Number.parseFloat(sample?.control_theta_target);
    const yawCurrent = Number.parseFloat(sample?.control_axis_yaw);

    if (holdAmpEnabled && Number.isFinite(ampTarget) && Number.isFinite(ampCurrent) && !autoTrimEnabled) {
      autoAmp += clampUnit((ampTarget - ampCurrent) / 0.35);
    }
    if (holdPhiEnabled && Number.isFinite(phiTarget) && Number.isFinite(phiCurrent) && !autoTrimEnabled) {
      autoPhi += clampUnit(wrapRadians(phiTarget - phiCurrent) / 0.6);
    }
    if (holdYawEnabled && Number.isFinite(yawTarget) && Number.isFinite(yawCurrent)) {
      autoYaw += clampUnit(wrapRadians(yawTarget - yawCurrent) / 0.6);
    }

    if (!autoTrimEnabled) {
      mode = 'assist-targets';
    }
  }

  if (autoTrimEnabled) {
    const vertical = localVerticalMetrics(sample);
    const weightRatio = vertical ? vertical.ratio : NaN;
    const targetWeight = readNumberInput(state.refs?.autoWeight, 1.0);
    const targetVertical = readNumberInput(state.refs?.autoVertical, 0.0);
    const verticalVel = Number.parseFloat(sample?.vertical_vel);
    const lockQuality = Number.parseFloat(sample?.lock_quality);

    const weightErr = Number.isFinite(weightRatio) ? (targetWeight - weightRatio) : 0;
    const verticalErr = Number.isFinite(verticalVel) ? (targetVertical - verticalVel) : 0;
    const lockErr = Number.isFinite(lockQuality) ? (0.9 - lockQuality) : 0;

    autoPhi += clampUnit((weightErr * 0.9) + (verticalErr * 0.04));
    autoAmp += clampUnit(lockErr * 1.1);

    const px = Number.parseFloat(sample?.position?.x);
    const py = Number.parseFloat(sample?.position?.y);
    const pz = Number.parseFloat(sample?.position?.z);
    const gx = Number.parseFloat(sample?.primary_position?.x);
    const gy = Number.parseFloat(sample?.primary_position?.y);
    const gz = Number.parseFloat(sample?.primary_position?.z);
    const yawCurrent = Number.parseFloat(sample?.control_axis_yaw);
    const pitchCurrent = Number.parseFloat(sample?.control_axis_pitch);
    if (
      Number.isFinite(px) && Number.isFinite(py) && Number.isFinite(pz) &&
      Number.isFinite(gx) && Number.isFinite(gy) && Number.isFinite(gz) &&
      Number.isFinite(yawCurrent) && Number.isFinite(pitchCurrent)
    ) {
      const upX = px - gx;
      const upY = py - gy;
      const upZ = pz - gz;
      const upNorm = Math.hypot(upX, upY, upZ);
      if (upNorm > 1e-9) {
        const desired = yawPitchFromVector(upX / upNorm, upY / upNorm, upZ / upNorm);
        autoYaw += clampUnit(wrapRadians(desired.yaw - yawCurrent) / 0.9) * 0.45;
        autoPitch += clampUnit((desired.pitch - pitchCurrent) / 0.65) * 0.55;
      }
    }
    mode = 'assist-ship';
  }

  const ampAxis = clampUnit(manualAmp + autoAmp);
  const phiAxis = clampUnit(manualPhi + autoPhi);
  const yawAxis = clampUnit(manualYaw + autoYaw);
  const pitchAxis = clampUnit(manualPitch + autoPitch);

  state.input.lastControl = {
    mode,
    manualAmp,
    manualPhi,
    manualYaw,
    manualPitch,
    autoAmp,
    autoPhi,
    autoYaw,
    autoPitch,
    finalAmp: ampAxis,
    finalPhi: phiAxis,
    finalYaw: yawAxis,
    finalPitch: pitchAxis
  };

  return {
    amp_axis: ampAxis,
    phi_axis: phiAxis,
    yaw_axis: yawAxis,
    pitch_axis: pitchAxis,
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
    state.renderer.draw(state.game.latest, state.game.trailTop, state.game.trailSide, state.game.trail3D, currentMapMode());
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

    if (event.target.closest('[data-stick-center]')) {
      event.preventDefault();
      centerSticks();
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
    if (key === 'w' || key === 'a' || key === 's' || key === 'd' || key === 'q' || key === 'e' || key === 'i' || key === 'k') {
      event.preventDefault();
      state.input.keys[key] = true;
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
      if (state.renderer) {
        state.renderer.draw(state.game.latest, state.game.trailTop, state.game.trailSide, state.game.trail3D, currentMapMode());
      }
      return;
    }
    if (target.matches('[data-ship-type]')) {
      updateHUD(state.game.latest);
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
