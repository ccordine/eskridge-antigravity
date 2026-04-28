package coupler

import (
	"math"
	"math/cmplx"

	"github.com/example/acs/internal/mathx"
)

type Command struct {
	Amplitude float64
	// ThetaTarget is a commanded coupling-phase bias (not PLL lock phase target).
	// This lets gameplay/controller steer coupling polarity without forcing PLL detune.
	ThetaTarget float64
	OmegaBase   float64
}

type Params struct {
	Omega0          float64
	Omega0DriftRate float64
	Q               float64
	Beta            float64
	Alpha           float64
	KMax            float64
	PhiBias         float64
	DefaultC        float64

	PllKp float64
	PllKi float64

	LockOmegaWindow float64
	LockCollapse    float64
	LockRecover     float64

	PowerC1    float64
	PowerC2    float64
	PowerLimit float64

	EnergyInitial float64

	MinAmplitude float64
	MaxAmplitude float64
	AmpRate      float64

	ThetaRate float64

	MinOmegaBase  float64
	MaxOmegaBase  float64
	OmegaBaseRate float64

	InitialAmplitude   float64
	InitialThetaTarget float64
	InitialOmegaBase   float64
	InitialDrivePhase  float64
	InitialResonatorX  float64
	InitialResonatorY  float64

	DirectionalEnabled bool
	FieldAxisBody      mathx.Vec3
	ParallelFactor     float64
	PerpFactor         float64
}

type State struct {
	Params Params

	Cmd Command

	ADrive      float64
	ThetaTarget float64
	OmegaBase   float64
	OmegaDrive  float64
	ThetaDrive  float64

	Z complex128

	PhaseError float64
	EInt       float64
	DeltaOmega float64

	LockQuality float64
	K           float64
	Phi         float64
	C           float64

	DrivePower float64
	Energy     float64
}

func New(params Params) *State {
	if params.DefaultC == 0 {
		params.DefaultC = 1
	}
	if params.KMax == 0 {
		params.KMax = 2
	}
	if params.MaxAmplitude == 0 {
		params.MaxAmplitude = 5
	}
	if params.LockOmegaWindow == 0 {
		params.LockOmegaWindow = params.Omega0 * 0.05
	}
	if params.LockCollapse == 0 {
		params.LockCollapse = 1.0
	}
	if params.LockRecover == 0 {
		params.LockRecover = 2.0
	}
	if params.MaxOmegaBase == 0 {
		params.MaxOmegaBase = params.Omega0 * 2
	}
	if params.InitialOmegaBase == 0 {
		params.InitialOmegaBase = params.Omega0
	}
	if params.PerpFactor == 0 {
		params.PerpFactor = 1.0
	}
	if params.ParallelFactor == 0 {
		params.ParallelFactor = 1.0
	}

	s := &State{
		Params: params,
		Cmd: Command{
			Amplitude:   params.InitialAmplitude,
			ThetaTarget: mathx.WrapAngle(params.InitialThetaTarget),
			OmegaBase:   params.InitialOmegaBase,
		},
		ADrive:      params.InitialAmplitude,
		ThetaTarget: mathx.WrapAngle(params.InitialThetaTarget),
		OmegaBase:   params.InitialOmegaBase,
		OmegaDrive:  params.InitialOmegaBase,
		ThetaDrive:  mathx.WrapPositive(params.InitialDrivePhase),
		Z:           complex(params.InitialResonatorX, params.InitialResonatorY),
		LockQuality: 1.0,
		C:           params.DefaultC,
		Energy:      params.EnergyInitial,
	}
	s.recomputeDerived()
	return s
}

func (s *State) SetCommand(cmd Command) {
	s.Cmd = cmd
}

