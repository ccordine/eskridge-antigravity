package physics

import (
	"testing"

	"github.com/example/acs/internal/mathx"
)

func TestDragEvaluationPlasmaSheathReducesDrag(t *testing.T) {
	base := Craft{
		Mass:        1200,
		ShipType:    "saucer",
		Position:    mathx.Vec3{Z: 6_372_000},
		Velocity:    mathx.Vec3{X: 120},
		Orientation: mathx.IdentityQuat(),
		Drag: DragModel{
			Enabled:       true,
			Cd:            0.18,
			ReferenceSpan: 15.8,
			Plasma: PlasmaSheath{
				Enabled:          true,
				MaxDragReduction: 0.18,
				AuthoritySpeed:   28,
				VelocityFalloff:  280,
				PowerPerArea:     320,
			},
		},
	}
	env := Environment{
		Atmosphere: Atmosphere{
			Enabled:     true,
			Rho0:        1.225,
			ScaleHeight: 8500,
		},
	}
	primary := CelestialBody{Radius: 6_371_000}

	offEval := DragEvaluation(base, env, primary)
	base.Drag.Plasma.Level = 1
	onEval := DragEvaluation(base, env, primary)

	if offEval.Force.Norm() <= 0 {
		t.Fatalf("expected baseline drag force > 0")
	}
	if onEval.Force.Norm() >= offEval.Force.Norm() {
		t.Fatalf("expected plasma sheath to reduce drag magnitude: off=%.6g on=%.6g", offEval.Force.Norm(), onEval.Force.Norm())
	}
	if onEval.PlasmaReduction <= 0 {
		t.Fatalf("expected plasma drag reduction > 0")
	}
	if onEval.PlasmaPower <= 0 {
		t.Fatalf("expected plasma power draw > 0")
	}
}

func TestEvaluateForcesIncludesLiftAndThrust(t *testing.T) {
	craft := Craft{
		Mass:        1200,
		ShipType:    "saucer",
		Position:    mathx.Vec3{Z: 6_372_000},
		Velocity:    mathx.Vec3{X: 180, Z: -18},
		Orientation: mathx.IdentityQuat(),
		Drag: DragModel{
			Enabled:       true,
			Cd:            0.22,
			ReferenceSpan: 15.8,
		},
		Aero: AeroModel{
			Enabled: true,
			ClAlpha: 5.4,
			ClMax:   1.4,
		},
		Propulsion: PropulsionModel{
			Enabled:   true,
			Throttle:  0.5,
			MaxThrust: 80_000,
		},
	}
	env := Environment{
		Atmosphere: Atmosphere{
			Enabled:      true,
			Rho0:         1.225,
			ScaleHeight:  8500,
			Temperature0: 288.15,
			LapseRate:    -0.0065,
			Gamma:        1.4,
			GasConstant:  287.05,
		},
	}
	primary := CelestialBody{Radius: 6_371_000}
	gravity := mathx.Vec3{Z: -9.81}
	f := EvaluateForces(craft, env, primary, gravity)
	if f.DragEval.Mach <= 0 {
		t.Fatalf("expected positive Mach, got %.6g", f.DragEval.Mach)
	}
	if f.Lift.Norm() <= 0 {
		t.Fatalf("expected lift force > 0")
	}
	if f.Thrust.Norm() <= 0 {
		t.Fatalf("expected thrust force > 0")
	}
	if f.GLoad <= 0 {
		t.Fatalf("expected positive g-load")
	}
}

func TestNoAtmosphereHasNoDragOrLift(t *testing.T) {
	craft := Craft{
		Mass:        800,
		ShipType:    "sphere",
		Position:    mathx.Vec3{Z: 2_000_000},
		Velocity:    mathx.Vec3{X: 900},
		Orientation: mathx.IdentityQuat(),
		Drag: DragModel{
			Enabled:       true,
			Cd:            0.47,
			ReferenceSpan: 8,
		},
		Aero: AeroModel{Enabled: true, ClAlpha: 5, ClMax: 1.2},
	}
	env := Environment{
		Atmosphere: Atmosphere{Enabled: false},
	}
	primary := CelestialBody{Radius: 1_700_000}
	f := EvaluateForces(craft, env, primary, mathx.Vec3{Z: -1.62})
	if f.Drag.Norm() != 0 {
		t.Fatalf("expected no drag in vacuum, got %.6g", f.Drag.Norm())
	}
	if f.Lift.Norm() != 0 {
		t.Fatalf("expected no lift in vacuum, got %.6g", f.Lift.Norm())
	}
}

func TestMachDragRise(t *testing.T) {
	craft := Craft{
		Mass:        1000,
		ShipType:    "saucer",
		Position:    mathx.Vec3{Z: 6_372_000},
		Orientation: mathx.IdentityQuat(),
		Drag: DragModel{
			Enabled:       true,
			Cd:            0.18,
			ReferenceSpan: 12,
		},
	}
	env := Environment{
		Atmosphere: Atmosphere{
			Enabled:      true,
			Rho0:         1.225,
			ScaleHeight:  8500,
			Temperature0: 288.15,
			Gamma:        1.4,
			GasConstant:  287.05,
		},
	}
	primary := CelestialBody{Radius: 6_371_000}
	slow := craft
	slow.Velocity = mathx.Vec3{X: 180}
	fast := craft
	fast.Velocity = mathx.Vec3{X: 600}
	ds := DragEvaluation(slow, env, primary)
	df := DragEvaluation(fast, env, primary)
	if !(df.EffectiveCd > ds.EffectiveCd) {
		t.Fatalf("expected Mach drag rise, slow Cd=%.6g fast Cd=%.6g", ds.EffectiveCd, df.EffectiveCd)
	}
}

func TestEMForceDisabledWhenChargeZero(t *testing.T) {
	craft := Craft{
		Mass:        1000,
		Position:    mathx.Vec3{Z: 6_372_000},
		Velocity:    mathx.Vec3{X: 100},
		Orientation: mathx.IdentityQuat(),
		EM: EMModel{
			Enabled: true,
			ChargeC: 0,
		},
	}
	env := Environment{
		EField: mathx.Vec3{X: 500},
		BField: mathx.Vec3{Y: 0.01},
	}
	primary := CelestialBody{Radius: 6_371_000}
	f := EvaluateForces(craft, env, primary, mathx.Vec3{Z: -9.81})
	if f.EM.Norm() != 0 {
		t.Fatalf("expected zero EM force when charge is zero, got %.6g", f.EM.Norm())
	}
}
