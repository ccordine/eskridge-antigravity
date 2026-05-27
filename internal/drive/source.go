package drive

import "math"

type RawPowerSource struct {
	Type                       string
	AvailableEnergyJ           float64
	MaxPowerW                  float64
	ConversionEfficiency       float64
	WasteHeatW                 float64
	RadiationLossW             float64
	SourceMassKG               float64
	DepletionRate              float64
	StabilityRisk              float64
	PhysicalPlausibilityRating float64
	Notes                      string
}

type ResonatorSubstrate struct {
	Type                        string
	Isotope                     string
	Metastable                  bool
	RequiresActiveStabilization bool
	CoherenceMultiplier         float64
	PhaseStability              float64
	CouplingEfficiency          float64
	MaxSafeMetricAuthority      float64
	BubbleWallConfinementAid    float64
	CockpitCancellationAid      float64
	StabilizationPowerW         float64
	StorageEnergyJ              float64
	StabilityRisk               float64
	PhysicalPlausibilityRating  float64
	Notes                       string
}

type ExoticStressSource struct {
	Type                       string
	AvailableEnergyJ           float64
	MaxPowerW                  float64
	ConversionEfficiency       float64
	NegativeEnergyCapacityJ    float64
	StressShapingAuthority     float64
	NECViolationCapacity       float64
	WasteHeatW                 float64
	RadiationLossW             float64
	SourceMassKG               float64
	DepletionRate              float64
	StabilityRisk              float64
	PhysicalPlausibilityRating float64
	Notes                      string
}

type ConversionEfficiencyModel struct {
	Type                  string
	Efficiency            float64
	MetricCouplingFactor  float64
	WasteHeatFraction     float64
	RadiationLossFraction float64
	Notes                 string
}

type SourceStack struct {
	RawPowerSource       RawPowerSource
	ResonatorSubstrate   ResonatorSubstrate
	ExoticStressSource   ExoticStressSource
	ConversionEfficiency ConversionEfficiencyModel
}

type SourceDiagnostics struct {
	PowerSourceType                string
	ResonatorSubstrateType         string
	ExoticStressSourceType         string
	SourceAvailableEnergyJ         float64
	SourceMaxPowerW                float64
	UsablePowerW                   float64
	ConversionEfficiency           float64
	WasteHeatW                     float64
	RadiationLossW                 float64
	SourceMassKG                   float64
	DepletionRate                  float64
	StabilityRisk                  float64
	PhysicalPlausibilityRating     float64
	ResonatorCoherenceMultiplier   float64
	ResonatorPhaseStability        float64
	ResonatorCouplingEfficiency    float64
	ResonatorMaxSafeAuthority      float64
	MoscoviumMetastable            bool
	MoscoviumStabilizationRequired bool
	ExoticNegativeEnergyCapacityJ  float64
	ExoticStressShapingAuthority   float64
}

func (s SourceStack) EffectiveBudget(base PowerBudget) (PowerBudget, SourceDiagnostics) {
	diag := s.Diagnostics()
	out := base
	if s.RawPowerSource.Type != "" {
		out.Enabled = true
		out.EnergyAvailableJ = s.RawPowerSource.AvailableEnergyJ + s.ResonatorSubstrate.StorageEnergyJ + s.ExoticStressSource.AvailableEnergyJ
		out.MaxPowerW = s.RawPowerSource.MaxPowerW + s.ExoticStressSource.MaxPowerW
	}
	eff := diag.ConversionEfficiency
	if eff <= 0 {
		eff = out.Efficiency
	}
	if eff <= 0 {
		eff = 1
	}
	out.Efficiency = math.Max(1e-12, math.Min(1, eff))
	if out.MaxPowerW > 0 {
		out.MaxPowerW *= math.Max(0, s.ConversionEfficiency.MetricCouplingFactor)
	}
	return out, diag
}

