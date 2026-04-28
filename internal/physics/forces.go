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
	Mach            float64
}

type ForceBreakdown struct {
	Gravity   mathx.Vec3
	Drag      mathx.Vec3
	Lift      mathx.Vec3
	Thrust    mathx.Vec3
	EM        mathx.Vec3
	Net       mathx.Vec3
	DragEval  DragEval
	LiftCoeff float64
	AoA       float64
	GLoad     float64
	DynamicQ  float64
	HeatFlux  float64
	SkinTempK float64
	StructOK  bool
	PilotOK   bool
	Warnings  []string
	GAxisLong float64
	GAxisLat  float64
	GAxisVert float64
	RelGamma  float64
	RelBeta   float64
}

func AtmosDensity(atm Atmosphere, altitude float64) float64 {
	if !atm.Enabled {
		return 0
	}
	if len(atm.Layers) > 0 {
		layer := selectAtmosphereLayer(atm, altitude)
		h := altitude
		if h < layer.MinAlt {
			h = layer.MinAlt
		}
		scaleH := layer.ScaleHeight
		if scaleH <= 0 {
			scaleH = atm.ScaleHeight
		}
		if scaleH <= 0 {
			return layer.Rho0
		}
		return layer.Rho0 * math.Exp(-(h-layer.MinAlt)/scaleH)
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

func selectAtmosphereLayer(atm Atmosphere, altitude float64) AtmosphereLayer {
	if len(atm.Layers) == 0 {
		return AtmosphereLayer{
			MinAlt:       0,
			MaxAlt:       math.Inf(1),
			Rho0:         atm.Rho0,
			ScaleHeight:  atm.ScaleHeight,
			Temperature0: atm.Temperature0,
			LapseRate:    atm.LapseRate,
			Gamma:        atm.Gamma,
			GasConstant:  atm.GasConstant,
		}
	}
	h := math.Max(0, altitude)
	for _, layer := range atm.Layers {
		if h >= layer.MinAlt && h < layer.MaxAlt {
			return layer
		}
	}
	last := atm.Layers[len(atm.Layers)-1]
	return last
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
	vRel := c.Velocity.Sub(primary.Velocity).Sub(atmosphereWind(env.Atmosphere, alt))
	speed := vRel.Norm()
	if speed == 0 {
		return DragEval{Density: rho}
	}
	mach := 0.0
	sound := SpeedOfSound(env.Atmosphere, alt)
	if sound > 1e-9 {
		mach = speed / sound
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
	cdEff := cd * compressibilityDragFactor(mach) * (1 - plasmaReduction)
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
		Mach:            mach,
	}
}

func SpeedOfSound(atm Atmosphere, altitude float64) float64 {
	t := atmosphereTemperatureK(atm, altitude)
	if t <= 0 {
		return 0
	}
	layer := selectAtmosphereLayer(atm, altitude)
	gamma := layer.Gamma
	if gamma <= 0 {
		gamma = atm.Gamma
	}
	if gamma <= 0 {
		gamma = 1.4
	}
	r := layer.GasConstant
	if r <= 0 {
		r = atm.GasConstant
	}
	if r <= 0 {
		r = 287.05
	}
	return math.Sqrt(gamma * r * t)
}

func atmosphereTemperatureK(atm Atmosphere, altitude float64) float64 {
	layer := selectAtmosphereLayer(atm, altitude)
	t0 := layer.Temperature0
	if t0 <= 0 {
		t0 = atm.Temperature0
	}
	if t0 <= 0 {
		t0 = 288.15
	}
	lapse := layer.LapseRate
	if lapse == 0 {
		lapse = atm.LapseRate
	}
	if lapse == 0 {
		lapse = -0.0065
	}
	baseAlt := math.Max(0, layer.MinAlt)
	t := t0 + lapse*(math.Max(altitude, 0)-baseAlt)
	if t < 180 {
		return 180
	}
	return t
}

func atmosphereWind(atm Atmosphere, altitude float64) mathx.Vec3 {
	w := atm.Wind
	// Deterministic shear/turbulence proxy for flight handling.
	h := math.Max(0, altitude)
	shear := math.Min(h/20000.0, 1.0)
	gust := math.Sin(h*0.00037) * 0.6
	return w.Add(mathx.Vec3{
		X: w.X * 0.25 * shear,
		Y: w.Y * 0.25 * shear,
		Z: gust,
	})
}

func compressibilityDragFactor(mach float64) float64 {
	if mach <= 0.7 {
		return 1
	}
	if mach < 1.2 {
		x := (mach - 0.7) / 0.5
		return 1 + 1.8*x*x
	}
	mSup := mach - 1.2
	return 2.8 + 0.18*mSup*mSup
}

func EvaluateForces(c Craft, env Environment, primary CelestialBody, gravityAccel mathx.Vec3) ForceBreakdown {
	drag := DragEvaluation(c, env, primary)
	alt := c.Position.Sub(primary.Position).Norm() - primary.Radius
	vRel := c.Velocity.Sub(primary.Velocity).Sub(atmosphereWind(env.Atmosphere, alt))
	speed := vRel.Norm()
	lift, cl, aoa := liftForce(c, drag, vRel, speed)
	thrust := thrustForce(c)
	em := emForce(c, env, c.Velocity.Sub(primary.Velocity))
	net := gravityAccel.Scale(c.Mass).Add(drag.Force).Add(lift).Add(thrust).Add(em)
	gload := 0.0
	gLong := 0.0
	gLat := 0.0
	gVert := 0.0
	if c.Mass > 1e-9 {
		// Proper acceleration proxy: non-gravitational acceleration magnitude.
		proper := drag.Force.Add(lift).Add(thrust).Add(em).Scale(1.0 / c.Mass)
		gload = proper.Norm() / 9.80665
		forward := c.Orientation.Rotate(mathx.Vec3{X: 1}).Normalize()
		right := c.Orientation.Rotate(mathx.Vec3{Y: 1}).Normalize()
		up := c.Orientation.Rotate(mathx.Vec3{Z: 1}).Normalize()
		if forward.Norm2() > 0 {
			gLong = proper.Dot(forward) / 9.80665
		}
		if right.Norm2() > 0 {
			gLat = proper.Dot(right) / 9.80665
		}
		if up.Norm2() > 0 {
			gVert = proper.Dot(up) / 9.80665
		}
	}
	dynamicQ := 0.5 * drag.Density * speed * speed
	heatFlux := aeroHeatFlux(c, dynamicQ, speed)
	skinTemp := estimateSkinTemp(c, heatFlux)
	structOK, pilotOK, warnings := evaluateLimits(c, dynamicQ, heatFlux, gload, gLong, gLat, gVert)
	relBeta, relGamma := relativisticTerms(speed)
	return ForceBreakdown{
		Gravity:   gravityAccel.Scale(c.Mass),
		Drag:      drag.Force,
		Lift:      lift,
		Thrust:    thrust,
		EM:        em,
		Net:       net,
		DragEval:  drag,
		LiftCoeff: cl,
		AoA:       aoa,
		GLoad:     gload,
		DynamicQ:  dynamicQ,
		HeatFlux:  heatFlux,
		SkinTempK: skinTemp,
		StructOK:  structOK,
		PilotOK:   pilotOK,
		Warnings:  warnings,
		GAxisLong: gLong,
		GAxisLat:  gLat,
		GAxisVert: gVert,
		RelGamma:  relGamma,
		RelBeta:   relBeta,
	}
}

func relativisticTerms(speed float64) (beta, gamma float64) {
	const c0 = 299792458.0
	if speed <= 0 {
		return 0, 1
	}
	b := speed / c0
	if b < 0 {
		b = 0
	}
	if b >= 0.999999999 {
		b = 0.999999999
	}
	g := 1.0 / math.Sqrt(1-b*b)
	return b, g
}

func aeroHeatFlux(c Craft, dynamicQ, speed float64) float64 {
	if !c.Thermal.Enabled {
		return 0
	}
	htc := c.Thermal.HeatTransferCoeff
	if htc <= 0 {
		htc = 7.5e-4
	}
	return htc * dynamicQ * math.Max(speed, 0)
}

func estimateSkinTemp(c Craft, heatFlux float64) float64 {
	if !c.Thermal.Enabled {
		return 0
	}
	t0 := c.Thermal.InitialSkinTempK
	if t0 <= 0 {
		t0 = 295
	}
	capacity := c.Thermal.ReferenceHeatCapacity
	if capacity <= 0 {
		capacity = 1.8e6
	}
	emit := c.Thermal.Emissivity
	if emit <= 0 {
		emit = 0.85
	}
	radCoeff := c.Thermal.RadiativeCoeff
	if radCoeff <= 0 {
		radCoeff = 1.2e-8
	}
	excess := heatFlux / capacity
	radLoss := radCoeff * emit * math.Pow(t0, 4) / capacity
	return t0 + (excess - radLoss)
}

func evaluateLimits(c Craft, dynamicQ, heatFlux, gload, gLong, gLat, gVert float64) (bool, bool, []string) {
	structOK := true
	pilotOK := true
	var warnings []string
	if c.Structural.Enabled {
		if c.Structural.MaxGLoad > 0 && gload > c.Structural.MaxGLoad {
			structOK = false
			warnings = append(warnings, "struct-g")
		}
		if c.Structural.MaxDynamicQPa > 0 && dynamicQ > c.Structural.MaxDynamicQPa {
			structOK = false
			warnings = append(warnings, "struct-q")
		}
		if c.Structural.MaxHeatFluxWm2 > 0 && heatFlux > c.Structural.MaxHeatFluxWm2 {
			structOK = false
			warnings = append(warnings, "struct-heat")
		}
	}
	if c.Pilot.Enabled {
		maxPos := c.Pilot.MaxGPositive
		maxNeg := c.Pilot.MaxGNegative
		if maxPos <= 0 {
			maxPos = 9
		}
		if maxNeg <= 0 {
			maxNeg = 3
		}
		if gload > maxPos || gload < -maxNeg {
			pilotOK = false
			warnings = append(warnings, "pilot-g")
		}
		maxLong := c.Pilot.MaxGLongitudinal
		if maxLong <= 0 {
			maxLong = 6
		}
		maxLat := c.Pilot.MaxGLateral
		if maxLat <= 0 {
			maxLat = 4
		}
		if math.Abs(gLong) > maxLong {
			pilotOK = false
			warnings = append(warnings, "pilot-g-long")
		}
		if math.Abs(gLat) > maxLat {
			pilotOK = false
			warnings = append(warnings, "pilot-g-lat")
		}
		if gVert > maxPos || gVert < -maxNeg {
			pilotOK = false
			warnings = append(warnings, "pilot-g-vert")
		}
	}
	return structOK, pilotOK, warnings
}

func liftForce(c Craft, drag DragEval, vRel mathx.Vec3, speed float64) (mathx.Vec3, float64, float64) {
	if !c.Aero.Enabled || drag.Density <= 0 || speed <= 1e-9 || drag.ReferenceArea <= 0 {
		return mathx.Vec3{}, 0, 0
	}
	flow := vRel.Scale(-1.0 / speed)
	forward := c.Orientation.Rotate(mathx.Vec3{X: 1}).Normalize()
	right := c.Orientation.Rotate(mathx.Vec3{Y: 1}).Normalize()
	bodyUp := c.Orientation.Rotate(mathx.Vec3{Z: 1}).Normalize()
	if forward.Norm2() == 0 || right.Norm2() == 0 || bodyUp.Norm2() == 0 {
		return mathx.Vec3{}, 0, 0
	}
	aoa := math.Atan2(flow.Dot(bodyUp), flow.Dot(forward))
	clAlpha := c.Aero.ClAlpha
	if clAlpha == 0 {
		clAlpha = 5.4
	}
	cl := c.Aero.Cl0 + clAlpha*aoa
	clMax := c.Aero.ClMax
	if clMax <= 0 {
		clMax = 1.35
	}
	stallAoA := c.Aero.StallAoA
	if stallAoA <= 0 {
		stallAoA = 0.35
	}
	absAoA := math.Abs(aoa)
	if absAoA > stallAoA {
		excess := math.Min((absAoA-stallAoA)/stallAoA, 1.0)
		cl *= (1 - 0.75*excess)
	}
	cl = mathx.Clamp(cl, -clMax, clMax)
	q := 0.5 * drag.Density * speed * speed
	liftMag := q * drag.ReferenceArea * cl
	spanwise := right
	liftDir := spanwise.Cross(flow).Normalize()
	if liftDir.Norm2() == 0 {
		return mathx.Vec3{}, cl, aoa
	}
	return liftDir.Scale(liftMag), cl, aoa
}

func thrustForce(c Craft) mathx.Vec3 {
	if !c.Propulsion.Enabled || c.Propulsion.MaxThrust == 0 {
		return mathx.Vec3{}
	}
	throttle := mathx.Clamp(c.Propulsion.Throttle, -1, 1)
	forward := c.Orientation.Rotate(mathx.Vec3{X: 1}).Normalize()
	if forward.Norm2() == 0 {
		forward = mathx.Vec3{X: 1}
	}
	return forward.Scale(c.Propulsion.MaxThrust * throttle)
}

func emForce(c Craft, env Environment, velocityWorld mathx.Vec3) mathx.Vec3 {
	if !c.EM.Enabled || c.EM.ChargeC == 0 {
		return mathx.Vec3{}
	}
	lorentz := env.EField.Add(velocityWorld.Cross(env.BField))
	return lorentz.Scale(c.EM.ChargeC)
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
	ionGain := c.Drag.Plasma.IonizationGain
	if ionGain <= 0 {
		ionGain = 0.6
	}
	reduction *= (1 + ionGain*densityFactor*0.1)
	if reduction > maxReduction {
		reduction = maxReduction
	}
	plasmaPower := powerPerArea * area * level * level * math.Max(0.35, densityFactor) * (1 + ionGain*0.25)
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
