package main

import (
	"math"
	"strings"

	"github.com/example/acs/internal/mathx"
)

func sanitizeOr(v, fallback float64) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return fallback
	}
	return v
}

func (gs *gameSession) applyAssistAutopilotLocked(input gameControlInput, dt float64) {
	if gs == nil {
		return
	}
	gs.assistPhase = "manual"
	gs.navDistance = 0
	gs.navVAlong = 0
	gs.coastCapture = false
	gs.navTopReached = false
	gs.navProfileReached = false
	if !gs.controls.LockAssist || !input.AutoTrim {
		return
	}
	gs.assistPhase = "assist"
	ampLocked := input.HoldAmpLock
	phiLocked := input.HoldPhiLock
	yawLocked := input.HoldYawLock
	pitchLocked := input.HoldPitchLock
	primary := gs.primaryBodyLocked()
	up := gs.craft.Position.Sub(primary.Position).Normalize()
	if up.Norm2() == 0 {
		up = mathx.Vec3{Z: 1}
	}
	eval := gs.evaluateGravityLocked()
	downRaw := -eval.raw.Dot(up)
	downEff := -eval.effective.Dot(up)
	weightRatio := 1.0
	if math.Abs(downRaw) > 1e-9 {
		weightRatio = downEff / downRaw
	}
	altitudeNow := math.Max(0, gs.craft.Position.Sub(primary.Position).Norm()-primary.Radius)
	targetAltitude := math.Max(0, sanitizeOr(input.AutoAltitude, altitudeNow))
	targetWeight := sanitizeOr(input.AutoWeight, 1.0)
	targetVertical := sanitizeOr(input.AutoVertical, 0.0)
	altErr := mathx.Clamp(targetAltitude-altitudeNow, -1e8, 1e8)
	verticalVelLocal := gs.craft.Velocity.Dot(up)
	useAltitudeHold := true
	if useAltitudeHold {
		targetVertical += mathx.Clamp(altErr*0.08, -900, 900)
	}
	if !input.NavProfileActive {
		gs.navProfileWasOn = false
	}
	if input.NavProfileActive && !phiLocked {
		gs.assistPhase = "nav_profile"
		targetVertical += mathx.Clamp(altErr*0.06, -320, 320)
		prevErr := gs.navProfilePrevErr
		if !gs.navProfileWasOn {
			prevErr = altErr
			gs.navProfileWasOn = true
		}
		crossedTarget := (prevErr > 0 && altErr <= 0) || (prevErr < 0 && altErr >= 0)
		if input.NavTopActive {
			gs.navProfileReached = math.Abs(altErr) <= 60 && math.Abs(verticalVelLocal) <= 10
		} else {
			gs.navProfileReached = crossedTarget || math.Abs(altErr) <= 80
		}
		gs.navProfilePrevErr = altErr
	}
	forward, right := tangentBasisFromUp(up)
	angRate := gs.craft.AngularVelocity.Norm()
	stability := mathx.Clamp(1.0-(angRate/2.8), 0.15, 1.0)

	if input.NavTopActive && !yawLocked && !pitchLocked {
		navErrX := input.NavTopGoalX - gs.craft.Position.X
		navErrY := input.NavTopGoalY - gs.craft.Position.Y
		navForwardErr := navErrX
		navRightErr := navErrY
		dist := math.Hypot(navErrX, navErrY)
		if strings.EqualFold(strings.TrimSpace(input.NavTopGoalMode), "planetary") {
			craftRel := gs.craft.Position.Sub(primary.Position)
			goalRel := mathx.Vec3{X: input.NavTopGoalX, Y: input.NavTopGoalY, Z: sanitizeOr(input.NavTopGoalZ, craftRel.Z)}
			cMag := craftRel.Norm()
			gMag := goalRel.Norm()
			if cMag > 1e-6 && gMag > 1e-6 {
				cu := craftRel.Scale(1 / cMag)
				gu := goalRel.Scale(1 / gMag)
				dot := mathx.Clamp(cu.Dot(gu), -1, 1)
				ang := math.Acos(dot)
				t := gu.Sub(cu.Scale(dot))
				tm := t.Norm()
				if tm > 1e-6 {
					arc := ang * math.Max(1, 0.5*(cMag+gMag))
					tDir := t.Scale(1 / tm)
					navForwardErr = tDir.Dot(forward) * arc
					navRightErr = tDir.Dot(right) * arc
					dist = math.Abs(arc)
				}
			}
		} else {
			navForwardErr = navErrX*forward.X + navErrY*forward.Y
			navRightErr = navErrX*right.X + navErrY*right.Y
		}
		desiredYaw := math.Atan2(navRightErr, navForwardErr)
		yawErr := mathx.WrapAngle(desiredYaw - gs.controls.AxisYaw)
		navYawCmd := mathx.Clamp(yawErr/0.85, -1, 1) * stability
		gs.controls.AxisYaw = mathx.WrapAngle(gs.controls.AxisYaw + (navYawCmd*0.46)*gs.limits.YawAxisRate*dt)
		desiredPitch := mathx.Clamp(dist/2800, 0, 0.72)
		pitchErr := desiredPitch - gs.controls.AxisPitch
		navPitchCmd := mathx.Clamp(pitchErr/0.55, -1, 1) * stability
		gs.controls.AxisPitch = mathx.Clamp(gs.controls.AxisPitch+(navPitchCmd*0.52)*gs.limits.PitchAxisRate*dt, gs.limits.MinAxisPitch, gs.limits.MaxAxisPitch)
		lateralDemand := math.Hypot(navYawCmd, math.Max(0, navPitchCmd))
		if !ampLocked {
			gs.controls.AmpTarget = mathx.Clamp(gs.controls.AmpTarget+lateralDemand*0.24*gs.limits.AmpAxisRate*dt, gs.couplerState.Params.MinAmplitude, gs.couplerState.Params.MaxAmplitude)
		}

		vAlong := 0.0
		if dist > 1e-6 {
			alongDir := forward.Scale(navForwardErr).Add(right.Scale(navRightErr))
			if alongDir.Norm2() > 1e-9 {
				u := alongDir.Normalize()
				vAlong = gs.craft.Velocity.Dot(u)
			}
		}
		distCombined := dist
		vAlongCombined := vAlong
		if input.NavProfileActive {
			distCombined = math.Hypot(dist, math.Abs(altErr))
			if distCombined > 1e-6 {
				altToward := verticalVelLocal
				if altErr < 0 {
					altToward = -verticalVelLocal
				}
				vAlongCombined = ((vAlong * dist) + (altToward * math.Abs(altErr))) / distCombined
			}
		}
		gs.navDistance = distCombined
		gs.navVAlong = vAlongCombined
		speedNow := gs.craft.Velocity.Norm()
		vCap := mathx.Clamp(sanitizeOr(input.NavMaxSpeed, sanitizeOr(input.AssistSpeedCap, 320)*1000), 20, 8000)
		stopR := mathx.Clamp(sanitizeOr(input.NavStopRadius, 120), 5, 5000)
		brakeGain := mathx.Clamp(sanitizeOr(input.AssistBrakeGain, 1.0), 0.1, 3.0)
		aBrake := 70 + (180 * brakeGain)
		stopErr := math.Max(0, distCombined-stopR)
		brakeDistance := math.Max(1, (vAlongCombined*vAlongCombined)/(2*aBrake)+stopR)
		brakeNow := distCombined <= brakeDistance || speedNow > vCap
		if brakeNow {
			gs.assistPhase = "nav_brake"
		} else {
			gs.assistPhase = "nav_push"
		}
		speedTarget := math.Min(vCap, math.Sqrt(math.Max(0, 2*aBrake*stopErr)))
		speedErr := mathx.Clamp(speedTarget-vAlongCombined, -5000, 5000)
		gs.controls.ThrottleTarget = mathx.Clamp((speedErr/math.Max(35, vCap*0.30))+(func() float64 {
			if brakeNow {
				return -0.12
			}
			return 0.08
		}()), gs.limits.MinThrottleTarget, gs.limits.MaxThrottleTarget)
		plasmaBase := 0.10
		if speedNow > 0.8*vCap {
			plasmaBase = 0.24
		}
		plasmaBrake := 0.0
		if brakeNow {
			plasmaBrake = 0.45
		}
		gs.controls.PlasmaTarget = mathx.Clamp(plasmaBase+plasmaBrake+(math.Max(0, speedNow-vCap)/math.Max(40, vCap)), gs.limits.MinPlasmaTarget, gs.limits.MaxPlasmaTarget)
		approach := mathx.Clamp(stopErr/math.Max(100, stopR*8), 0, 1)
		gs.controls.EFieldTarget = mathx.Clamp((func() float64 {
			if brakeNow {
				return 2800
			}
			return 1800
		}())+(900*approach), gs.limits.MinEFieldTarget, gs.limits.MaxEFieldTarget)
		gs.controls.BFieldTarget = mathx.Clamp((func() float64 {
			if brakeNow {
				return 0.26
			}
			return 0.16
		}())+(0.08*approach), gs.limits.MinBFieldTarget, gs.limits.MaxBFieldTarget)
		gs.controls.EMChargeTarget = mathx.Clamp((func() float64 {
			if brakeNow {
				return 1300
			}
			return 700
		}())+(900*approach), gs.limits.MinEMChargeTarget, gs.limits.MaxEMChargeTarget)
		gs.controls.QTarget = mathx.Clamp(math.Max(gs.controls.QTarget, 220+(260*approach)), gs.limits.MinQTarget, gs.limits.MaxQTarget)
		gs.controls.BetaTarget = mathx.Clamp(math.Max(gs.controls.BetaTarget, 2.4+(2.4*approach)), gs.limits.MinBetaTarget, gs.limits.MaxBetaTarget)
		circularBand := math.Abs(speedNow-math.Sqrt(math.Max(0, gameBigG*primary.Mass/math.Max(primary.Radius+altitudeNow, 1)))) <= math.Max(30, 0.16*math.Max(1, math.Sqrt(math.Max(0, gameBigG*primary.Mass/math.Max(primary.Radius+altitudeNow, 1)))))
		gs.coastCapture = distCombined <= math.Max(stopR*1.8, 80) && math.Abs(verticalVelLocal) <= 10 && circularBand
		if gs.coastCapture {
			gs.assistPhase = "coast_capture"
		}
		gs.navTopReached = distCombined <= stopR && speedNow <= math.Max(8, 0.06*vCap)
	} else if input.NavTopActive {
		gs.assistPhase = "nav_blocked_locked"
	} else {
		gs.controls.AxisYaw = mathx.WrapAngle(gs.controls.AxisYaw * math.Max(0, 1-(2.2*dt)))
		gs.controls.AxisPitch = mathx.Clamp(gs.controls.AxisPitch*math.Max(0, 1-(2.2*dt)), gs.limits.MinAxisPitch, gs.limits.MaxAxisPitch)
	}
	if angRate > 2.8 && (!yawLocked || !pitchLocked) {
		gs.assistPhase = "gyro_recover"
		gs.controls.ThrottleTarget = mathx.Clamp(gs.controls.ThrottleTarget*0.7, gs.limits.MinThrottleTarget, gs.limits.MaxThrottleTarget)
		if !ampLocked {
			gs.controls.AmpTarget = mathx.Clamp(gs.controls.AmpTarget*0.85, gs.couplerState.Params.MinAmplitude, gs.couplerState.Params.MaxAmplitude)
		}
	}

	verticalErr := mathx.Clamp(targetVertical-verticalVelLocal, -100000, 100000)
	weightErr := mathx.Clamp(targetWeight-weightRatio, -1000, 1000)
	if !phiLocked {
		gs.controls.ThetaTarget = mathx.Clamp(gs.controls.ThetaTarget+((weightErr*0.25)+(verticalErr*0.0020))*gs.limits.PhiAxisRate*dt, gs.limits.MinThetaTarget, gs.limits.MaxThetaTarget)
	}
}