func (s SourceStack) Diagnostics() SourceDiagnostics {
	rawEff := s.RawPowerSource.ConversionEfficiency
	if rawEff == 0 {
		rawEff = 1
	}
	exEff := s.ExoticStressSource.ConversionEfficiency
	if exEff == 0 {
		exEff = 1
	}
	convEff := s.ConversionEfficiency.Efficiency
	if convEff == 0 {
		convEff = 1
	}
	couplingEff := s.ResonatorSubstrate.CouplingEfficiency
	if couplingEff == 0 {
		couplingEff = 1
	}
	maxAuthority := s.ResonatorSubstrate.MaxSafeMetricAuthority
	if maxAuthority == 0 {
		maxAuthority = 1
	}
	coherence := s.ResonatorSubstrate.CoherenceMultiplier
	if coherence == 0 {
		coherence = 1
	}
	phase := s.ResonatorSubstrate.PhaseStability
	if phase == 0 {
		phase = 1
	}
	eff := rawEff * exEff * convEff * couplingEff
	if eff > 1 {
		eff = 1
	}
	plausibility := s.RawPowerSource.PhysicalPlausibilityRating
	if s.ResonatorSubstrate.PhysicalPlausibilityRating > 0 && (plausibility == 0 || s.ResonatorSubstrate.PhysicalPlausibilityRating < plausibility) {
		plausibility = s.ResonatorSubstrate.PhysicalPlausibilityRating
	}
	if s.ExoticStressSource.PhysicalPlausibilityRating > 0 && (plausibility == 0 || s.ExoticStressSource.PhysicalPlausibilityRating < plausibility) {
		plausibility = s.ExoticStressSource.PhysicalPlausibilityRating
	}
	return SourceDiagnostics{
		PowerSourceType:                s.RawPowerSource.Type,
		ResonatorSubstrateType:         s.ResonatorSubstrate.Type,
		ExoticStressSourceType:         s.ExoticStressSource.Type,
		SourceAvailableEnergyJ:         s.RawPowerSource.AvailableEnergyJ + s.ResonatorSubstrate.StorageEnergyJ + s.ExoticStressSource.AvailableEnergyJ,
		SourceMaxPowerW:                s.RawPowerSource.MaxPowerW + s.ExoticStressSource.MaxPowerW,
		UsablePowerW:                   (s.RawPowerSource.MaxPowerW + s.ExoticStressSource.MaxPowerW) * eff,
		ConversionEfficiency:           eff,
		WasteHeatW:                     s.RawPowerSource.WasteHeatW + s.ExoticStressSource.WasteHeatW,
		RadiationLossW:                 s.RawPowerSource.RadiationLossW + s.ExoticStressSource.RadiationLossW,
		SourceMassKG:                   s.RawPowerSource.SourceMassKG + s.ExoticStressSource.SourceMassKG,
		DepletionRate:                  s.RawPowerSource.DepletionRate + s.ExoticStressSource.DepletionRate,
		StabilityRisk:                  math.Max(s.RawPowerSource.StabilityRisk, math.Max(s.ResonatorSubstrate.StabilityRisk, s.ExoticStressSource.StabilityRisk)),
		PhysicalPlausibilityRating:     plausibility,
		ResonatorCoherenceMultiplier:   coherence,
		ResonatorPhaseStability:        phase,
		ResonatorCouplingEfficiency:    couplingEff,
		ResonatorMaxSafeAuthority:      maxAuthority,
		MoscoviumMetastable:            s.ResonatorSubstrate.Metastable && (s.ResonatorSubstrate.Type == "moscovium" || s.ResonatorSubstrate.Type == "metastable_moscovium"),
		MoscoviumStabilizationRequired: s.ResonatorSubstrate.RequiresActiveStabilization && (s.ResonatorSubstrate.Type == "moscovium" || s.ResonatorSubstrate.Type == "metastable_moscovium"),
		ExoticNegativeEnergyCapacityJ:  s.ExoticStressSource.NegativeEnergyCapacityJ,
		ExoticStressShapingAuthority:   s.ExoticStressSource.StressShapingAuthority,
	}
}
