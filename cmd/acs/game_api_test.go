package main

import (
	"math"
	"path/filepath"
	"testing"

	"github.com/example/acs/internal/config"
	"github.com/example/acs/internal/mathx"
)

type presetCalibration struct {
	preset         string
	gSurface       float64
	gTolerance     float64
	hasAtm         bool
	rho0           float64
	rhoTolerance   float64
	scaleH         float64
	scaleTolerance float64
}

func TestWarpAxisWorldFromYawPitchCenteredAlignsLocalUp(t *testing.T) {
	position := mathx.Vec3{Z: 6_372_000}
	primary := mathx.Vec3{}

	axis := warpAxisWorldFromYawPitch(position, primary, 1.2, 0)
	want := mathx.Vec3{Z: 1}

	if got := axis.Sub(want).Norm(); got > 1e-9 {
		t.Fatalf("centered warp should align with local up: diff=%.6g axis=%+v", got, axis)
	}
}

func TestGameSessionWarpTiltProducesTangentialMotion(t *testing.T) {
	scenarioPath := filepath.Join("..", "..", "scenarios", "free_play.json")
	cfg, err := config.Load(scenarioPath)
	if err != nil {
		t.Fatalf("load scenario: %v", err)
	}

	session, err := newGameSession("test-session", scenarioPath, cfg, false, "saucer", "standard", "earth", 1)
	if err != nil {
		t.Fatalf("new session: %v", err)
	}

	session.controls.LockAssist = false
	session.controls.AmpTarget = 9
	session.controls.ThetaTarget = 2.4
	session.controls.AxisYaw = 0
	session.controls.AxisPitch = 0.9
	session.syncWarpAxisLocked()

	initial := session.craft.Position
	for i := 0; i < 1500; i++ {
		if _, err := session.Step(1, gameControlInput{}); err != nil {
			t.Fatalf("step %d: %v", i, err)
		}
	}

	final := session.craft.Position
	delta := final.Sub(initial)
	lateral := math.Hypot(delta.X, delta.Y)
	if lateral < 20 {
		t.Fatalf("expected meaningful lateral motion from warp tilt, got lateral displacement %.3f m (delta=%+v)", lateral, delta)
	}
	if math.Abs(final.Z-initial.Z) < 1 {
		t.Fatalf("expected warp tilt test to evolve position, got negligible vertical change %.6f m", final.Z-initial.Z)
	}
}

func TestGameSessionOrientationTracksWarpAxis(t *testing.T) {
	scenarioPath := filepath.Join("..", "..", "scenarios", "free_play.json")
	cfg, err := config.Load(scenarioPath)
	if err != nil {
		t.Fatalf("load scenario: %v", err)
	}

	session, err := newGameSession("test-session-orientation", scenarioPath, cfg, false, "saucer", "standard", "earth", 1)
	if err != nil {
		t.Fatalf("new session: %v", err)
	}

	session.controls.LockAssist = false
	session.controls.AxisYaw = 0.4
	session.controls.AxisPitch = 0.8
	session.syncWarpAxisLocked()
	for i := 0; i < 120; i++ {
		if _, err := session.Step(1, gameControlInput{}); err != nil {
			t.Fatalf("step %d: %v", i, err)
		}
	}

	warpAxis := session.warpAxisWorldLocked()
	bodyUp := session.craft.Orientation.Rotate(mathx.Vec3{Z: 1})
	alignment := warpAxis.Dot(bodyUp)
	if alignment < 0.995 {
		t.Fatalf("expected craft orientation to track warp axis, alignment=%.6f warp=%+v up=%+v", alignment, warpAxis, bodyUp)
	}
}

