package energy

import "math"

type Request struct {
	CouplerW float64
	PlasmaW  float64
	ThrustW  float64
	EMW      float64
}

type Grant struct {
	CouplerW    float64
	PlasmaW     float64
	ThrustW     float64
	EMW         float64
	CurtailFrac float64
	UsedJ       float64
}

// Allocate grants non-coupler loads from a shared energy pool.
// Coupler consumption is handled in the coupler subsystem itself.
func Allocate(availableJ, dt float64, req Request) Grant {
	if dt <= 0 || availableJ <= 0 {
		return Grant{}
	}
	reqCoupler := math.Max(0, req.CouplerW)
	reqPlasma := math.Max(0, req.PlasmaW)
	reqThrust := math.Max(0, req.ThrustW)
	reqEM := math.Max(0, req.EMW)
	totalReq := reqCoupler + reqPlasma + reqThrust + reqEM
	if totalReq <= 1e-12 {
		return Grant{}
	}
	maxGrantW := availableJ / dt
	scale := 1.0
	curtail := 0.0
	if totalReq > maxGrantW {
		scale = maxGrantW / totalReq
		if scale < 0 {
			scale = 0
		}
		if scale > 1 {
			scale = 1
		}
		curtail = 1 - scale
	}
	gc := reqCoupler * scale
	gp := reqPlasma * scale
	gt := reqThrust * scale
	ge := reqEM * scale
	used := (gc + gp + gt + ge) * dt
	if used > availableJ {
		used = availableJ
	}
	return Grant{
		CouplerW:    gc,
		PlasmaW:     gp,
		ThrustW:     gt,
		EMW:         ge,
		CurtailFrac: curtail,
		UsedJ:       used,
	}
}
