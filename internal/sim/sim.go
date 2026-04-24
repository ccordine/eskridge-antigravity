package sim

import (
	"fmt"
	"math"

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

	CouplingC   float64
	CouplingK   float64
	CouplingPhi float64

	PhaseError  float64
	DrivePower  float64
	Energy      float64
	LockQuality float64
	OmegaDrive  float64
	Omega0      float64

	GravPower float64
}

type Result struct {
	FinalCraft   physics.Craft
	FinalBodies  []physics.CelestialBody
	FinalCoupler coupler.State
	Steps        int
}

func Run(cfg config.Scenario, sink func(Sample) error) (Result, error) {
	bodies := cfg.BodiesRuntime()
	craft := cfg.CraftRuntime()
	env := cfg.EnvironmentRuntime()
	couplerState := coupler.New(cfg.CouplerRuntime())
	controller := control.NewHoverController(cfg.ControllerRuntime(), couplerState.Params.Omega0)

	couplerEnabled := cfg.Coupler.Enabled
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
		if couplerEnabled {
			aG = couplerState.EffectiveGravityAccel(gRaw, craft.Orientation)
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
				CouplingC:     couplerState.C,
				CouplingK:     couplerState.K,
				CouplingPhi:   couplerState.Phi,
				PhaseError:    couplerState.PhaseError,
				DrivePower:    couplerState.DrivePower,
				Energy:        couplerState.Energy,
				LockQuality:   couplerState.LockQuality,
				OmegaDrive:    couplerState.OmegaDrive,
				Omega0:        couplerState.Params.Omega0,
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
