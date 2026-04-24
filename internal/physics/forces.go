package physics

import (
	"math"

	"github.com/example/acs/internal/mathx"
)

func AtmosDensity(atm Atmosphere, altitude float64) float64 {
	if !atm.Enabled {
		return 0
	}
	h := altitude
	if h < 0 {
		h = 0
	}
	if atm.ScaleHeight <= 0 {
		return atm.Rho0
	}
	return atm.Rho0 * math.Exp(-h/atm.ScaleHeight)
}

func DragForce(c Craft, env Environment, primary CelestialBody) mathx.Vec3 {
	if !c.Drag.Enabled || !env.Atmosphere.Enabled || c.Drag.Area <= 0 || c.Drag.Cd <= 0 {
		return mathx.Vec3{}
	}
	alt := c.Position.Sub(primary.Position).Norm() - primary.Radius
	rho := AtmosDensity(env.Atmosphere, alt)
	if rho <= 0 {
		return mathx.Vec3{}
	}
	vRel := c.Velocity.Sub(primary.Velocity).Sub(env.Atmosphere.Wind)
	speed := vRel.Norm()
	if speed == 0 {
		return mathx.Vec3{}
	}
	coef := -0.5 * rho * c.Drag.Cd * c.Drag.Area
	return vRel.Scale(coef * speed)
}

func ResolveGroundContact(c *Craft, env Environment, groundBody CelestialBody) {
	if !env.Ground.Enabled {
		return
	}
	r := c.Position.Sub(groundBody.Position)
	d := r.Norm()
	minD := groundBody.Radius + env.Ground.SurfaceEps
	if d >= minD || d == 0 {
		return
	}
	n := r.Scale(1.0 / d)
	c.Position = groundBody.Position.Add(n.Scale(minD))

	vRel := c.Velocity.Sub(groundBody.Velocity)
	vn := vRel.Dot(n)
	if vn < 0 {
		vRel = vRel.Sub(n.Scale((1 + env.Ground.Restitution) * vn))
	}
	vt := vRel.Sub(n.Scale(vRel.Dot(n)))
	vtMag := vt.Norm()
	if vtMag > 0 && env.Ground.TangentialMu > 0 {
		fric := math.Min(vtMag, env.Ground.TangentialMu*math.Abs(vn))
		vRel = vRel.Sub(vt.Scale(fric / vtMag))
	}
	c.Velocity = groundBody.Velocity.Add(vRel)
}