func TestPlanetPresetAtmosphereConsistency(t *testing.T) {
	scenarioPath := filepath.Join("..", "..", "scenarios", "free_play.json")
	cfg, err := config.Load(scenarioPath)
	if err != nil {
		t.Fatalf("load scenario: %v", err)
	}

	moon, err := newGameSession("test-moon", scenarioPath, cfg, false, "saucer", "resonant_pll", "moon", 1)
	if err != nil {
		t.Fatalf("new moon session: %v", err)
	}
	moonState, err := moon.State()
	if err != nil {
		t.Fatalf("moon state: %v", err)
	}
	if moonState.AtmosphereEnabled {
		t.Fatalf("moon should have no atmosphere")
	}
	if moonState.AtmosphereRho0 != 0 {
		t.Fatalf("moon rho0 should be 0, got %.6g", moonState.AtmosphereRho0)
	}

	earth, err := newGameSession("test-earth", scenarioPath, cfg, false, "saucer", "resonant_pll", "earth", 1)
	if err != nil {
		t.Fatalf("new earth session: %v", err)
	}
	earthState, err := earth.State()
	if err != nil {
		t.Fatalf("earth state: %v", err)
	}
	if !earthState.AtmosphereEnabled {
		t.Fatalf("earth should have atmosphere")
	}
	if earthState.AtmosphereRho0 <= 0 {
		t.Fatalf("earth rho0 must be > 0")
	}
}

func TestEarthMoonPresetConfiguresTwoBodyOrbit(t *testing.T) {
	scenarioPath := filepath.Join("..", "..", "scenarios", "free_play.json")
	cfg, err := config.Load(scenarioPath)
	if err != nil {
		t.Fatalf("load scenario: %v", err)
	}

	session, err := newGameSession("test-earth-moon", scenarioPath, cfg, false, "saucer", "resonant_pll", "earth_moon", 1)
	if err != nil {
		t.Fatalf("new session: %v", err)
	}
	if len(session.bodies) < 2 {
		t.Fatalf("earth_moon should configure at least two bodies, got %d", len(session.bodies))
	}
	if session.primaryIdx != 0 {
		t.Fatalf("earth_moon primary index must be earth at 0, got %d", session.primaryIdx)
	}
	if session.bodies[0].Name != "earth" {
		t.Fatalf("expected body[0]=earth, got %q", session.bodies[0].Name)
	}
	if session.bodies[1].Name != "moon" {
		t.Fatalf("expected body[1]=moon, got %q", session.bodies[1].Name)
	}
	sep := session.bodies[1].Position.Sub(session.bodies[0].Position).Norm()
	relErr := math.Abs(sep-earthMoonDistanceM) / earthMoonDistanceM
	if relErr > 0.02 {
		t.Fatalf("unexpected earth-moon separation: got %.3f m want %.3f m relerr %.4f", sep, earthMoonDistanceM, relErr)
	}
	if session.bodies[0].Velocity.Norm() <= 0 || session.bodies[1].Velocity.Norm() <= 0 {
		t.Fatalf("expected non-zero orbital velocities, earth=%+v moon=%+v", session.bodies[0].Velocity, session.bodies[1].Velocity)
	}
	state, err := session.State()
	if err != nil {
		t.Fatalf("state: %v", err)
	}
	if state.PrimaryName != "earth" {
		t.Fatalf("expected primary earth in state, got %q", state.PrimaryName)
	}
	if !state.AtmosphereEnabled {
		t.Fatalf("earth_moon should keep earth atmosphere enabled at craft locale")
	}
}

func TestMilkyWayPresetConfiguresSolarSandboxAndEarthStart(t *testing.T) {
	scenarioPath := filepath.Join("..", "..", "scenarios", "free_play.json")
	cfg, err := config.Load(scenarioPath)
	if err != nil {
		t.Fatalf("load scenario: %v", err)
	}

	session, err := newGameSession("test-mw", scenarioPath, cfg, false, "saucer", "resonant_pll", "milky_way", 1)
	if err != nil {
		t.Fatalf("new session: %v", err)
	}
	if len(session.bodies) < 10 {
		t.Fatalf("expected solar sandbox bodies, got %d", len(session.bodies))
	}
	if session.primaryIdx < 0 || session.primaryIdx >= len(session.bodies) {
		t.Fatalf("invalid primary index %d", session.primaryIdx)
	}
	if session.bodies[session.primaryIdx].Name != "earth" {
		t.Fatalf("expected primary earth, got %q", session.bodies[session.primaryIdx].Name)
	}
	foundSun := false
	foundMoon := false
	for i := range session.bodies {
		if session.bodies[i].Name == "sun" {
			foundSun = true
		}
		if session.bodies[i].Name == "moon" {
			foundMoon = true
		}
	}
	if !foundSun || !foundMoon {
		t.Fatalf("expected both sun and moon in milky_way preset, sun=%v moon=%v", foundSun, foundMoon)
	}
	earthPos := session.bodies[session.primaryIdx].Position
	craftRel := session.craft.Position.Sub(earthPos)
	alt := craftRel.Norm() - session.bodies[session.primaryIdx].Radius
	if math.Abs(alt-500.0) > 20 {
		t.Fatalf("expected earth-start altitude ~500m, got %.3f", alt)
	}
	if !session.env.Atmosphere.Enabled {
		t.Fatalf("earth-start atmosphere should be enabled")
	}
	if session.bodyIntegrator != "rk4" || session.bodySubsteps < 2 {
		t.Fatalf("milky_way should enable higher-fidelity body integration, got integrator=%q substeps=%d", session.bodyIntegrator, session.bodySubsteps)
	}
}