func (s *State) Update(dt float64) {
	if dt <= 0 {
		return
	}

	s.Params.Omega0 += s.Params.Omega0DriftRate * dt
	if math.IsNaN(s.Params.Omega0) || math.IsInf(s.Params.Omega0, 0) {
		s.Params.Omega0 = 0
	}
	if math.IsNaN(s.Params.Q) || math.IsInf(s.Params.Q, 0) || s.Params.Q <= 1e-9 {
		s.Params.Q = 1e-9
	}
	if math.IsNaN(s.Params.Beta) || math.IsInf(s.Params.Beta, 0) {
		s.Params.Beta = 0
	}

	s.ADrive = mathx.MoveToward(s.ADrive, cmdOrDefault(s.Cmd.Amplitude, s.ADrive), s.Params.AmpRate*dt)
	s.ADrive = mathx.Clamp(s.ADrive, s.Params.MinAmplitude, s.Params.MaxAmplitude)
	s.ThetaTarget = mathx.MoveTowardAngle(s.ThetaTarget, s.Cmd.ThetaTarget, s.Params.ThetaRate*dt)
	s.OmegaBase = mathx.MoveToward(s.OmegaBase, cmdOrDefault(s.Cmd.OmegaBase, s.OmegaBase), s.Params.OmegaBaseRate*dt)
	s.OmegaBase = mathx.Clamp(s.OmegaBase, s.Params.MinOmegaBase, s.Params.MaxOmegaBase)

	if s.Energy <= 0 {
		s.ADrive = 0
	}

	s.ThetaDrive = mathx.WrapPositive(s.ThetaDrive + s.OmegaDrive*dt)
	drive := complex(s.ADrive*math.Cos(s.ThetaDrive), s.ADrive*math.Sin(s.ThetaDrive))

	gamma := 0.0
	if s.Params.Q > 0 {
		gamma = s.Params.Omega0 / (2.0 * s.Params.Q)
	}
	lambda := complex(-gamma, s.Params.Omega0)
	expStep := cmplx.Exp(lambda * complex(dt, 0))
	driveGain := complex(dt, 0)
	if cmplx.Abs(lambda) > 0 {
		driveGain = (expStep - 1) / lambda
	}
	s.Z = expStep*s.Z + complex(s.Params.Beta, 0)*drive*driveGain
	if math.IsNaN(real(s.Z)) || math.IsInf(real(s.Z), 0) || math.IsNaN(imag(s.Z)) || math.IsInf(imag(s.Z), 0) {
		s.Z = 0
		s.LockQuality = 0
		s.EInt = 0
	}

	thetaR := cmplx.Phase(s.Z)
	// PLL lock tracks resonator-drive phase coherence only.
	// Coupling phase steering is handled separately via ThetaTarget in recomputeDerived.
	s.PhaseError = mathx.WrapAngle(thetaR - s.ThetaDrive)
	s.EInt += s.PhaseError * dt
	s.EInt = mathx.Clamp(s.EInt, -100, 100)
	rawDelta := s.Params.PllKp*s.PhaseError + s.Params.PllKi*s.EInt
	maxDelta := s.Params.LockOmegaWindow
	if maxDelta > 0 {
		s.DeltaOmega = mathx.Clamp(rawDelta, -maxDelta, maxDelta)
	} else {
		s.DeltaOmega = rawDelta
	}
	s.OmegaDrive = mathx.Clamp(s.OmegaBase+s.DeltaOmega, s.Params.MinOmegaBase, s.Params.MaxOmegaBase)

	s.updateLockQuality(dt)
	s.recomputeDerived()

	s.DrivePower = s.Params.PowerC1*s.ADrive*s.ADrive + s.Params.PowerC2*cmplx.Abs(s.Z)*cmplx.Abs(s.Z)
	if math.IsNaN(s.DrivePower) || math.IsInf(s.DrivePower, 0) || s.DrivePower < 0 {
		s.DrivePower = 0
	}
	if s.Params.PowerLimit > 0 && s.DrivePower > s.Params.PowerLimit {
		s.DrivePower = s.Params.PowerLimit
	}
	if s.Energy > 0 {
		s.Energy -= s.DrivePower * dt
		if s.Energy < 0 {
			s.Energy = 0
		}
	}
	if s.Energy <= 0 {
		s.LockQuality = math.Max(0, s.LockQuality-s.Params.LockCollapse*dt)
		s.C = s.Params.DefaultC
	}
}

func (s *State) EffectiveGravityAccel(g mathx.Vec3, orientation mathx.Quat) mathx.Vec3 {
	if !s.Params.DirectionalEnabled {
		return g.Scale(s.C)
	}
	u := s.Params.FieldAxisBody
	if u.Norm2() == 0 {
		u = mathx.Vec3{Z: 1}
	}
	uWorld := orientation.Rotate(u.Normalize())
	proj := uWorld.Scale(g.Dot(uWorld))
	perp := g.Sub(proj)
	cPar := s.C * s.Params.ParallelFactor
	cPerp := s.C * s.Params.PerpFactor
	return proj.Scale(cPar).Add(perp.Scale(cPerp))
}

func (s *State) updateLockQuality(dt float64) {
	if s.Params.LockOmegaWindow <= 0 {
		s.LockQuality = 1
		return
	}
	freqErr := math.Abs(s.OmegaDrive - s.Params.Omega0)
	freqNorm := freqErr / (2.0 * s.Params.LockOmegaWindow)
	target := math.Exp(-freqNorm * freqNorm)
	if target > s.LockQuality {
		s.LockQuality = math.Min(target, s.LockQuality+s.Params.LockRecover*dt)
	} else {
		s.LockQuality = math.Max(target, s.LockQuality-s.Params.LockCollapse*dt)
	}
}

func (s *State) recomputeDerived() {
	mag := cmplx.Abs(s.Z)
	s.K = mathx.Clamp(s.Params.Alpha*mag, 0, s.Params.KMax)
	s.Phi = mathx.WrapAngle(cmplx.Phase(s.Z) - s.ThetaDrive + s.Params.PhiBias + s.ThetaTarget)
	cActive := ActiveCoupling(s.K, s.Phi)
	s.C = s.Params.DefaultC + s.LockQuality*(cActive-s.Params.DefaultC)
}

func ActiveCoupling(k, phi float64) float64 {
	return k * math.Cos(phi)
}

func cmdOrDefault(v float64, fallback float64) float64 {
	if !math.IsNaN(v) {
		return v
	}
	return fallback
}
