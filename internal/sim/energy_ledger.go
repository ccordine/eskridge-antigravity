package sim

import (
	"math"

	"github.com/example/acs/internal/config"
	"github.com/example/acs/internal/drive"
	"github.com/example/acs/internal/gr"
	"github.com/example/acs/internal/mathx"
)

type EnergyLedger struct {
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

	initialConservedEnergyJ float64
	previousCraftEnergyJ    float64
	previousFieldEnergyJ    float64
}

func (l *EnergyLedger) applySourceDiagnostics(diag drive.SourceDiagnostics) {
	l.PowerSourceType = diag.PowerSourceType
	l.ResonatorSubstrateType = diag.ResonatorSubstrateType
	l.ExoticStressSourceType = diag.ExoticStressSourceType
	l.SourceAvailableEnergyJ = diag.SourceAvailableEnergyJ
	l.SourceMaxPowerW = diag.SourceMaxPowerW
	l.UsablePowerW = diag.UsablePowerW
	l.ConversionEfficiency = diag.ConversionEfficiency
	l.WasteHeatW = diag.WasteHeatW
	l.RadiationLossW = diag.RadiationLossW
	l.SourceMassKG = diag.SourceMassKG
	l.DepletionRate = diag.DepletionRate
	l.StabilityRisk = diag.StabilityRisk
	l.PhysicalPlausibilityRating = diag.PhysicalPlausibilityRating
	l.ResonatorCoherenceMultiplier = diag.ResonatorCoherenceMultiplier
	l.ResonatorPhaseStability = diag.ResonatorPhaseStability
	l.ResonatorCouplingEfficiency = diag.ResonatorCouplingEfficiency
	l.ResonatorMaxSafeAuthority = diag.ResonatorMaxSafeAuthority
	l.MoscoviumMetastable = diag.MoscoviumMetastable
	l.MoscoviumStabilizationRequired = diag.MoscoviumStabilizationRequired
	l.ExoticNegativeEnergyCapacityJ = diag.ExoticNegativeEnergyCapacityJ
	l.ExoticStressShapingAuthority = diag.ExoticStressShapingAuthority
}

func newEnergyLedger(cfg config.Scenario, massKG float64, provider gr.MetricProvider, wl gr.Worldline) (EnergyLedger, error) {
	g, err := provider.MetricAt(gr.Event{X: wl.X})
	if err != nil {
		return EnergyLedger{}, err
	}
	v := gr.CoordinateVelocity(wl.U)
	e := gr.ConservedEnergyJ(massKG, g, wl.U)
	return EnergyLedger{
		CraftRestEnergyJ:        massKG * gr.C * gr.C,
		CraftCoordinateEnergyJ:  e,
		ConservedEnergyJ:        e,
		DriveEnergyAvailableJ:   cfg.MetricModel.DrivePower.EnergyAvailableJ,
		MetricValid:             gr.LorentzianSignatureValid(g),
		CraftKineticEnergyJ:     gr.FlatKineticEnergyJ(massKG, v),
		initialConservedEnergyJ: e,
		previousCraftEnergyJ:    e,
	}, nil
}

func (l *EnergyLedger) applyPower(result drive.PowerResult) {
	l.DrivePowerRequestedW = result.RequestedPowerW
	l.DrivePowerActualW = result.ActualPowerW
	l.DrivePowerW = result.ActualPowerW
	l.DriveEnergySpentJ += result.EnergySpentJ
	l.DriveEnergyAvailableJ -= result.EnergySpentJ
	if l.DriveEnergyAvailableJ < 0 {
		l.DriveEnergyAvailableJ = 0
	}
	l.UnfundedEnergyDebtJ += result.UnfundedEnergyDebtJ
	l.ActualDriveAuthority = result.ActualAuthority
	l.PowerClamped = result.PowerClamped
	l.MetricUnfunded = result.MetricUnfunded
}

