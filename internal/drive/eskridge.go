package drive

import "github.com/example/acs/internal/mathx"

type EskridgeDrive struct {
	Params    WarpShiftParams
	Resonator Resonator
}

func (d EskridgeDrive) MetricParams() WarpShiftParams {
	p := d.Params
	p.Authority *= d.Resonator.Authority()
	p.Phase += d.Resonator.Phase()
	if p.Direction.Norm2() == 0 {
		p.Direction = mathx.Vec3{Z: 1}
	}
	return p
}
