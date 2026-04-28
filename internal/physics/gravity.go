package physics

import (
	"math"
	"strings"

	"github.com/example/acs/internal/mathx"
)

type YukawaBodyDiagnostic struct {
	Body            string
	Distance        float64
	RepulsionFactor float64
	KernelFactor    float64
}

type SignedChargeBodyDiagnostic struct {
	Body             string
	Distance         float64
	ChargeMultiplier float64
	SignedCharge     float64
}

func GravityAt(pos mathx.Vec3, gConst float64, bodies []CelestialBody) mathx.Vec3 {
	g := mathx.Vec3{}
	for i := range bodies {
		r := pos.Sub(bodies[i].Position)
		r2 := r.Norm2()
		if r2 == 0 {
			continue
		}
		invR := 1.0 / (r2 * math.Sqrt(r2))
		term := r.Scale(-gConst * bodies[i].Mass * invR)
		g = g.Add(term)
	}
	return g
}

func GravityAtYukawa(pos mathx.Vec3, gConst float64, bodies []CelestialBody, alpha, lambda float64) (mathx.Vec3, []YukawaBodyDiagnostic) {
	g := mathx.Vec3{}
	diag := make([]YukawaBodyDiagnostic, 0, len(bodies))
	for i := range bodies {
		r := pos.Sub(bodies[i].Position)
		r2 := r.Norm2()
		if r2 == 0 {
			continue
		}
		dist := math.Sqrt(r2)
		repulsion := 0.0
		if lambda > 0 {
			repulsion = alpha * (1.0 + dist/lambda) * math.Exp(-dist/lambda)
		}
		kernelFactor := 1.0 - repulsion
		invR := 1.0 / (r2 * dist)
		term := r.Scale(-gConst * bodies[i].Mass * kernelFactor * invR)
		g = g.Add(term)
		diag = append(diag, YukawaBodyDiagnostic{
			Body:            bodies[i].Name,
			Distance:        dist,
			RepulsionFactor: repulsion,
			KernelFactor:    kernelFactor,
		})
	}
	return g, diag
}

func GravityAtSignedCharge(
	pos mathx.Vec3,
	gConst float64,
	bodies []CelestialBody,
	qgCraft float64,
	inertialSign float64,
	qgOverrides map[string]float64,
) (mathx.Vec3, []SignedChargeBodyDiagnostic) {
	g := mathx.Vec3{}
	diag := make([]SignedChargeBodyDiagnostic, 0, len(bodies))
	if inertialSign == 0 {
		inertialSign = 1
	}
	for i := range bodies {
		r := pos.Sub(bodies[i].Position)
		r2 := r.Norm2()
		if r2 == 0 {
			continue
		}
		dist := math.Sqrt(r2)
		invR := 1.0 / (r2 * dist)
		multiplier := chargeMultiplierForBody(bodies[i].Name, qgOverrides)
		qgBody := multiplier * bodies[i].Mass
		term := r.Scale(-gConst * (qgCraft / inertialSign) * qgBody * invR)
		g = g.Add(term)
		diag = append(diag, SignedChargeBodyDiagnostic{
			Body:             bodies[i].Name,
			Distance:         dist,
			ChargeMultiplier: multiplier,
			SignedCharge:     qgBody,
		})
	}
	return g, diag
}

func chargeMultiplierForBody(name string, overrides map[string]float64) float64 {
	if len(overrides) == 0 {
		return 1
	}
	if v, ok := overrides[name]; ok {
		return v
	}
	normalized := strings.TrimSpace(strings.ToLower(name))
	if normalized == "" {
		return 1
	}
	if v, ok := overrides[normalized]; ok {
		return v
	}
	return 1
}

