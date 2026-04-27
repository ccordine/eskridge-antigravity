package physics

import (
	"math"
	"strings"

	"github.com/example/acs/internal/mathx"
)

type DragEval struct {
	Force           mathx.Vec3
	Density         float64
	Speed           float64
	ReferenceArea   float64
	EffectiveCd     float64
	PlasmaLevel     float64
	PlasmaReduction float64
	PlasmaPower     float64
}

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
	return DragEvaluation(c, env, primary).Force
}

func DragEvaluation(c Craft, env Environment, primary CelestialBody) DragEval {
	if !c.Drag.Enabled || !env.Atmosphere.Enabled || c.Drag.Area <= 0 || c.Drag.Cd <= 0 {
		// Allow the game layer to provide only span + Cd and let the
		// physics layer derive projected area.
		if !c.Drag.Enabled || !env.Atmosphere.Enabled || c.Drag.Cd <= 0 {
			return DragEval{}
		}
	}
	alt := c.Position.Sub(primary.Position).Norm() - primary.Radius
	rho := AtmosDensity(env.Atmosphere, alt)
	if rho <= 0 {
		return DragEval{}
	}
	vRel := c.Velocity.Sub(primary.Velocity).Sub(env.Atmosphere.Wind)
	speed := vRel.Norm()
	if speed == 0 {
		return DragEval{Density: rho}
	}
	flowDirWorld := vRel.Scale(-1.0 / speed)
	area := dragReferenceArea(c, flowDirWorld)
	if area <= 0 {
		return DragEval{
			Density: rho,
			Speed:   speed,
		}
	}
	cd := c.Drag.Cd
	plasmaReduction, plasmaPower := plasmaSheathEffect(c, env.Atmosphere, rho, speed, area)
	cdEff := cd * (1 - plasmaReduction)
	if cdEff < 0.02 {
		cdEff = 0.02
	}
	coef := -0.5 * rho * cdEff * area
	return DragEval{
		Force:           vRel.Scale(coef * speed),
		Density:         rho,
		Speed:           speed,
		ReferenceArea:   area,
		EffectiveCd:     cdEff,
		PlasmaLevel:     c.Drag.Plasma.Level,
		PlasmaReduction: plasmaReduction,
		PlasmaPower:     plasmaPower,
	}
}

func dragReferenceArea(c Craft, flowDirWorld mathx.Vec3) float64 {
	if c.Drag.ReferenceSpan <= 0 {
		return c.Drag.Area
	}
	flowDirBody := c.Orientation.Conj().Rotate(flowDirWorld).Normalize()
	if flowDirBody.Norm2() == 0 {
		flowDirBody = mathx.Vec3{X: 1}
	}
	a, b, cc := dragShapeAxes(c)
	if a <= 0 || b <= 0 || cc <= 0 {
		return c.Drag.Area
	}
	den := math.Sqrt((a*flowDirBody.X)*(a*flowDirBody.X) + (b*flowDirBody.Y)*(b*flowDirBody.Y) + (cc*flowDirBody.Z)*(cc*flowDirBody.Z))
	if den <= 1e-9 {
		return c.Drag.Area
	}
	ellipsoidArea := math.Pi * a * b * cc / den
	if c.Drag.Area > 0 {
		// Blend scenario-provided reference area with shape projection so
		// authored scenarios remain relevant while orientation still matters.
		return 0.35*c.Drag.Area + 0.65*ellipsoidArea
	}
	return ellipsoidArea
}

func dragShapeAxes(c Craft) (float64, float64, float64) {
	span := c.Drag.ReferenceSpan
	if span <= 0 {
		return 0, 0, 0
	}
	switch strings.ToLower(strings.TrimSpace(c.ShipType)) {
	case "sphere":
		r := span * 0.5
		return r, r, r
	case "egg":
		return span * 0.24, span * 0.24, span * 0.36
	case "pyramid":
		return span * 0.28, span * 0.28, span * 0.20
	case "flat_triangle":
		return span * 0.42, span * 0.34, span * 0.035
	default: // saucer and unknown disks
		return span * 0.5, span * 0.5, span * 0.055
	}
}

func plasmaSheathEffect(c Craft, atm Atmosphere, rho, speed, area float64) (float64, float64) {
	if !c.Drag.Plasma.Enabled || c.Drag.Plasma.Level <= 0 || area <= 0 {
		return 0, 0
	}
	level := mathx.Clamp(c.Drag.Plasma.Level, 0, 1)
	maxReduction := c.Drag.Plasma.MaxDragReduction
	if maxReduction <= 0 {
		maxReduction = 0.18
	}
	authoritySpeed := c.Drag.Plasma.AuthoritySpeed
	if authoritySpeed <= 0 {
		authoritySpeed = 8.0
	}
	falloff := c.Drag.Plasma.VelocityFalloff
	if falloff <= 0 {
		falloff = 40.0
	}
	densityFactor := 1.0
	if atm.Rho0 > 1e-9 {
		densityFactor = math.Sqrt(math.Max(rho, 0) / atm.Rho0)
	}
	induced := authoritySpeed * level * densityFactor
	speedAuthority := induced / (math.Abs(speed) + induced + 1e-9)
	regimeFactor := 1.0 / (1.0 + (speed/falloff)*(speed/falloff))
	reduction := maxReduction * level * speedAuthority * regimeFactor
	if reduction < 0 {
		reduction = 0
	}
	if reduction > maxReduction {
		reduction = maxReduction
	}
	powerPerArea := c.Drag.Plasma.PowerPerArea
	if powerPerArea <= 0 {
		powerPerArea = 320.0
	}
	plasmaPower := powerPerArea * area * level * level * math.Max(0.35, densityFactor)
	return reduction, plasmaPower
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
