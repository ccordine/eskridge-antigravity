package sim

import (
	"fmt"
	"math"
	"strings"

	"github.com/example/acs/internal/config"
	"github.com/example/acs/internal/control"
	"github.com/example/acs/internal/coupler"
	"github.com/example/acs/internal/mathx"
	"github.com/example/acs/internal/physics"
)

type Sample struct {
	Step int
	Time float64

	Position mathx.Vec3
	Velocity mathx.Vec3

	Altitude    float64
	VerticalVel float64

	GRaw          mathx.Vec3
	GRawMag       float64
	EffectiveG    mathx.Vec3
	EffectiveGMag float64
	GravityModel  string

	CouplingC   float64
	CouplingK   float64
	CouplingPhi float64

	PhaseError  float64
	DrivePower  float64
	Energy      float64
	LockQuality float64
	OmegaDrive  float64
	Omega0      float64

	YukawaAlpha             float64
	YukawaLambda            float64
	YukawaRepulsionPrimary  float64
	YukawaKernelPrimary     float64
	NegMassConvention       string
	QGCraft                 float64
	QGPrimary               float64
	InertialMassSign        float64
	RunawayAccelMag         float64
	RunawayAccelLimit       float64
	RunawayAccelFlag        bool
	RunawayExpectedUnderC2  bool

	GravPower float64
}

type Result struct {
	FinalCraft   physics.Craft
	FinalBodies  []physics.CelestialBody
	FinalCoupler coupler.State
	Steps        int
}

func Run(cfg config.Scenario, sink func(Sample) error) (Result, error) {
	if err := cfg.Validate(); err != nil {
		return Result{}, err
	}

	bodies := cfg.BodiesRuntime()
	craft := cfg.CraftRuntime()
	env := cfg.EnvironmentRuntime()
	couplerState := coupler.New(cfg.CouplerRuntime())
	controller := control.NewHoverController(cfg.ControllerRuntime(), couplerState.Params.Omega0)
	gravityModel := resolveGravityModelType(cfg)
	negMassConvention := resolveNegMassConvention(cfg)
	negMassQGCraft := resolveNegMassQGCraft(cfg)
	negMassRunawayLimit := resolveNegMassRunawayLimit(cfg)
	negMassOverrides := resolveNegMassOverrides(cfg)

	couplerEnabled := cfg.Coupler.Enabled && gravityModel == "coupling"
	if !couplerEnabled {
		couplerState.C = 1.0
		couplerState.K = 0.0
		couplerState.LockQuality = 0.0
		couplerState.Energy = 0.0
		couplerState.DrivePower = 0.0
	}

	steps := int(math.Round(cfg.Duration / cfg.Dt))
	if steps < 1 {
		steps = 1
	}

	for step := 0; step < steps; step++ {
		t := float64(step) * cfg.Dt
		primary := bodies[cfg.Environment.PrimaryBodyIdx]

		gRaw := physics.GravityAt(craft.Position, env.G, bodies)

		if couplerEnabled {
			if controller.Enabled() {
				cmd := controller.Update(cfg.Dt, craft, bodies, gRaw, couplerState, cfg.Environment.PrimaryBodyIdx)
				couplerState.SetCommand(cmd)
			}
			couplerState.Update(cfg.Dt)
		}

		aG := gRaw
		yukawaRepulsionPrimary := 0.0
		yukawaKernelPrimary := 1.0
		qgPrimary := 0.0
		inertialSign := 0.0
		runawayAccelMag := 0.0
		runawayFlag := false
		runawayExpectedUnderC2 := false
		sampleNegMassConvention := ""
		sampleQGCraft := 0.0
		sampleRunawayLimit := 0.0

		switch gravityModel {
		case "coupling":
			if couplerEnabled {
				aG = couplerState.EffectiveGravityAccel(gRaw, craft.Orientation)
			}
		case "yukawa":
			var yDiag []physics.YukawaBodyDiagnostic
			aG, yDiag = physics.GravityAtYukawa(craft.Position, env.G, bodies, cfg.GravityModel.Yukawa.Alpha, cfg.GravityModel.Yukawa.Lambda)
			yukawaRepulsionPrimary, yukawaKernelPrimary = findYukawaPrimary(primary.Name, yDiag)
		case "negmass":
			sampleNegMassConvention = negMassConvention
			sampleQGCraft = negMassQGCraft
			sampleRunawayLimit = negMassRunawayLimit
			inertialSign = 1.0
			if negMassConvention == "C2" && negMassQGCraft < 0 {
				inertialSign = -1
			}
			var nDiag []physics.SignedChargeBodyDiagnostic
			aG, nDiag = physics.GravityAtSignedCharge(craft.Position, env.G, bodies, negMassQGCraft, inertialSign, negMassOverrides)
			qgPrimary = findSignedChargePrimary(primary.Name, nDiag)
			runawayAccelMag = aG.Norm()
			runawayFlag = runawayAccelMag >= negMassRunawayLimit
			runawayExpectedUnderC2 = runawayFlag && negMassConvention == "C2"
		default:
			return Result{}, fmt.Errorf("unsupported gravity model type %q", gravityModel)
		}

		fDrag := physics.DragForce(craft, env, primary)
		fNet := aG.Scale(craft.Mass).Add(fDrag)
		craft.IntegrateSemiImplicit(cfg.Dt, fNet, mathx.Vec3{})

		if env.Ground.Enabled {
			bidx := env.Ground.BodyIndex
			if bidx < 0 || bidx >= len(bodies) {
				bidx = cfg.Environment.PrimaryBodyIdx
			}
			physics.ResolveGroundContact(&craft, env, bodies[bidx])
		}

		physics.IntegrateBodiesSemiImplicit(cfg.Dt, env.G, bodies)

		if !craft.Position.IsFinite() || !craft.Velocity.IsFinite() {
			return Result{}, fmt.Errorf("state diverged at step %d", step)
		}

		if step%cfg.LogEvery == 0 {
			r := craft.Position.Sub(primary.Position)
			d := r.Norm()
			up := mathx.Vec3{}
			if d > 0 {
				up = r.Scale(1.0 / d)
			}
			altitude := d - primary.Radius
			vertVel := craft.Velocity.Sub(primary.Velocity).Dot(up)

			s := Sample{
				Step:          step,
				Time:          t,
				Position:      craft.Position,
				Velocity:      craft.Velocity,
				Altitude:      altitude,
				VerticalVel:   vertVel,
				GRaw:          gRaw,
				GRawMag:       gRaw.Norm(),
				EffectiveG:    aG,
				EffectiveGMag: aG.Norm(),
				GravityModel:  gravityModel,
				CouplingC:     couplerState.C,
				CouplingK:     couplerState.K,
				CouplingPhi:   couplerState.Phi,
				PhaseError:    couplerState.PhaseError,
				DrivePower:    couplerState.DrivePower,
				Energy:        couplerState.Energy,
				LockQuality:   couplerState.LockQuality,
				OmegaDrive:    couplerState.OmegaDrive,
				Omega0:        couplerState.Params.Omega0,
				YukawaAlpha:            cfg.GravityModel.Yukawa.Alpha,
				YukawaLambda:           cfg.GravityModel.Yukawa.Lambda,
				YukawaRepulsionPrimary: yukawaRepulsionPrimary,
				YukawaKernelPrimary:    yukawaKernelPrimary,
				NegMassConvention:      sampleNegMassConvention,
				QGCraft:                sampleQGCraft,
				QGPrimary:              qgPrimary,
				InertialMassSign:       inertialSign,
				RunawayAccelMag:        runawayAccelMag,
				RunawayAccelLimit:      sampleRunawayLimit,
				RunawayAccelFlag:       runawayFlag,
				RunawayExpectedUnderC2: runawayExpectedUnderC2,
				GravPower:     craft.Mass * aG.Dot(craft.Velocity),
			}
			if err := sink(s); err != nil {
				return Result{}, err
			}
		}
	}

	return Result{
		FinalCraft:   craft,
		FinalBodies:  bodies,
		FinalCoupler: *couplerState,
		Steps:        steps,
	}, nil
}

