function finiteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function hasVec3(v) {
  return Boolean(v) && finiteNumber(v.x) && finiteNumber(v.y) && finiteNumber(v.z);
}

function sampleSignature(sample) {
  if (!sample || !hasVec3(sample.position)) {
    return 'na';
  }
  const step = finiteNumber(sample.step) ? sample.step : -1;
  const t = finiteNumber(sample.time) ? sample.time : -1;
  const x = sample.position.x;
  const y = sample.position.y;
  const z = sample.position.z;
  return `${step}|${t.toFixed(3)}|${x.toFixed(2)}|${y.toFixed(2)}|${z.toFixed(2)}`;
}

function validateSample(sample) {
  if (!sample || typeof sample !== 'object') {
    return { ok: false, reason: 'sample missing' };
  }
  if (!Number.isInteger(sample.step) || sample.step < 0) {
    return { ok: false, reason: 'invalid step' };
  }
  if (!finiteNumber(sample.time) || sample.time < 0) {
    return { ok: false, reason: 'invalid time' };
  }
  if (!finiteNumber(sample.dt) || sample.dt <= 0) {
    return { ok: false, reason: 'invalid dt' };
  }
  if (!hasVec3(sample.position)) {
    return { ok: false, reason: 'invalid position' };
  }
  if (!hasVec3(sample.velocity)) {
    return { ok: false, reason: 'invalid velocity' };
  }
  if (!hasVec3(sample.primary_position)) {
    return { ok: false, reason: 'invalid primary_position' };
  }
  if (!finiteNumber(sample.speed) || sample.speed < 0) {
    return { ok: false, reason: 'invalid speed' };
  }
  if (!finiteNumber(sample.altitude)) {
    return { ok: false, reason: 'invalid altitude' };
  }
  return { ok: true, reason: '' };
}

function validateMonotonicTransition(prev, next) {
  if (!prev || !next) {
    return { ok: true, reason: '' };
  }
  if (next.step < prev.step) {
    return { ok: false, reason: `step regressed (${prev.step} -> ${next.step})` };
  }
  if (next.time + 1e-9 < prev.time) {
    return { ok: false, reason: `time regressed (${prev.time} -> ${next.time})` };
  }
  return { ok: true, reason: '' };
}

module.exports = {
  sampleSignature,
  validateSample,
  validateMonotonicTransition
};
