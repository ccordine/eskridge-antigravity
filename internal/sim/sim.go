package sim

import (
	"fmt"
	"math"

	"github.com/example/acs/internal/config"
	"github.com/example/acs/internal/coupler"
	"github.com/example/acs/internal/drive"
	"github.com/example/acs/internal/gr"
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

	MetricModel string
	ShipType    string

	CouplingC   float64
	CouplingK   float64
	CouplingPhi float64

	PhaseError  float64
	DrivePower  float64
	Energy      float64
	LockQuality float64
	OmegaDrive  float64
	Omega0      float64

	MetricG00                        float64
	MetricDet                        float64
	MetricSignatureValid             bool
	ChristoffelNorm                  float64
	InvariantError                   float64
	CoordinateTime                   float64
	ProperTime                       float64
	Beta                             mathx.Vec3
	LapseAlpha                       float64
	DriveAuthority                   float64
	DrivePhaseRad                    float64
	DriveFrequencyHz                 float64
	DriveOmegaRadS                   float64
	DriveCoherence                   float64
	DriveLockQuality                 float64
	ModeCount                        int
	BubbleRadius                     float64
	WallThickness                    float64
	EinsteinTensorNorm               float64
	StressEnergyDensity              float64
	InstantStressEnergyDensity       float64
	CycleAvgStressEnergyDensity      float64
	CockpitCurvatureNorm             float64
	BubbleWallCurvatureNorm          float64
	CockpitTidalStress               float64
	BubbleWallTidalStress            float64
	PhaseCancellationScore           float64
	PhaseConfinementScore            float64
	NegativeEnergyFlag               bool
	NECViolationFlag                 bool
	NegativeEnergyInstant            bool
	NegativeEnergyCycleAvg           bool
	NECViolationInstant              bool
	NECViolationCycleAvg             bool
	CurvatureScalar                  float64
	GeodesicAccelDiagnostic          mathx.Vec3
	MetricDerivativeStepM            float64
	CraftRestEnergyJ                 float64
	CraftCoordinateEnergyJ           float64
	CraftKineticEnergyJ              float64
	CraftEnergyDeltaJ                float64
	ConservedEnergyJ                 float64
	ConservedEnergyErrorJ            float64
	DriveEnergyAvailableJ            float64
	DriveEnergySpentJ                float64
	DrivePowerW                      float64
	DrivePowerRequestedW             float64
	DrivePowerActualW                float64
	RequestedDriveAuthority          float64
	ActualDriveAuthority             float64
	EstimatedMetricEnergyJ           float64
	EstimatedFieldEnergyDeltaJ       float64
	EstimatedPositiveEnergyJ         float64
	EstimatedNegativeEnergyJ         float64
	EstimatedStressEnergyCostJ       float64
	PositiveEnergyJ                  float64
	NegativeEnergyJ                  float64
	NetStressEnergyJ                 float64
	AbsoluteStressEnergyJ            float64
	UnfundedEnergyDebtJ              float64
	ConservationErrorJ               float64
	ConservationErrorRatio           float64
	StressEnergyConservationResidual float64
	StressEnergyConservationValid    bool
	PowerClamped                     bool
	MetricUnfunded                   bool
	MetricValid                      bool
	PowerSourceType                  string
	ResonatorSubstrateType           string
	ExoticStressSourceType           string
	SourceAvailableEnergyJ           float64
	SourceMaxPowerW                  float64
	UsablePowerW                     float64
	ConversionEfficiency             float64
	WasteHeatW                       float64
	RadiationLossW                   float64
	SourceMassKG                     float64
	DepletionRate                    float64
	StabilityRisk                    float64
	PhysicalPlausibilityRating       float64
	ResonatorCoherenceMultiplier     float64
	ResonatorPhaseStability          float64
	ResonatorCouplingEfficiency      float64
	ResonatorMaxSafeAuthority        float64
	MoscoviumMetastable              bool
	MoscoviumStabilizationRequired   bool
	ExoticNegativeEnergyCapacityJ    float64
	ExoticStressShapingAuthority     float64
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
	couplerState := coupler.New(cfg.CouplerRuntime())
	couplerState.C = 1.0
	couplerState.K = 0.0

	steps := int(math.Round(cfg.Duration / cfg.Dt))
	if steps < 1 {
		steps = 1
	}
	provider, fieldReader, err := metricProvider(cfg, bodies, craft.Position)
	if err != nil {
		return Result{}, err
	}
	sourceStack := sourceStackFromConfig(cfg)
	sourceBudget, sourceDiag := sourceStack.EffectiveBudget(drive.PowerBudget{
		Enabled:              cfg.MetricModel.DrivePower.Enabled,
		EnergyAvailableJ:     cfg.MetricModel.DrivePower.EnergyAvailableJ,
		MaxPowerW:            cfg.MetricModel.DrivePower.MaxPowerW,
		Efficiency:           cfg.MetricModel.DrivePower.Efficiency,
		AllowUnfundedMetrics: cfg.MetricModel.DrivePower.AllowUnfundedMetrics,
		UnfundedBehavior:     cfg.MetricModel.DrivePower.UnfundedBehavior,
	})
	if sourceBudget.EnergyAvailableJ > 0 {
		cfg.MetricModel.DrivePower.EnergyAvailableJ = sourceBudget.EnergyAvailableJ
	}
	if sourceBudget.MaxPowerW > 0 {
		cfg.MetricModel.DrivePower.MaxPowerW = sourceBudget.MaxPowerW
	}
	cfg.MetricModel.DrivePower.Efficiency = sourceBudget.Efficiency
	x := gr.Vec4{0, craft.Position.X, craft.Position.Y, craft.Position.Z}
	u, err := gr.FourVelocityFromCoordinateVelocity(provider, x, [3]float64{craft.Velocity.X, craft.Velocity.Y, craft.Velocity.Z})
	if err != nil {
		return Result{}, err
	}
	wl := gr.Worldline{X: x, U: u}
	ledger, err := newEnergyLedger(cfg, craft.Mass, provider, wl)
	if err != nil {
		return Result{}, err
	}
	ledger.applySourceDiagnostics(sourceDiag)
	properTime := 0.0
	primary := bodies[cfg.MetricModel.Environment.PrimaryBodyIndex]
	prevVel := craft.Velocity

	for step := 0; step < steps; step++ {
		t := float64(step) * cfg.Dt
		if cfg.Coupler.Enabled {
			couplerState.Update(cfg.Dt)
		}
		if updater, ok := provider.(*movingEngineeredProvider); ok {
			updater.center = craft.Position
			requestedAuthority := math.Min(cfg.MetricModel.Drive.Authority, sourceDiag.ResonatorMaxSafeAuthority)
			updater.drive.Params.Authority = requestedAuthority
			updater.drive.Params.Phase = cfg.MetricModel.Drive.Phase
			updater.drive.Params.Coherence = math.Min(1, cfg.MetricModel.Drive.Coherence*sourceDiag.ResonatorCoherenceMultiplier*sourceDiag.ResonatorPhaseStability)
			if cfg.Coupler.Enabled {
				updater.drive.Resonator = drive.Resonator{State: couplerState}
			} else {
				updater.drive.Resonator = drive.Resonator{}
			}
			ledger.RequestedDriveAuthority = cfg.MetricModel.Drive.Authority
			if cfg.MetricModel.DrivePower.Enabled && cfg.MetricModel.Drive.Enabled {
				estimate, err := estimateStressEnergyDomain(provider, wl, craft.Position, cfg)
				if err != nil {
					return Result{}, err
				}
				power := drive.ApplyPowerBudget(drive.PowerBudget{
					Enabled:              true,
					EnergyAvailableJ:     ledger.DriveEnergyAvailableJ,
					MaxPowerW:            cfg.MetricModel.DrivePower.MaxPowerW,
					Efficiency:           cfg.MetricModel.DrivePower.Efficiency,
					AllowUnfundedMetrics: cfg.MetricModel.DrivePower.AllowUnfundedMetrics,
					UnfundedBehavior:     cfg.MetricModel.DrivePower.UnfundedBehavior,
				}, requestedAuthority, estimate.AbsoluteEnergyJ+sourceDiag.WasteHeatW*cfg.Dt+sourceDiag.RadiationLossW*cfg.Dt, cfg.Dt)
				if power.MetricUnfunded && cfg.MetricModel.DrivePower.UnfundedBehavior == "fail" && !cfg.MetricModel.DrivePower.AllowUnfundedMetrics {
					return Result{}, fmt.Errorf("engineered metric unfunded: requested %.6g W exceeds available power", power.RequestedPowerW)
				}
				updater.drive.Params.Authority = power.ActualAuthority
				ledger.applyPower(power)
				if power.PowerClamped {
					estimate, err = estimateStressEnergyDomain(provider, wl, craft.Position, cfg)
					if err != nil {
						return Result{}, err
					}
				}
				ledger.updateFieldEstimate(estimate)
			}
		}
		stepDiag := gr.StepDiagnostics{}
		wl, stepDiag, err = gr.AdvanceCoordinateTime(provider, wl, cfg.Dt, gr.IntegratorConfig{
			ProperTimeSubstepS: cfg.MetricModel.Numerics.ProperTimeSubstepS,
			MaxSubstepsPerTick: cfg.MetricModel.Numerics.MaxSubstepsPerTick,
		})
		if err != nil {
			return Result{}, fmt.Errorf("geodesic step %d failed: %w", step, err)
		}
		properTime += stepDiag.ProperTimeAdvancedS
		craft.Position = mathx.Vec3{X: wl.X[1], Y: wl.X[2], Z: wl.X[3]}
		cv := gr.CoordinateVelocity(wl.U)
		craft.Velocity = mathx.Vec3{X: cv[0], Y: cv[1], Z: cv[2]}
		if err := ledger.updateCraft(craft.Mass, provider, wl); err != nil {
			return Result{}, err
		}

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
			metric, err := provider.MetricAt(gr.Event{X: wl.X})
			if err != nil {
				return Result{}, err
			}
			field := fieldReader(gr.Event{X: wl.X})
			field.LapseAlpha = lapseFromMetric(metric, field.Beta)
			curv := gr.CurvatureDiagnostics{
				MetricDeterminant: gr.Determinant(metric),
				SignatureValid:    gr.LorentzianSignatureValid(metric),
			}
			if cfg.MetricModel.Drive.StressEnergyDiagnostics || step == 0 {
				curv, err = gr.Curvature(provider, gr.Event{X: wl.X}, wl.U, cfg.MetricModel.Numerics.MetricDerivativeStepM)
				if err != nil {
					return Result{}, err
				}
			}
			phaseDiag, err := phaseDiagnostics(cfg, provider, wl, craft.Position, field)
			if err != nil {
				return Result{}, err
			}
			cons, err := gr.StressEnergyConservation(provider, gr.Event{X: wl.X}, cfg.MetricModel.Numerics.MetricDerivativeStepM)
			if err != nil {
				cons.Valid = false
			}
			ledger.StressEnergyConservationResidual = cons.Residual
			ledger.StressEnergyConservationValid = cons.Valid
			geoAccel := mathx.Vec3{X: stepDiag.CoordinateAccel[0], Y: stepDiag.CoordinateAccel[1], Z: stepDiag.CoordinateAccel[2]}
			if step == 0 && cfg.Dt > 0 {
				geoAccel = craft.Velocity.Sub(prevVel).Scale(1 / cfg.Dt)
			}
			prevVel = craft.Velocity

			s := Sample{
				Step:                             step,
				Time:                             t,
				Position:                         craft.Position,
				Velocity:                         craft.Velocity,
				Altitude:                         altitude,
				VerticalVel:                      vertVel,
				MetricModel:                      cfg.MetricModel.Type,
				ShipType:                         craft.ShipType,
				CouplingC:                        0,
				CouplingK:                        couplerState.K,
				CouplingPhi:                      couplerState.Phi,
				PhaseError:                       couplerState.PhaseError,
				DrivePower:                       couplerState.DrivePower,
				Energy:                           couplerState.Energy,
				LockQuality:                      couplerState.LockQuality,
				OmegaDrive:                       couplerState.OmegaDrive,
				Omega0:                           couplerState.Params.Omega0,
				MetricG00:                        metric[0][0],
				MetricDet:                        curv.MetricDeterminant,
				MetricSignatureValid:             curv.SignatureValid,
				ChristoffelNorm:                  stepDiag.ChristoffelNorm,
				InvariantError:                   stepDiag.InvariantError,
				CoordinateTime:                   wl.X[0] / gr.C,
				ProperTime:                       properTime,
				Beta:                             field.Beta,
				LapseAlpha:                       field.LapseAlpha,
				DriveAuthority:                   field.Authority,
				DrivePhaseRad:                    field.PhaseRad,
				DriveFrequencyHz:                 field.OmegaRadPerSec / (2 * math.Pi),
				DriveOmegaRadS:                   field.OmegaRadPerSec,
				DriveCoherence:                   field.Coherence,
				DriveLockQuality:                 field.LockQuality,
				ModeCount:                        field.ModeCount,
				BubbleRadius:                     field.BubbleRadius,
				WallThickness:                    field.WallThickness,
				EinsteinTensorNorm:               curv.EinsteinTensorNorm,
				StressEnergyDensity:              curv.StressEnergyDensity,
				InstantStressEnergyDensity:       curv.StressEnergyDensity,
				CycleAvgStressEnergyDensity:      phaseDiag.CycleAvgStressEnergyDensity,
				CockpitCurvatureNorm:             phaseDiag.CockpitCurvatureNorm,
				BubbleWallCurvatureNorm:          phaseDiag.BubbleWallCurvatureNorm,
				CockpitTidalStress:               phaseDiag.CockpitTidalStress,
				BubbleWallTidalStress:            phaseDiag.BubbleWallTidalStress,
				PhaseCancellationScore:           phaseDiag.PhaseCancellationScore,
				PhaseConfinementScore:            phaseDiag.PhaseConfinementScore,
				NegativeEnergyFlag:               curv.NegativeEnergyFlag,
				NECViolationFlag:                 curv.NECViolationFlag,
				NegativeEnergyInstant:            curv.NegativeEnergyFlag,
				NegativeEnergyCycleAvg:           phaseDiag.NegativeEnergyCycleAvg,
				NECViolationInstant:              curv.NECViolationFlag,
				NECViolationCycleAvg:             phaseDiag.NECViolationCycleAvg,
				CurvatureScalar:                  curv.RicciScalar,
				GeodesicAccelDiagnostic:          geoAccel,
				MetricDerivativeStepM:            cfg.MetricModel.Numerics.MetricDerivativeStepM,
				CraftRestEnergyJ:                 ledger.CraftRestEnergyJ,
				CraftCoordinateEnergyJ:           ledger.CraftCoordinateEnergyJ,
				CraftKineticEnergyJ:              ledger.CraftKineticEnergyJ,
				CraftEnergyDeltaJ:                ledger.CraftEnergyDeltaJ,
				ConservedEnergyJ:                 ledger.ConservedEnergyJ,
				ConservedEnergyErrorJ:            ledger.ConservedEnergyErrorJ,
				DriveEnergyAvailableJ:            ledger.DriveEnergyAvailableJ,
				DriveEnergySpentJ:                ledger.DriveEnergySpentJ,
				DrivePowerW:                      ledger.DrivePowerW,
				DrivePowerRequestedW:             ledger.DrivePowerRequestedW,
				DrivePowerActualW:                ledger.DrivePowerActualW,
				RequestedDriveAuthority:          ledger.RequestedDriveAuthority,
				ActualDriveAuthority:             ledger.ActualDriveAuthority,
				EstimatedMetricEnergyJ:           ledger.EstimatedMetricEnergyJ,
				EstimatedFieldEnergyDeltaJ:       ledger.EstimatedFieldEnergyDeltaJ,
				EstimatedPositiveEnergyJ:         ledger.EstimatedPositiveEnergyJ,
				EstimatedNegativeEnergyJ:         ledger.EstimatedNegativeEnergyJ,
				EstimatedStressEnergyCostJ:       ledger.EstimatedStressEnergyCostJ,
				PositiveEnergyJ:                  ledger.PositiveEnergyJ,
				NegativeEnergyJ:                  ledger.NegativeEnergyJ,
				NetStressEnergyJ:                 ledger.NetStressEnergyJ,
				AbsoluteStressEnergyJ:            ledger.AbsoluteStressEnergyJ,
				UnfundedEnergyDebtJ:              ledger.UnfundedEnergyDebtJ,
				ConservationErrorJ:               ledger.ConservationErrorJ,
				ConservationErrorRatio:           ledger.ConservationErrorRatio,
				StressEnergyConservationResidual: ledger.StressEnergyConservationResidual,
				StressEnergyConservationValid:    ledger.StressEnergyConservationValid,
				PowerClamped:                     ledger.PowerClamped,
				MetricUnfunded:                   ledger.MetricUnfunded,
				MetricValid:                      ledger.MetricValid,
				PowerSourceType:                  ledger.PowerSourceType,
				ResonatorSubstrateType:           ledger.ResonatorSubstrateType,
				ExoticStressSourceType:           ledger.ExoticStressSourceType,
				SourceAvailableEnergyJ:           ledger.SourceAvailableEnergyJ,
				SourceMaxPowerW:                  ledger.SourceMaxPowerW,
				UsablePowerW:                     ledger.UsablePowerW,
				ConversionEfficiency:             ledger.ConversionEfficiency,
				WasteHeatW:                       ledger.WasteHeatW,
				RadiationLossW:                   ledger.RadiationLossW,
				SourceMassKG:                     ledger.SourceMassKG,
				DepletionRate:                    ledger.DepletionRate,
				StabilityRisk:                    ledger.StabilityRisk,
				PhysicalPlausibilityRating:       ledger.PhysicalPlausibilityRating,
				ResonatorCoherenceMultiplier:     ledger.ResonatorCoherenceMultiplier,
				ResonatorPhaseStability:          ledger.ResonatorPhaseStability,
				ResonatorCouplingEfficiency:      ledger.ResonatorCouplingEfficiency,
				ResonatorMaxSafeAuthority:        ledger.ResonatorMaxSafeAuthority,
				MoscoviumMetastable:              ledger.MoscoviumMetastable,
				MoscoviumStabilizationRequired:   ledger.MoscoviumStabilizationRequired,
				ExoticNegativeEnergyCapacityJ:    ledger.ExoticNegativeEnergyCapacityJ,
				ExoticStressShapingAuthority:     ledger.ExoticStressShapingAuthority,
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

func lapseFromMetric(metric gr.Metric, beta mathx.Vec3) float64 {
	b := [3]float64{beta.X, beta.Y, beta.Z}
	gammaBetaBeta := 0.0
	for i := 0; i < 3; i++ {
		for j := 0; j < 3; j++ {
			gammaBetaBeta += metric[i+1][j+1] * b[i] * b[j]
		}
	}
	v := gammaBetaBeta - metric[0][0]
	if v <= 0 || math.IsNaN(v) || math.IsInf(v, 0) {
		return 0
	}
	return math.Sqrt(v)
}

type phaseDiagnosticValues struct {
	CycleAvgStressEnergyDensity float64
	NegativeEnergyCycleAvg      bool
	NECViolationCycleAvg        bool
	CockpitCurvatureNorm        float64
	BubbleWallCurvatureNorm     float64
	CockpitTidalStress          float64
	BubbleWallTidalStress       float64
	PhaseCancellationScore      float64
	PhaseConfinementScore       float64
}

func phaseDiagnostics(cfg config.Scenario, provider gr.DerivativeMetricProvider, wl gr.Worldline, center mathx.Vec3, field drive.FieldParameters) (phaseDiagnosticValues, error) {
	if !cfg.MetricModel.PhaseDiagnostics.Enabled || cfg.MetricModel.Type != "engineered_metric" {
		return phaseDiagnosticValues{}, nil
	}
	step := cfg.MetricModel.Numerics.MetricDerivativeStepM
	regions := cfg.MetricModel.Regions
	cockpit, err := regionAverage(provider, wl, center, 0, regions.CockpitRadiusM, regions.SamplePointsPerRegion, step)
	if err != nil {
		return phaseDiagnosticValues{}, err
	}
	wallInner := math.Max(0, regions.BubbleRadiusM-regions.WallThicknessM)
	wallOuter := regions.BubbleRadiusM + regions.WallThicknessM
	wall, err := regionAverage(provider, wl, center, wallInner, wallOuter, regions.SamplePointsPerRegion, step)
	if err != nil {
		return phaseDiagnosticValues{}, err
	}
	out := phaseDiagnosticValues{
		CockpitCurvatureNorm:    cockpit.MaxCurvatureMagnitude,
		BubbleWallCurvatureNorm: wall.MaxCurvatureMagnitude,
		CockpitTidalStress:      tidalProxy(cockpit),
		BubbleWallTidalStress:   tidalProxy(wall),
		PhaseCancellationScore:  1 / (1 + cockpit.MaxCurvatureMagnitude + math.Abs(cockpit.StressEnergyDensity)/(1e30)),
		PhaseConfinementScore:   wall.MaxCurvatureMagnitude / (cockpit.MaxCurvatureMagnitude + wall.MaxCurvatureMagnitude + 1e-30),
	}
	if cfg.MetricModel.PhaseDiagnostics.CycleAverage && field.OmegaRadPerSec > 0 {
		avg, neg, nec, err := cycleAverageStress(provider, wl, step, cfg.MetricModel.PhaseDiagnostics.SamplesPerCycle)
		if err != nil {
			return phaseDiagnosticValues{}, err
		}
		out.CycleAvgStressEnergyDensity = avg
		out.NegativeEnergyCycleAvg = neg
		out.NECViolationCycleAvg = nec
	} else {
		instant, err := gr.Curvature(provider, gr.Event{X: wl.X}, wl.U, step)
		if err != nil {
			return phaseDiagnosticValues{}, err
		}
		out.CycleAvgStressEnergyDensity = instant.StressEnergyDensity
		out.NegativeEnergyCycleAvg = instant.NegativeEnergyFlag
		out.NECViolationCycleAvg = instant.NECViolationFlag
	}
	if cfg.MetricModel.PhaseDiagnostics.PhaseSweep {
		best, conf, err := phaseSweep(provider, wl, center, regions, step, cfg.MetricModel.PhaseDiagnostics.PhaseSweepSteps)
		if err != nil {
			return phaseDiagnosticValues{}, err
		}
		out.PhaseCancellationScore = best
		out.PhaseConfinementScore = conf
	}
	return out, nil
}

func regionAverage(provider gr.DerivativeMetricProvider, wl gr.Worldline, center mathx.Vec3, rMin, rMax float64, samples int, step float64) (gr.CurvatureDiagnostics, error) {
	if samples <= 0 {
		samples = 1
	}
	if samples > 64 {
		samples = 64
	}
	dirs := []mathx.Vec3{
		{X: 1}, {X: -1}, {Y: 1}, {Y: -1}, {Z: 1}, {Z: -1},
	}
	var out gr.CurvatureDiagnostics
	for i := 0; i < samples; i++ {
		dir := dirs[i%len(dirs)]
		f := 0.5
		if samples > 1 {
			f = float64(i) / float64(samples-1)
		}
		r := rMin + (rMax-rMin)*f
		e := gr.Event{X: gr.Vec4{wl.X[0], center.X + dir.X*r, center.Y + dir.Y*r, center.Z + dir.Z*r}}
		curv, err := gr.Curvature(provider, e, wl.U, step)
		if err != nil {
			return gr.CurvatureDiagnostics{}, err
		}
		out.MaxCurvatureMagnitude += curv.MaxCurvatureMagnitude
		out.EinsteinTensorNorm += curv.EinsteinTensorNorm
		out.StressEnergyDensity += curv.StressEnergyDensity
		out.RicciScalar += curv.RicciScalar
		out.NegativeEnergyFlag = out.NegativeEnergyFlag || curv.NegativeEnergyFlag
		out.NECViolationFlag = out.NECViolationFlag || curv.NECViolationFlag
	}
	scale := 1 / float64(samples)
	out.MaxCurvatureMagnitude *= scale
	out.EinsteinTensorNorm *= scale
	out.StressEnergyDensity *= scale
	out.RicciScalar *= scale
	return out, nil
}

func tidalProxy(c gr.CurvatureDiagnostics) float64 {
	return math.Abs(c.RicciScalar) + c.EinsteinTensorNorm
}

func cycleAverageStress(provider gr.DerivativeMetricProvider, wl gr.Worldline, step float64, samples int) (float64, bool, bool, error) {
	mp, ok := provider.(*movingEngineeredProvider)
	if !ok || mp.drive.Params.OmegaRadPerSec <= 0 {
		curv, err := gr.Curvature(provider, gr.Event{X: wl.X}, wl.U, step)
		if err != nil {
			return 0, false, false, err
		}
		return curv.StressEnergyDensity, curv.NegativeEnergyFlag, curv.NECViolationFlag, nil
	}
	if samples < 4 {
		samples = 4
	}
	sum := 0.0
	neg := false
	nec := false
	periodX0 := gr.C * 2 * math.Pi / mp.drive.Params.OmegaRadPerSec
	for i := 0; i < samples; i++ {
		e := gr.Event{X: wl.X}
		e.X[0] += periodX0 * float64(i) / float64(samples)
		curv, err := gr.Curvature(provider, e, wl.U, step)
		if err != nil {
			return 0, false, false, err
		}
		sum += curv.StressEnergyDensity
		neg = neg || curv.NegativeEnergyFlag
		nec = nec || curv.NECViolationFlag
	}
	return sum / float64(samples), neg, nec, nil
}

func phaseSweep(provider gr.DerivativeMetricProvider, wl gr.Worldline, center mathx.Vec3, regions config.MetricRegionsConfig, step float64, steps int) (float64, float64, error) {
	mp, ok := provider.(*movingEngineeredProvider)
	if !ok {
		return 0, 0, nil
	}
	if steps < 4 {
		steps = 4
	}
	original := mp.drive.Params.Phase
	defer func() { mp.drive.Params.Phase = original }()
	bestCancel := -1.0
	bestConfine := 0.0
	for i := 0; i < steps; i++ {
		mp.drive.Params.Phase = 2 * math.Pi * float64(i) / float64(steps)
		cockpit, err := regionAverage(provider, wl, center, 0, regions.CockpitRadiusM, regions.SamplePointsPerRegion, step)
		if err != nil {
			return 0, 0, err
		}
		wall, err := regionAverage(provider, wl, center, math.Max(0, regions.BubbleRadiusM-regions.WallThicknessM), regions.BubbleRadiusM+regions.WallThicknessM, regions.SamplePointsPerRegion, step)
		if err != nil {
			return 0, 0, err
		}
		cancel := 1 / (1 + cockpit.MaxCurvatureMagnitude + math.Abs(cockpit.StressEnergyDensity)/(1e30))
		confine := wall.MaxCurvatureMagnitude / (cockpit.MaxCurvatureMagnitude + wall.MaxCurvatureMagnitude + 1e-30)
		if cancel > bestCancel {
			bestCancel = cancel
			bestConfine = confine
		}
	}
	return bestCancel, bestConfine, nil
}

type fieldParamsFunc func(gr.Event) drive.FieldParameters

type movingEngineeredProvider struct {
	env    gr.MetricProvider
	drive  drive.EskridgeDrive
	center mathx.Vec3
	stepM  float64
}

func (p *movingEngineeredProvider) MetricAt(e gr.Event) (gr.Metric, error) {
	return drive.EngineeredMetric{
		Environment: p.env,
		Drive:       p.drive.MetricParams(),
		CraftCenter: p.center,
	}.MetricAt(e)
}

func (p *movingEngineeredProvider) MetricDerivative(e gr.Event, coord int) (gr.Metric, error) {
	return gr.FiniteDiffProvider{Provider: p, StepM: p.stepM}.MetricDerivative(e, coord)
}

func (p *movingEngineeredProvider) field(e gr.Event) drive.FieldParameters {
	fp, _ := (drive.EngineeredMetric{Environment: p.env, Drive: p.drive.MetricParams(), CraftCenter: p.center}).ParametersAt(e)
	return fp
}

func metricProvider(cfg config.Scenario, bodies []physics.CelestialBody, craftPos mathx.Vec3) (gr.DerivativeMetricProvider, fieldParamsFunc, error) {
	var env gr.MetricProvider = gr.MinkowskiProvider{}
	if cfg.MetricModel.Type == "minkowski" {
		env = gr.MinkowskiProvider{}
	} else if cfg.MetricModel.Environment.Type == "schwarzschild_isotropic" {
		if len(bodies) != 1 {
			return nil, nil, fmt.Errorf("GR Schwarzschild mode supports exactly one active gravitating body")
		}
		body := bodies[cfg.MetricModel.Environment.PrimaryBodyIndex]
		env = gr.SchwarzschildIsotropic{Mass: body.Mass, GConst: cfg.Environment.G, Center: body.Position}
	}
	stepM := cfg.MetricModel.Numerics.MetricDerivativeStepM
	zeroField := func(gr.Event) drive.FieldParameters { return drive.FieldParameters{LapseAlpha: 1, Authority: 0} }
	if cfg.MetricModel.Type == "minkowski" || cfg.MetricModel.Type == "schwarzschild_isotropic" {
		fd := gr.FiniteDiffProvider{Provider: env, StepM: stepM}
		return fd, zeroField, nil
	}
	params := drive.WarpShiftParams{
		Enabled:             cfg.MetricModel.Drive.Enabled,
		BubbleRadiusM:       cfg.MetricModel.Drive.BubbleRadiusM,
		WallThicknessM:      cfg.MetricModel.Drive.WallThicknessM,
		MaxBeta:             cfg.MetricModel.Drive.MaxBeta,
		Direction:           mathx.Vec3{X: cfg.MetricModel.Drive.Direction[0], Y: cfg.MetricModel.Drive.Direction[1], Z: cfg.MetricModel.Drive.Direction[2]},
		Phase:               cfg.MetricModel.Drive.Phase,
		OmegaRadPerSec:      cfg.MetricModel.Drive.OmegaRadPerSec,
		Coherence:           cfg.MetricModel.Drive.Coherence,
		Damping:             cfg.MetricModel.Drive.Damping,
		PhaseDriftRadPerSec: cfg.MetricModel.Drive.PhaseDriftRadPerSec,
		Authority:           cfg.MetricModel.Drive.Authority,
		LapseAdjust:         cfg.MetricModel.Drive.LapseAdjust,
		Modes:               driveModes(cfg.MetricModel.Drive.Modes),
	}
	p := &movingEngineeredProvider{env: env, drive: drive.EskridgeDrive{Params: params}, center: craftPos, stepM: stepM}
	return p, p.field, nil
}

func driveModes(in []config.MetricOscillationModeConfig) []drive.OscillationMode {
	if len(in) == 0 {
		return nil
	}
	out := make([]drive.OscillationMode, 0, len(in))
	for _, mode := range in {
		m := drive.OscillationMode{
			Amplitude:      mode.Amplitude,
			OmegaRadPerSec: mode.OmegaRadPerSec,
			PhaseRad:       mode.PhaseRad,
			Direction:      mathx.Vec3{X: mode.Direction[0], Y: mode.Direction[1], Z: mode.Direction[2]},
			SpatialProfile: drive.SpatialProfile(mode.SpatialProfile),
		}
		if m.SpatialProfile == "" {
			m.SpatialProfile = drive.SpatialProfileBubble
		}
		m.TensorShape = gr.Mat4(mode.TensorShape)
		out = append(out, m)
	}
	return out
}

func sourceStackFromConfig(cfg config.Scenario) drive.SourceStack {
	return drive.SourceStack{
		RawPowerSource: drive.RawPowerSource{
			Type:                       cfg.MetricModel.RawPowerSource.Type,
			AvailableEnergyJ:           cfg.MetricModel.RawPowerSource.AvailableEnergyJ,
			MaxPowerW:                  cfg.MetricModel.RawPowerSource.MaxPowerW,
			ConversionEfficiency:       cfg.MetricModel.RawPowerSource.ConversionEfficiency,
			WasteHeatW:                 cfg.MetricModel.RawPowerSource.WasteHeatW,
			RadiationLossW:             cfg.MetricModel.RawPowerSource.RadiationLossW,
			SourceMassKG:               cfg.MetricModel.RawPowerSource.SourceMassKG,
			DepletionRate:              cfg.MetricModel.RawPowerSource.DepletionRate,
			StabilityRisk:              cfg.MetricModel.RawPowerSource.StabilityRisk,
			PhysicalPlausibilityRating: cfg.MetricModel.RawPowerSource.PhysicalPlausibilityRating,
			Notes:                      cfg.MetricModel.RawPowerSource.Notes,
		},
		ResonatorSubstrate: drive.ResonatorSubstrate{
			Type:                        cfg.MetricModel.ResonatorSubstrate.Type,
			Isotope:                     cfg.MetricModel.ResonatorSubstrate.Isotope,
			Metastable:                  cfg.MetricModel.ResonatorSubstrate.Metastable,
			RequiresActiveStabilization: cfg.MetricModel.ResonatorSubstrate.RequiresActiveStabilization,
			CoherenceMultiplier:         cfg.MetricModel.ResonatorSubstrate.CoherenceMultiplier,
			PhaseStability:              cfg.MetricModel.ResonatorSubstrate.PhaseStability,
			CouplingEfficiency:          cfg.MetricModel.ResonatorSubstrate.CouplingEfficiency,
			MaxSafeMetricAuthority:      cfg.MetricModel.ResonatorSubstrate.MaxSafeMetricAuthority,
			BubbleWallConfinementAid:    cfg.MetricModel.ResonatorSubstrate.BubbleWallConfinementAid,
			CockpitCancellationAid:      cfg.MetricModel.ResonatorSubstrate.CockpitCancellationAid,
			StabilizationPowerW:         cfg.MetricModel.ResonatorSubstrate.StabilizationPowerW,
			StorageEnergyJ:              cfg.MetricModel.ResonatorSubstrate.StorageEnergyJ,
			StabilityRisk:               cfg.MetricModel.ResonatorSubstrate.StabilityRisk,
			PhysicalPlausibilityRating:  cfg.MetricModel.ResonatorSubstrate.PhysicalPlausibilityRating,
			Notes:                       cfg.MetricModel.ResonatorSubstrate.Notes,
		},
		ExoticStressSource: drive.ExoticStressSource{
			Type:                       cfg.MetricModel.ExoticStressSource.Type,
			AvailableEnergyJ:           cfg.MetricModel.ExoticStressSource.AvailableEnergyJ,
			MaxPowerW:                  cfg.MetricModel.ExoticStressSource.MaxPowerW,
			ConversionEfficiency:       cfg.MetricModel.ExoticStressSource.ConversionEfficiency,
			NegativeEnergyCapacityJ:    cfg.MetricModel.ExoticStressSource.NegativeEnergyCapacityJ,
			StressShapingAuthority:     cfg.MetricModel.ExoticStressSource.StressShapingAuthority,
			NECViolationCapacity:       cfg.MetricModel.ExoticStressSource.NECViolationCapacity,
			WasteHeatW:                 cfg.MetricModel.ExoticStressSource.WasteHeatW,
			RadiationLossW:             cfg.MetricModel.ExoticStressSource.RadiationLossW,
			SourceMassKG:               cfg.MetricModel.ExoticStressSource.SourceMassKG,
			DepletionRate:              cfg.MetricModel.ExoticStressSource.DepletionRate,
			StabilityRisk:              cfg.MetricModel.ExoticStressSource.StabilityRisk,
			PhysicalPlausibilityRating: cfg.MetricModel.ExoticStressSource.PhysicalPlausibilityRating,
			Notes:                      cfg.MetricModel.ExoticStressSource.Notes,
		},
		ConversionEfficiency: drive.ConversionEfficiencyModel{
			Type:                  cfg.MetricModel.ConversionEfficiency.Type,
			Efficiency:            cfg.MetricModel.ConversionEfficiency.Efficiency,
			MetricCouplingFactor:  cfg.MetricModel.ConversionEfficiency.MetricCouplingFactor,
			WasteHeatFraction:     cfg.MetricModel.ConversionEfficiency.WasteHeatFraction,
			RadiationLossFraction: cfg.MetricModel.ConversionEfficiency.RadiationLossFraction,
			Notes:                 cfg.MetricModel.ConversionEfficiency.Notes,
		},
	}
}
