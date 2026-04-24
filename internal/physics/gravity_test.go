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
