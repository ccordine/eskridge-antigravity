package control

import (
	"math"
	"math/cmplx"

	"github.com/example/acs/internal/coupler"
	"github.com/example/acs/internal/mathx"
	"github.com/example/acs/internal/physics"
)

type HoverControllerConfig struct {
	Enabled        bool
	TargetAltitude float64
	Kp             float64
	Ki             float64
	Kd             float64
	CMin           float64
	CMax           float64
}

type HoverController struct {
	cfg    HoverControllerConfig
	iTerm  float64
	omega0 float64
}

func NewHoverController(cfg HoverControllerConfig, omega0 float64) *HoverController {
	if cfg.CMin == 0 && cfg.CMax == 0 {
		cfg.CMin = -1.5
		cfg.CMax = 1.5
	}
	return &HoverController{cfg: cfg, omega0: omega0}
}

func (h *HoverController) Enabled() bool {
	return h != nil && h.cfg.Enabled
}

func (h *HoverController) Update(dt float64, craft physics.Craft, bodies []physics.CelestialBody, gRaw mathx.Vec3, couplerState *coupler.State, primaryIdx int) coupler.Command {
	if h == nil || !h.cfg.Enabled {
		return couplerState.Cmd
	}
	if primaryIdx < 0 || primaryIdx >= len(bodies) {
		return couplerState.Cmd
	}

	primary := bodies[primaryIdx]
	r := craft.Position.Sub(primary.Position)
	d := r.Norm()
	if d == 0 {
		return couplerState.Cmd
	}
	up := r.Scale(1.0 / d)
	altitude := d - primary.Radius
	vertVel := craft.Velocity.Sub(primary.Velocity).Dot(up)

	err := h.cfg.TargetAltitude - altitude
	h.iTerm += err * dt
	h.iTerm = mathx.Clamp(h.iTerm, -1e6, 1e6)
	aDesiredUp := h.cfg.Kp*err + h.cfg.Ki*h.iTerm - h.cfg.Kd*vertVel

	gMag := gRaw.Norm()
	if gMag <= 1e-9 {
		return couplerState.Cmd
	}

	cTarget := mathx.Clamp(-aDesiredUp/gMag, h.cfg.CMin, h.cfg.CMax)
	kTarget := math.Abs(cTarget)
	if kTarget < 0.15 {
		kTarget = 0.15
	}
	if kTarget > couplerState.Params.KMax {
		kTarget = couplerState.Params.KMax
	}

	ratio := cTarget / kTarget
	ratio = mathx.Clamp(ratio, -1, 1)
	phiTarget := math.Acos(ratio)
	lockDelta := mathx.WrapAngle(cmplx.Phase(couplerState.Z) - couplerState.ThetaDrive)
	thetaTarget := mathx.WrapAngle(phiTarget - couplerState.Params.PhiBias - lockDelta)

	gamma := 0.0
	if couplerState.Params.Q > 0 {
		gamma = couplerState.Params.Omega0 / (2.0 * couplerState.Params.Q)
	}
	ampTarget := 0.0
	if couplerState.Params.Alpha > 0 && couplerState.Params.Beta > 0 {
		ampTarget = kTarget * gamma / (couplerState.Params.Alpha * couplerState.Params.Beta)
	}
	ampTarget = mathx.Clamp(ampTarget, couplerState.Params.MinAmplitude, couplerState.Params.MaxAmplitude)

	return coupler.Command{
		Amplitude:   ampTarget,
		ThetaTarget: thetaTarget,
		OmegaBase:   h.omega0,
	}
}