func (l *EnergyLedger) updateCraft(massKG float64, provider gr.MetricProvider, wl gr.Worldline) error {
	g, err := provider.MetricAt(gr.Event{X: wl.X})
	if err != nil {
		return err
	}
	v := gr.CoordinateVelocity(wl.U)
	e := gr.ConservedEnergyJ(massKG, g, wl.U)
	l.CraftCoordinateEnergyJ = e
	l.ConservedEnergyJ = e
	l.CraftKineticEnergyJ = gr.FlatKineticEnergyJ(massKG, v)
	l.CraftEnergyDeltaJ = e - l.previousCraftEnergyJ
	l.ConservedEnergyErrorJ = e - l.initialConservedEnergyJ
	l.previousCraftEnergyJ = e
	l.MetricValid = gr.LorentzianSignatureValid(g)
	return nil
}

func (l *EnergyLedger) updateFieldEstimate(estimate drive.EnergyEstimate) {
	l.PositiveEnergyJ = estimate.PositiveEnergyJ
	l.NegativeEnergyJ = estimate.NegativeEnergyJ
	l.NetStressEnergyJ = estimate.NetEnergyJ
	l.AbsoluteStressEnergyJ = estimate.AbsoluteEnergyJ
	l.EstimatedMetricEnergyJ = estimate.NetEnergyJ
	l.EstimatedPositiveEnergyJ = estimate.PositiveEnergyJ
	l.EstimatedNegativeEnergyJ = estimate.NegativeEnergyJ
	l.EstimatedStressEnergyCostJ = estimate.AbsoluteEnergyJ
	l.EstimatedFieldEnergyDeltaJ = estimate.NetEnergyJ - l.previousFieldEnergyJ
	l.previousFieldEnergyJ = estimate.NetEnergyJ
	l.ConservationErrorJ = l.CraftEnergyDeltaJ + l.EstimatedFieldEnergyDeltaJ - l.DriveEnergySpentJ
	den := math.Abs(l.CraftEnergyDeltaJ) + math.Abs(l.EstimatedFieldEnergyDeltaJ) + math.Abs(l.DriveEnergySpentJ) + 1
	l.ConservationErrorRatio = l.ConservationErrorJ / den
}

func estimateStressEnergyDomain(provider gr.DerivativeMetricProvider, wl gr.Worldline, center mathx.Vec3, cfg config.Scenario) (drive.EnergyEstimate, error) {
	regions := cfg.MetricModel.Regions
	rMax := regions.BubbleRadiusM + regions.WallThicknessM
	if rMax <= 0 {
		rMax = 25
	}
	samples := regions.SamplePointsPerRegion
	if samples <= 0 {
		samples = 8
	}
	if samples > 64 {
		samples = 64
	}
	step := cfg.MetricModel.Numerics.MetricDerivativeStepM
	dirs := []mathx.Vec3{{X: 1}, {X: -1}, {Y: 1}, {Y: -1}, {Z: 1}, {Z: -1}}
	shellVolume := 4 * math.Pi * rMax * rMax * rMax / 3
	cellVolume := shellVolume / float64(samples)
	out := drive.EnergyEstimate{}
	for i := 0; i < samples; i++ {
		dir := dirs[i%len(dirs)]
		f := (float64(i) + 0.5) / float64(samples)
		r := rMax * f
		e := gr.Event{X: gr.Vec4{wl.X[0], center.X + dir.X*r, center.Y + dir.Y*r, center.Z + dir.Z*r}}
		curv, err := gr.Curvature(provider, e, wl.U, step)
		if err != nil {
			return drive.EnergyEstimate{}, err
		}
		rho := curv.StressEnergyDensity
		out.NetEnergyJ += rho * cellVolume
		out.AbsoluteEnergyJ += math.Abs(rho) * cellVolume
		if rho >= 0 {
			out.PositiveEnergyJ += rho * cellVolume
		} else {
			out.NegativeEnergyJ += rho * cellVolume
		}
		if math.Abs(rho) > math.Abs(out.PeakEnergyDensity) {
			out.PeakEnergyDensity = rho
		}
		out.AverageEnergyDensity += rho
	}
	out.AverageEnergyDensity /= float64(samples)
	return out, nil
}
