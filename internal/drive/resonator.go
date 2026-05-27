package drive

import (
	"math"

	"github.com/example/acs/internal/coupler"
	"github.com/example/acs/internal/mathx"
)

type Resonator struct {
	State *coupler.State
}

func (r Resonator) Authority() float64 {
	if r.State == nil {
		return 1
	}
	return r.State.Authority()
}

func (r Resonator) Phase() float64 {
	if r.State == nil {
		return 0
	}
	return r.State.Phi
}

func PhaseRotatedDirection(base mathx.Vec3, phase float64) mathx.Vec3 {
	n := base.Normalize()
	if n.Norm2() == 0 {
		n = mathx.Vec3{Z: 1}
	}
	c, s := math.Cos(phase), math.Sin(phase)
	return mathx.Vec3{X: c*n.X - s*n.Y, Y: s*n.X + c*n.Y, Z: n.Z}.Normalize()
}