func resolveGravityModelType(cfg config.Scenario) string {
	model := strings.ToLower(strings.TrimSpace(cfg.GravityModel.Type))
	if model == "" {
		return "coupling"
	}
	return model
}

func resolveNegMassConvention(cfg config.Scenario) string {
	convention := strings.ToUpper(strings.TrimSpace(cfg.GravityModel.NegMass.Convention))
	if convention != "C1" && convention != "C2" {
		return "C1"
	}
	return convention
}

func resolveNegMassQGCraft(cfg config.Scenario) float64 {
	qg := cfg.GravityModel.NegMass.QGCraft
	if qg == 0 {
		return 1
	}
	return qg
}

func resolveNegMassRunawayLimit(cfg config.Scenario) float64 {
	limit := cfg.GravityModel.NegMass.RunawayAccelLimit
	if limit <= 0 {
		return 1e6
	}
	return limit
}

func resolveNegMassOverrides(cfg config.Scenario) map[string]float64 {
	if len(cfg.GravityModel.NegMass.QGOverrides) == 0 {
		return nil
	}
	out := make(map[string]float64, len(cfg.GravityModel.NegMass.QGOverrides))
	for name, v := range cfg.GravityModel.NegMass.QGOverrides {
		trimmed := strings.TrimSpace(name)
		if trimmed == "" {
			continue
		}
		out[trimmed] = v
		out[strings.ToLower(trimmed)] = v
	}
	return out
}

func findYukawaPrimary(primaryName string, diag []physics.YukawaBodyDiagnostic) (float64, float64) {
	for i := range diag {
		if diag[i].Body == primaryName {
			return diag[i].RepulsionFactor, diag[i].KernelFactor
		}
	}
	if len(diag) > 0 {
		return diag[0].RepulsionFactor, diag[0].KernelFactor
	}
	return 0, 1
}

func findSignedChargePrimary(primaryName string, diag []physics.SignedChargeBodyDiagnostic) float64 {
	for i := range diag {
		if diag[i].Body == primaryName {
			return diag[i].SignedCharge
		}
	}
	if len(diag) > 0 {
		return diag[0].SignedCharge
	}
	return 0
}
