package physics

import (
	"math"

	"github.com/example/acs/internal/mathx"
)

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