func BodyAccelerations(gConst float64, bodies []CelestialBody) []mathx.Vec3 {
	accels := make([]mathx.Vec3, len(bodies))
	for i := range bodies {
		ai := mathx.Vec3{}
		for j := range bodies {
			if i == j {
				continue
			}
			r := bodies[i].Position.Sub(bodies[j].Position)
			r2 := r.Norm2()
			if r2 == 0 {
				continue
			}
			invR3 := 1.0 / (r2 * math.Sqrt(r2))
			ai = ai.Add(r.Scale(-gConst * bodies[j].Mass * invR3))
		}
		accels[i] = ai
	}
	return accels
}

func IntegrateBodiesSemiImplicit(dt float64, gConst float64, bodies []CelestialBody) {
	accels := BodyAccelerations(gConst, bodies)
	for i := range bodies {
		bodies[i].Velocity = bodies[i].Velocity.Add(accels[i].Scale(dt))
		bodies[i].Position = bodies[i].Position.Add(bodies[i].Velocity.Scale(dt))
	}
}

func bodyAccelerationsAtState(gConst float64, masses []float64, positions []mathx.Vec3) []mathx.Vec3 {
	accels := make([]mathx.Vec3, len(positions))
	for i := range positions {
		ai := mathx.Vec3{}
		for j := range positions {
			if i == j {
				continue
			}
			r := positions[i].Sub(positions[j])
			r2 := r.Norm2()
			if r2 == 0 {
				continue
			}
			invR3 := 1.0 / (r2 * math.Sqrt(r2))
			ai = ai.Add(r.Scale(-gConst * masses[j] * invR3))
		}
		accels[i] = ai
	}
	return accels
}

// IntegrateBodiesRK4 advances body positions/velocities using fixed-step RK4.
func IntegrateBodiesRK4(dt float64, gConst float64, bodies []CelestialBody) {
	n := len(bodies)
	if n == 0 || dt == 0 {
		return
	}
	masses := make([]float64, n)
	p0 := make([]mathx.Vec3, n)
	v0 := make([]mathx.Vec3, n)
	for i := range bodies {
		masses[i] = bodies[i].Mass
		p0[i] = bodies[i].Position
		v0[i] = bodies[i].Velocity
	}
	a1 := bodyAccelerationsAtState(gConst, masses, p0)
	k1p := make([]mathx.Vec3, n)
	k1v := make([]mathx.Vec3, n)
	for i := 0; i < n; i++ {
		k1p[i] = v0[i]
		k1v[i] = a1[i]
	}
	p2 := make([]mathx.Vec3, n)
	v2 := make([]mathx.Vec3, n)
	for i := 0; i < n; i++ {
		p2[i] = p0[i].Add(k1p[i].Scale(dt * 0.5))
		v2[i] = v0[i].Add(k1v[i].Scale(dt * 0.5))
	}
	a2 := bodyAccelerationsAtState(gConst, masses, p2)
	k2p := v2
	k2v := a2
	p3 := make([]mathx.Vec3, n)
	v3 := make([]mathx.Vec3, n)
	for i := 0; i < n; i++ {
		p3[i] = p0[i].Add(k2p[i].Scale(dt * 0.5))
		v3[i] = v0[i].Add(k2v[i].Scale(dt * 0.5))
	}
	a3 := bodyAccelerationsAtState(gConst, masses, p3)
	k3p := v3
	k3v := a3
	p4 := make([]mathx.Vec3, n)
	v4 := make([]mathx.Vec3, n)
	for i := 0; i < n; i++ {
		p4[i] = p0[i].Add(k3p[i].Scale(dt))
		v4[i] = v0[i].Add(k3v[i].Scale(dt))
	}
	a4 := bodyAccelerationsAtState(gConst, masses, p4)
	k4p := v4
	k4v := a4
	for i := range bodies {
		dp := k1p[i].Add(k2p[i].Scale(2)).Add(k3p[i].Scale(2)).Add(k4p[i]).Scale(dt / 6.0)
		dv := k1v[i].Add(k2v[i].Scale(2)).Add(k3v[i].Scale(2)).Add(k4v[i]).Scale(dt / 6.0)
		bodies[i].Position = p0[i].Add(dp)
		bodies[i].Velocity = v0[i].Add(dv)
	}
}
