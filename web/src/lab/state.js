function createInitialState() {
  return {
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
      initialEnergy: Number.NaN,
      trailTop: [],
      trailSide: [],
      trail3D: [],
      maxTrail: 900,
      telemetryHistory: [],
      telemetryHistoryMax: 360,
      worldCameraDragging: false,
      worldCameraLastX: 0,
      worldCameraLastY: 0,
      mapMode: 'planetary',
      speedometerScale: 400
    },
    input: {
      keys: Object.create(null),
      lockAssist: true,
      assistGoal: 'off',
      vectorCommand: 'none',
      navTopX: 0,
      navTopY: 0,
      navTopGoalX: 0,
      navTopGoalY: 0,
      navTopGoalZ: 0,
      navTopGoalMode: 'local',
      navTopActive: false,
      navProfileY: 0,
      navProfileActive: false,
      overrideUntilS: 0,
      activeInput: 'none',
      lastEffect: 'none',
      lastNudge: 'none',
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
}

module.exports = {
  createInitialState
};
