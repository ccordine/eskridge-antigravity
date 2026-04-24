package sim

import (
	"math"
	"testing"

	"github.com/example/acs/internal/config"
)

func TestFreeFallScenarioDescends(t *testing.T) {
	cfg := baseScenario(false)
	cfg.Duration = 5.0

	var first, last Sample
	firstSet := false
	_, err := Run(cfg, func(s Sample) error {
		if !firstSet {
			first = s
			firstSet = true
		}
		last = s
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if !(last.Altitude < first.Altitude-10) {
		t.Fatalf("expected descent, first=%.3f last=%.3f", first.Altitude, last.Altitude)
	}
	if math.Abs(last.CouplingC-1.0) > 1e-12 {
		t.Fatalf("coupler-off run should keep C=1, got %f", last.CouplingC)
	}
}

func TestDeterministicReplay(t *testing.T) {
	cfg := baseScenario(true)
	cfg.Duration = 3.0
	cfg.Controller.Enabled = false

	r1, err := Run(cfg, func(Sample) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	r2, err := Run(cfg, func(Sample) error { return nil })
	if err != nil {
		t.Fatal(err)
	}

	if r1.FinalCraft.Position != r2.FinalCraft.Position || r1.FinalCraft.Velocity != r2.FinalCraft.Velocity {
		t.Fatalf("non-deterministic result: r1=%+v r2=%+v", r1.FinalCraft, r2.FinalCraft)
	}
}

func TestHoverControllerKeepsAltitudeBounded(t *testing.T) {
	cfg := baseScenario(true)
	cfg.Duration = 20.0
	cfg.Controller.Enabled = true

	var first, last Sample
	firstSet := false
	_, err := Run(cfg, func(s Sample) error {
		if !firstSet {
			first = s
			firstSet = true
		}
		last = s
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

	delta := math.Abs(last.Altitude - first.Altitude)
	if delta > 400 {
		t.Fatalf("hover drift too large: %.3f m", delta)
	}
	if math.Abs(last.VerticalVel) > 40 {
		t.Fatalf("hover vertical velocity too high: %.3f m/s", last.VerticalVel)
	}
	if last.Energy >= first.Energy {
		t.Fatalf("expected energy draw while hovering")
	}
}

func baseScenario(couplerEnabled bool) config.Scenario {
	return config.Scenario{
		Name:     "test",
		Seed:     1,
		Dt:       0.01,
		Duration: 10,
		LogEvery: 10,
		Bodies: []config.BodyConfig{
			{
				Name:     "earth",
				Mass:     5.972e24,
				Radius:   6371000,
				Position: [3]float64{0, 0, 0},
				Velocity: [3]float64{0, 0, 0},
			},
		},
		Craft: config.CraftConfig{
			Mass:            1200,
			InertiaDiagonal: [3]float64{1200, 1100, 900},
			Position:        [3]float64{0, 0, 6372000},
			Velocity:        [3]float64{0, 0, 0},
			Orientation:     [4]float64{1, 0, 0, 0},
			AngularVelocity: [3]float64{0, 0, 0},
			Drag:            config.DragConfig{Enabled: false},
		},
		Environment: config.EnvironmentConfig{
			G:              6.6743e-11,
			PrimaryBodyIdx: 0,
			Atmosphere: config.AtmosphereConfig{
				Enabled:     false,
				Rho0:        1.225,
				ScaleHeight: 8500,
			},
			Ground: config.GroundConfig{Enabled: false, BodyIndex: 0},
		},
		Coupler: config.CouplerConfig{
			Enabled:            couplerEnabled,
			Omega0:             80,
			Omega0DriftRate:    0,
			Q:                  45,
			Beta:               1.2,
			Alpha:              0.22,
			KMax:               2.0,
			PhiBias:            0,
			DefaultC:           1,
			PllKp:              7.5,
			PllKi:              18,
			LockOmegaWindow:    5,
			LockCollapse:       1.8,
			LockRecover:        4.5,
			PowerC1:            400,
			PowerC2:            30,
			PowerLimit:         6000,
			Energy:             1500000,
			MinAmplitude:       0,
			MaxAmplitude:       9,
			AmpRate:            2.5,
			ThetaRate:          5,
			MinOmegaBase:       65,
			MaxOmegaBase:       95,
			OmegaBaseRate:      20,
			InitialAmplitude:   3,
			InitialThetaTarget: 0,
			InitialOmegaBase:   80,
			DirectionalEnabled: false,
			FieldAxisBody:      [3]float64{0, 0, 1},
			ParallelFactor:     1,
			PerpFactor:         1,
		},
		Controller: config.ControllerConfig{
			Enabled:        true,
			TargetAltitude: 1000,
			Kp:             0.02,
			Ki:             0.001,
			Kd:             0.65,
			CMin:           -1.2,
			CMax:           1.2,
		},
	}
}
