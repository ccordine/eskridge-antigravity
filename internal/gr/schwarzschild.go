package gr

import (
	"fmt"
	"math"

	"github.com/example/acs/internal/mathx"
)

type SchwarzschildIsotropic struct {
	Mass    float64
	GConst  float64
	Center  mathx.Vec3
	MinRhoM float64
}

func (s SchwarzschildIsotropic) MetricAt(e Event) (Metric, error) {
	gc := s.GConst
	if gc == 0 {
		gc = G
	}
	x := e.X[1] - s.Center.X
	y := e.X[2] - s.Center.Y
	z := e.X[3] - s.Center.Z
	rho := math.Sqrt(x*x + y*y + z*z)
	if rho <= s.MinRhoM || rho == 0 {
		return Metric{}, fmt.Errorf("event is inside unsupported Schwarzschild isotropic radius")
	}
	rs := 2 * gc * s.Mass / (C * C)
	q := rs / (4 * rho)
	if q >= 1 {
		return Metric{}, fmt.Errorf("event is at or inside isotropic Schwarzschild horizon")
	}
	alpha := (1 - q) / (1 + q)
	psi := 1 + q
	spatial := math.Pow(psi, 4)
	return Metric{{-alpha * alpha, 0, 0, 0}, {0, spatial, 0, 0}, {0, 0, spatial, 0}, {0, 0, 0, spatial}}, nil
}
