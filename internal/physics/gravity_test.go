package physics

import (
	"math"
	"testing"

	"github.com/example/acs/internal/mathx"
)

func TestGravitySingleBody(t *testing.T) {
	const (
		G = 6.6743e-11
		M = 5.972e24
		R = 6371000.0
	)
	bodies := []CelestialBody{{Name: "earth", Mass: M, Position: mathx.Vec3{}, Radius: R}}
	p := mathx.Vec3{Z: R + 1000}
	g := GravityAt(p, G, bodies)

	expected := -G * M / ((R + 1000) * (R + 1000))
	if math.Abs(g.Z-expected) > 1e-6 {
		t.Fatalf("unexpected g.Z: got %.9f expected %.9f", g.Z, expected)
	}
	if math.Abs(g.X) > 1e-12 || math.Abs(g.Y) > 1e-12 {
		t.Fatalf("unexpected lateral gravity: %+v", g)
	}
}

func TestGravityTwoBodySymmetry(t *testing.T) {
	const (
		G = 1.0
		M = 10.0
	)
	bodies := []CelestialBody{
		{Mass: M, Position: mathx.Vec3{X: -1}},
		{Mass: M, Position: mathx.Vec3{X: 1}},
	}
	g := GravityAt(mathx.Vec3{}, G, bodies)
	if g.Norm() > 1e-12 {
		t.Fatalf("symmetry should cancel gravity, got %+v", g)
	}
}

func TestYukawaAlphaZeroMatchesNewtonian(t *testing.T) {
	const (
		G = 6.6743e-11
		M = 5.972e24
		R = 6371000.0
	)
	bodies := []CelestialBody{{Name: "earth", Mass: M, Position: mathx.Vec3{}, Radius: R}}
	p := mathx.Vec3{Z: R + 1000}

	newton := GravityAt(p, G, bodies)
	yukawa, diag := GravityAtYukawa(p, G, bodies, 0, 1.0e7)

	if len(diag) != 1 {
		t.Fatalf("expected one diagnostic entry, got %d", len(diag))
	}
	if math.Abs(yukawa.Z-newton.Z) > 1e-12 {
		t.Fatalf("alpha=0 should match Newtonian, got %.12f want %.12f", yukawa.Z, newton.Z)
	}
}

func TestYukawaPositiveAlphaWeakensAttraction(t *testing.T) {
	const (
		G = 6.6743e-11
		M = 5.972e24
		R = 6371000.0
	)
	bodies := []CelestialBody{{Name: "earth", Mass: M, Position: mathx.Vec3{}, Radius: R}}
	p := mathx.Vec3{Z: R + 1000}

	newton := GravityAt(p, G, bodies)
	yukawa, diag := GravityAtYukawa(p, G, bodies, 0.5, 1.0e7)
	if len(diag) != 1 {
		t.Fatalf("expected one diagnostic entry, got %d", len(diag))
	}
	if !(math.Abs(yukawa.Z) < math.Abs(newton.Z)) {
		t.Fatalf("expected weaker attraction, newton=%.9f yukawa=%.9f", newton.Z, yukawa.Z)
	}
	if !(diag[0].RepulsionFactor > 0) {
		t.Fatalf("expected positive repulsion factor, got %.9f", diag[0].RepulsionFactor)
	}
}

func TestSignedChargeModelC1AndC2(t *testing.T) {
	const (
		G = 6.6743e-11
		M = 5.972e24
		R = 6371000.0
	)
	bodies := []CelestialBody{{Name: "earth", Mass: M, Position: mathx.Vec3{}, Radius: R}}
	p := mathx.Vec3{Z: R + 1000}

	c1, _ := GravityAtSignedCharge(p, G, bodies, -1, 1, nil)
	c2, _ := GravityAtSignedCharge(p, G, bodies, -1, -1, nil)

	if !(c1.Z > 0) {
		t.Fatalf("C1 with qg_craft=-1 should repel (positive z), got %.9f", c1.Z)
	}
	if !(c2.Z < 0) {
		t.Fatalf("C2 with qg_craft=-1 should attract under signed inertia, got %.9f", c2.Z)
	}
}

func TestSignedChargeBodyOverride(t *testing.T) {
	const (
		G = 1.0
		M = 10.0
	)
	bodies := []CelestialBody{{Name: "A", Mass: M, Position: mathx.Vec3{Z: -1}}}
	p := mathx.Vec3{}

	base := GravityAt(p, G, bodies)
	withOverride, diag := GravityAtSignedCharge(
		p,
		G,
		bodies,
		1,
		1,
		map[string]float64{"a": -1},
	)
	if len(diag) != 1 {
		t.Fatalf("expected one diagnostic entry, got %d", len(diag))
	}
	if math.Abs(withOverride.Z+base.Z) > 1e-12 {
		t.Fatalf("signed override should flip acceleration sign, base=%.9f override=%.9f", base.Z, withOverride.Z)
	}
}