func TestWarpDriveProfileStagesControlEnvelope(t *testing.T) {
	scenarioPath := filepath.Join("..", "..", "scenarios", "free_play.json")
	cfg, err := config.Load(scenarioPath)
	if err != nil {
		t.Fatalf("load scenario: %v", err)
	}

	sess, err := newGameSession("test-drive-profile", scenarioPath, cfg, false, "saucer", "plasma_mhd", "earth", 1)
	if err != nil {
		t.Fatalf("new session: %v", err)
	}
	state, err := sess.State()
	if err != nil {
		t.Fatalf("state: %v", err)
	}
	if state.ControlPlasmaTarget < 0.7 {
		t.Fatalf("plasma_mhd profile should stage high plasma target, got %.4f", state.ControlPlasmaTarget)
	}
	if state.ControlEMChargeTarget <= 0 {
		t.Fatalf("plasma_mhd profile should stage positive em charge, got %.4f", state.ControlEMChargeTarget)
	}
	if state.ControlThrottleTarget <= 0 {
		t.Fatalf("plasma_mhd profile should stage positive throttle target, got %.4f", state.ControlThrottleTarget)
	}
}

func TestAlcubierreAGProfileStagesControlEnvelope(t *testing.T) {
	scenarioPath := filepath.Join("..", "..", "scenarios", "free_play.json")
	cfg, err := config.Load(scenarioPath)
	if err != nil {
		t.Fatalf("load scenario: %v", err)
	}

	sess, err := newGameSession("test-drive-alcubierre", scenarioPath, cfg, false, "saucer", "alcubierre_ag", "earth", 1)
	if err != nil {
		t.Fatalf("new session: %v", err)
	}
	state, err := sess.State()
	if err != nil {
		t.Fatalf("state: %v", err)
	}
	if state.WarpDrive != "alcubierre_ag" {
		t.Fatalf("expected warp drive alcubierre_ag, got %q", state.WarpDrive)
	}
	if state.ControlQTarget < 400 {
		t.Fatalf("alcubierre_ag should stage high Q, got %.4f", state.ControlQTarget)
	}
	if state.ControlBetaTarget < 4.0 {
		t.Fatalf("alcubierre_ag should stage high beta, got %.4f", state.ControlBetaTarget)
	}
	if state.ControlThrottleTarget <= 0 {
		t.Fatalf("alcubierre_ag should stage positive throttle target, got %.4f", state.ControlThrottleTarget)
	}
}

