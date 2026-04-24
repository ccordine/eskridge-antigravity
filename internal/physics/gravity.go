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
