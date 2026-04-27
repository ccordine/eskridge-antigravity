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