func TestPlanetPresetCalibrationAgainstReference(t *testing.T) {
	// Reference targets are practical engineering anchors for gameplay realism,
	// not strict ephemeris-grade validation.
	cases := []presetCalibration{
		{preset: "earth", gSurface: 9.81, gTolerance: 0.06, hasAtm: true, rho0: 1.225, rhoTolerance: 0.12, scaleH: 8500, scaleTolerance: 0.25},
		{preset: "mercury", gSurface: 3.70, gTolerance: 0.10, hasAtm: false},
		{preset: "moon", gSurface: 1.62, gTolerance: 0.10, hasAtm: false},
		{preset: "mars", gSurface: 3.71, gTolerance: 0.12, hasAtm: true, rho0: 0.020, rhoTolerance: 0.45, scaleH: 11100, scaleTolerance: 0.35},
		{preset: "venus", gSurface: 8.87, gTolerance: 0.08, hasAtm: true, rho0: 65.0, rhoTolerance: 0.30, scaleH: 15900, scaleTolerance: 0.35},
		{preset: "titan", gSurface: 1.35, gTolerance: 0.10, hasAtm: true, rho0: 5.30, rhoTolerance: 0.35, scaleH: 20000, scaleTolerance: 0.40},
		{preset: "jupiter", gSurface: 24.79, gTolerance: 0.12, hasAtm: true, rho0: 0.16, rhoTolerance: 0.60, scaleH: 27000, scaleTolerance: 0.45},
		{preset: "neptune", gSurface: 11.15, gTolerance: 0.12, hasAtm: true, rho0: 0.45, rhoTolerance: 0.60, scaleH: 20000, scaleTolerance: 0.45},
	}

	scenarioPath := filepath.Join("..", "..", "scenarios", "free_play.json")
	cfg, err := config.Load(scenarioPath)
	if err != nil {
		t.Fatalf("load scenario: %v", err)
	}

	for _, tc := range cases {
		t.Run(tc.preset, func(t *testing.T) {
			session, err := newGameSession("cal-"+tc.preset, scenarioPath, cfg, false, "saucer", "resonant_pll", tc.preset, 1)
			if err != nil {
				t.Fatalf("new session: %v", err)
			}
			state, err := session.State()
			if err != nil {
				t.Fatalf("state: %v", err)
			}

			gComputed := state.GRawMag
			if math.IsNaN(gComputed) || math.IsInf(gComputed, 0) || gComputed <= 0 {
				t.Fatalf("invalid computed gravity: %.6g", gComputed)
			}
			gRelErr := math.Abs(gComputed-tc.gSurface) / math.Max(tc.gSurface, 1e-9)
			if gRelErr > tc.gTolerance {
				t.Fatalf("surface g out of tolerance: got %.6g want %.6g relerr %.3f tol %.3f", gComputed, tc.gSurface, gRelErr, tc.gTolerance)
			}

			if tc.hasAtm != state.AtmosphereEnabled {
				t.Fatalf("atmosphere enabled mismatch: got=%v want=%v", state.AtmosphereEnabled, tc.hasAtm)
			}
			if !tc.hasAtm {
				if math.Abs(state.AtmosphereRho0) > 1e-9 {
					t.Fatalf("expected rho0 ~= 0 for no-atm body, got %.6g", state.AtmosphereRho0)
				}
				return
			}

			rhoErr := math.Abs(state.AtmosphereRho0-tc.rho0) / math.Max(math.Abs(tc.rho0), 1e-9)
			if rhoErr > tc.rhoTolerance {
				t.Fatalf("rho0 out of tolerance: got %.6g want %.6g relerr %.3f tol %.3f", state.AtmosphereRho0, tc.rho0, rhoErr, tc.rhoTolerance)
			}

			scaleErr := math.Abs(state.AtmosphereScaleH-tc.scaleH) / math.Max(math.Abs(tc.scaleH), 1e-9)
			if scaleErr > tc.scaleTolerance {
				t.Fatalf("scale height out of tolerance: got %.6g want %.6g relerr %.3f tol %.3f", state.AtmosphereScaleH, tc.scaleH, scaleErr, tc.scaleTolerance)
			}
		})
	}
}

func TestPilotStressAccumulatesUnderHighLoad(t *testing.T) {
	scenarioPath := filepath.Join("..", "..", "scenarios", "free_play.json")
	cfg, err := config.Load(scenarioPath)
	if err != nil {
		t.Fatalf("load scenario: %v", err)
	}
	session, err := newGameSession("pilot-stress", scenarioPath, cfg, false, "saucer", "alcubierre_ag", "earth", 1)
	if err != nil {
		t.Fatalf("new session: %v", err)
	}
	session.controls.LockAssist = false
	session.controls.AmpTarget = 10
	session.controls.ThetaTarget = 2.4
	session.controls.AxisPitch = 1.2

	initial, err := session.State()
	if err != nil {
		t.Fatalf("initial state: %v", err)
	}
	for i := 0; i < 400; i++ {
		if _, err := session.Step(1, gameControlInput{}); err != nil {
			t.Fatalf("step %d: %v", i, err)
		}
	}
	final, err := session.State()
	if err != nil {
		t.Fatalf("final state: %v", err)
	}
	if final.PilotStress <= initial.PilotStress {
		t.Fatalf("expected pilot stress to accumulate, initial=%.6g final=%.6g", initial.PilotStress, final.PilotStress)
	}
}
