package drive

import "testing"

func TestMoscoviumSubstrateModifiesSourceStackWithoutEnergyShortcut(t *testing.T) {
	stack := SourceStack{
		RawPowerSource: RawPowerSource{
			Type:                 "fusion",
			AvailableEnergyJ:     1e15,
			MaxPowerW:            1e12,
			ConversionEfficiency: 0.8,
		},
		ResonatorSubstrate: ResonatorSubstrate{
			Type:                        "metastable_moscovium",
			Isotope:                     "Mc-299m",
			Metastable:                  true,
			RequiresActiveStabilization: true,
			CoherenceMultiplier:         1.2,
			PhaseStability:              0.9,
			CouplingEfficiency:          0.5,
			MaxSafeMetricAuthority:      0.7,
		},
		ConversionEfficiency: ConversionEfficiencyModel{
			Efficiency:           0.5,
			MetricCouplingFactor: 1,
		},
	}
	budget, diag := stack.EffectiveBudget(PowerBudget{Enabled: true, Efficiency: 1})
	if budget.EnergyAvailableJ != 1e15 {
		t.Fatalf("moscovium substrate must not create raw energy, got %.6g", budget.EnergyAvailableJ)
	}
	if budget.Efficiency >= 0.8 {
		t.Fatalf("expected explicit conversion losses, got %.6g", budget.Efficiency)
	}
	if !diag.MoscoviumMetastable || !diag.MoscoviumStabilizationRequired {
		t.Fatalf("expected metastable moscovium diagnostics")
	}
	if diag.ResonatorMaxSafeAuthority != 0.7 {
		t.Fatalf("expected authority cap from substrate, got %.6g", diag.ResonatorMaxSafeAuthority)
	}
}
