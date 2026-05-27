package sim

import (
	"math"
	"testing"

	"github.com/example/acs/internal/config"
)

func TestSchwarzschildScenarioDescendsByGeodesic(t *testing.T) {
	cfg := baseGRScenario("schwarzschild_isotropic")
	cfg.Duration = 1.0

	var first, last Sample
	firstSet := false
	_, err := Run(cfg, func(s Sample) error {
		if !firstSet {
			first = s
			firstSet = true
		}
		last = s
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if !(last.Altitude < first.Altitude) {
		t.Fatalf("expected Schwarzschild geodesic descent, first=%.6f last=%.6f", first.Altitude, last.Altitude)
	}
	if last.MetricModel != "schwarzschild_isotropic" {
		t.Fatalf("expected metric model, got %q", last.MetricModel)
	}
	if math.Abs(last.InvariantError) > 1e-3 {
		t.Fatalf("four-velocity invariant drift too large: %g", last.InvariantError)
	}
}

func TestMinkowskiInertialScenarioStraightLine(t *testing.T) {
	cfg := baseGRScenario("minkowski")
	cfg.Craft.Position = [3]float64{0, 0, 0}
	cfg.Craft.Velocity = [3]float64{10, 0, 0}
	cfg.Duration = 1.0

	res, err := Run(cfg, func(Sample) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	if math.Abs(res.FinalCraft.Position.X-10) > 1e-6 {
		t.Fatalf("expected inertial x=10m, got %.9f", res.FinalCraft.Position.X)
	}
	if math.Abs(res.FinalCraft.Velocity.X-10) > 1e-9 {
		t.Fatalf("expected constant velocity, got %.12f", res.FinalCraft.Velocity.X)
	}
}

func TestMinkowskiConservedEnergy(t *testing.T) {
	cfg := baseGRScenario("minkowski")
	cfg.Craft.Position = [3]float64{0, 0, 0}
	cfg.Craft.Velocity = [3]float64{100, 0, 0}
	cfg.Duration = 0.2

	var first, last Sample
	firstSet := false
	_, err := Run(cfg, func(s Sample) error {
		if !firstSet {
			first = s
			firstSet = true
		}
		last = s
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if math.Abs(last.ConservedEnergyJ-first.ConservedEnergyJ) > 1e-3 {
		t.Fatalf("Minkowski conserved energy drift: %.9g", last.ConservedEnergyJ-first.ConservedEnergyJ)
	}
}

func TestSchwarzschildConservedEnergy(t *testing.T) {
	cfg := baseGRScenario("schwarzschild_isotropic")
	cfg.Duration = 0.2
	var first, last Sample
	firstSet := false
	_, err := Run(cfg, func(s Sample) error {
		if !firstSet {
			first = s
			firstSet = true
		}
		last = s
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	rel := math.Abs(last.ConservedEnergyJ-first.ConservedEnergyJ) / first.ConservedEnergyJ
	if rel > 1e-8 {
		t.Fatalf("Schwarzschild conserved energy relative drift: %.9g", rel)
	}
}

func TestDriveOffCannotClimbFromRest(t *testing.T) {
	cfg := baseGRScenario("schwarzschild_isotropic")
	cfg.Duration = 0.5
	var first, last Sample
	firstSet := false
	_, err := Run(cfg, func(s Sample) error {
		if !firstSet {
			first = s
			firstSet = true
		}
		last = s
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if last.Altitude >= first.Altitude {
		t.Fatalf("drive-off craft at rest should not climb: first=%.9f last=%.9f", first.Altitude, last.Altitude)
	}
}

func TestEngineeredMetricEmitsStressEnergyDiagnostics(t *testing.T) {
	cfg := baseGRScenario("engineered_metric")
	cfg.MetricModel.Environment.Type = "minkowski"
	cfg.MetricModel.Drive.Enabled = true
	cfg.MetricModel.Drive.Type = "adm_warp_shift"
	cfg.MetricModel.Drive.BubbleRadiusM = 20
	cfg.MetricModel.Drive.WallThicknessM = 5
	cfg.MetricModel.Drive.MaxBeta = 1e-4
	cfg.MetricModel.Drive.Direction = [3]float64{0, 0, 1}
	cfg.MetricModel.Drive.Authority = 1
	cfg.MetricModel.Drive.StressEnergyDiagnostics = true
	cfg.MetricModel.DrivePower.Enabled = true
	cfg.MetricModel.DrivePower.EnergyAvailableJ = 1e40
	cfg.MetricModel.DrivePower.MaxPowerW = 1e40
	cfg.MetricModel.DrivePower.Efficiency = 1
	cfg.MetricModel.DrivePower.UnfundedBehavior = "fail"
	cfg.Craft.Position = [3]float64{0, 0, 0}
	cfg.Duration = 0.02

	var last Sample
	_, err := Run(cfg, func(s Sample) error {
		last = s
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if !last.MetricSignatureValid {
		t.Fatalf("engineered metric should remain Lorentzian")
	}
	if !isFinite(last.EinsteinTensorNorm) || !isFinite(last.StressEnergyDensity) {
		t.Fatalf("stress-energy diagnostics must be finite")
	}
	if last.Beta.Norm() == 0 {
		t.Fatalf("enabled drive should expose non-zero beta")
	}
}

func TestPhaseDiagnosticsAndCycleAverageReported(t *testing.T) {
	cfg := baseGRScenario("engineered_metric")
	cfg.MetricModel.Environment.Type = "minkowski"
	cfg.MetricModel.Drive.Enabled = true
	cfg.MetricModel.Drive.Type = "adm_warp_shift"
	cfg.MetricModel.Drive.BubbleRadiusM = 20
	cfg.MetricModel.Drive.WallThicknessM = 5
	cfg.MetricModel.Drive.MaxBeta = 1e-4
	cfg.MetricModel.Drive.Direction = [3]float64{0, 0, 1}
	cfg.MetricModel.Drive.Authority = 1
	cfg.MetricModel.Drive.Coherence = 1
	cfg.MetricModel.Drive.OmegaRadPerSec = 20
	cfg.MetricModel.Drive.LapseAdjust = 1e-8
	cfg.MetricModel.Drive.StressEnergyDiagnostics = true
	cfg.MetricModel.DrivePower.Enabled = true
	cfg.MetricModel.DrivePower.EnergyAvailableJ = 1e40
	cfg.MetricModel.DrivePower.MaxPowerW = 1e40
	cfg.MetricModel.DrivePower.Efficiency = 1
	cfg.MetricModel.DrivePower.UnfundedBehavior = "fail"
	cfg.MetricModel.PhaseDiagnostics.Enabled = true
	cfg.MetricModel.PhaseDiagnostics.CycleAverage = true
	cfg.MetricModel.PhaseDiagnostics.SamplesPerCycle = 8
	cfg.MetricModel.PhaseDiagnostics.PhaseSweep = true
	cfg.MetricModel.PhaseDiagnostics.PhaseSweepSteps = 8
	cfg.MetricModel.Regions.CockpitRadiusM = 2
	cfg.MetricModel.Regions.BubbleRadiusM = 20
	cfg.MetricModel.Regions.WallThicknessM = 5
	cfg.Craft.Position = [3]float64{0, 0, 0}
	cfg.Duration = 0.02

	var last Sample
	_, err := Run(cfg, func(s Sample) error {
		last = s
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if last.DriveOmegaRadS != 20 || last.DriveFrequencyHz <= 0 {
		t.Fatalf("drive phase/frequency telemetry missing: omega=%g hz=%g", last.DriveOmegaRadS, last.DriveFrequencyHz)
	}
	if !isFinite(last.CycleAvgStressEnergyDensity) {
		t.Fatalf("cycle average stress-energy must be finite")
	}
	if last.PhaseCancellationScore <= 0 || last.PhaseConfinementScore < 0 {
		t.Fatalf("phase sweep diagnostics not populated: cancel=%g confine=%g", last.PhaseCancellationScore, last.PhaseConfinementScore)
	}
	if last.CockpitCurvatureNorm == 0 && last.BubbleWallCurvatureNorm == 0 {
		t.Fatalf("region curvature diagnostics should be measured")
	}
}

func TestEngineeredMetricRequiresEnergyAccounting(t *testing.T) {
	cfg := poweredEngineeredScenario()
	cfg.MetricModel.DrivePower.UnfundedBehavior = "diagnostic_only"
	cfg.MetricModel.DrivePower.AllowUnfundedMetrics = true
	cfg.MetricModel.DrivePower.EnergyAvailableJ = 1e12
	cfg.MetricModel.DrivePower.MaxPowerW = 1e6

	var last Sample
	_, err := Run(cfg, func(s Sample) error {
		last = s
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if last.EstimatedStressEnergyCostJ == 0 {
		t.Fatalf("engineered h_mu_nu should produce nonzero stress-energy cost")
	}
	if last.DriveEnergySpentJ == 0 && last.UnfundedEnergyDebtJ == 0 {
		t.Fatalf("metric cost must be spent or recorded as unfunded debt")
	}
	if !isFinite(last.ConservationErrorJ) || !isFinite(last.StressEnergyConservationResidual) {
		t.Fatalf("conservation diagnostics must be finite")
	}
}

func TestDrivePowerClampReducesAuthority(t *testing.T) {
	cfg := poweredEngineeredScenario()
	cfg.MetricModel.DrivePower.UnfundedBehavior = "clamp"
	cfg.MetricModel.DrivePower.EnergyAvailableJ = 1e6
	cfg.MetricModel.DrivePower.MaxPowerW = 1

	var last Sample
	_, err := Run(cfg, func(s Sample) error {
		last = s
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if !last.PowerClamped {
		t.Fatalf("expected power clamp")
	}
	if !(last.ActualDriveAuthority < last.RequestedDriveAuthority) {
		t.Fatalf("expected authority reduction, requested=%g actual=%g", last.RequestedDriveAuthority, last.ActualDriveAuthority)
	}
}

func TestMoscoviumSubstrateCapsAuthorityAndReportsSource(t *testing.T) {
	cfg := poweredEngineeredScenario()
	cfg.MetricModel.RawPowerSource.Type = "fusion"
	cfg.MetricModel.RawPowerSource.AvailableEnergyJ = 1e40
	cfg.MetricModel.RawPowerSource.MaxPowerW = 1e40
	cfg.MetricModel.RawPowerSource.ConversionEfficiency = 0.8
	cfg.MetricModel.ResonatorSubstrate.Type = "metastable_moscovium"
	cfg.MetricModel.ResonatorSubstrate.Isotope = "Mc-299m"
	cfg.MetricModel.ResonatorSubstrate.Metastable = true
	cfg.MetricModel.ResonatorSubstrate.RequiresActiveStabilization = true
	cfg.MetricModel.ResonatorSubstrate.CoherenceMultiplier = 1.1
	cfg.MetricModel.ResonatorSubstrate.PhaseStability = 0.9
	cfg.MetricModel.ResonatorSubstrate.CouplingEfficiency = 0.7
	cfg.MetricModel.ResonatorSubstrate.MaxSafeMetricAuthority = 0.4
	cfg.MetricModel.ConversionEfficiency.Efficiency = 0.5
	cfg.MetricModel.ConversionEfficiency.MetricCouplingFactor = 1

	var last Sample
	_, err := Run(cfg, func(s Sample) error {
		last = s
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if last.PowerSourceType != "fusion" || last.ResonatorSubstrateType != "metastable_moscovium" {
		t.Fatalf("source stack telemetry missing: power=%q substrate=%q", last.PowerSourceType, last.ResonatorSubstrateType)
	}
	if !last.MoscoviumMetastable || !last.MoscoviumStabilizationRequired {
		t.Fatalf("moscovium substrate diagnostics missing")
	}
	if last.ActualDriveAuthority > 0.4+1e-12 {
		t.Fatalf("moscovium substrate authority cap not applied: %.6g", last.ActualDriveAuthority)
	}
	if last.SourceAvailableEnergyJ <= 0 || last.ConversionEfficiency <= 0 {
		t.Fatalf("source energy and conversion efficiency should be reported")
	}
}

func TestPhaseDoesNotDirectlyMutateVelocity(t *testing.T) {
	cfg0 := baseGRScenario("engineered_metric")
	cfg0.MetricModel.Environment.Type = "minkowski"
	cfg0.MetricModel.Drive.Enabled = true
	cfg0.MetricModel.Drive.Type = "adm_warp_shift"
	cfg0.MetricModel.Drive.BubbleRadiusM = 20
	cfg0.MetricModel.Drive.WallThicknessM = 5
	cfg0.MetricModel.Drive.MaxBeta = 0
	cfg0.MetricModel.Drive.Direction = [3]float64{0, 0, 1}
	cfg0.MetricModel.Drive.Authority = 1
	cfg0.Craft.Position = [3]float64{0, 0, 0}
	cfg0.Craft.Velocity = [3]float64{1, 0, 0}
	cfg0.Duration = 0.01
	cfg1 := cfg0
	cfg1.MetricModel.Drive.Phase = math.Pi

	r0, err := Run(cfg0, func(Sample) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	r1, err := Run(cfg1, func(Sample) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	if r0.FinalCraft.Velocity.Sub(r1.FinalCraft.Velocity).Norm() > 1e-12 {
		t.Fatalf("phase-only change without metric perturbation must not directly mutate velocity")
	}
}

func TestLegacyGravityModelRejected(t *testing.T) {
	cfg := baseGRScenario("minkowski")
	cfg.GravityModel.Type = "yukawa"
	if _, err := Run(cfg, func(Sample) error { return nil }); err == nil {
		t.Fatalf("expected obsolete gravity_model to be rejected")
	}
}

func baseGRScenario(metric string) config.Scenario {
	return config.Scenario{
		Name:     "test",
		Seed:     1,
		Dt:       0.01,
		Duration: 0.1,
		LogEvery: 1,
		Bodies: []config.BodyConfig{{
			Name:     "earth",
			Mass:     5.972e24,
			Radius:   6371000,
			Position: [3]float64{0, 0, 0},
			Velocity: [3]float64{0, 0, 0},
		}},
		Craft: config.CraftConfig{
			Mass:            1200,
			ShipType:        "saucer",
			InertiaDiagonal: [3]float64{1200, 1100, 900},
			Position:        [3]float64{0, 0, 6372000},
			Velocity:        [3]float64{0, 0, 0},
			Orientation:     [4]float64{1, 0, 0, 0},
			AngularVelocity: [3]float64{0, 0, 0},
		},
		Environment: config.EnvironmentConfig{
			G:              6.6743e-11,
			PrimaryBodyIdx: 0,
			Ground:         config.GroundConfig{Enabled: false, BodyIndex: 0},
		},
		MetricModel: config.MetricModelConfig{
			Type: metric,
			Environment: config.MetricEnvironmentConfig{
				Type:             "schwarzschild_isotropic",
				PrimaryBodyIndex: 0,
			},
			Numerics: config.MetricNumericsConfig{
				ProperTimeSubstepS:    0.001,
				MetricDerivativeStepM: 1,
				MaxSubstepsPerTick:    100,
			},
		},
		Coupler: config.CouplerConfig{
			Enabled:          false,
			Omega0:           80,
			Q:                45,
			Beta:             1.2,
			Alpha:            0.22,
			KMax:             2.0,
			DefaultC:         1,
			LockOmegaWindow:  5,
			LockCollapse:     1.8,
			LockRecover:      4.5,
			PowerLimit:       6000,
			MinOmegaBase:     65,
			MaxOmegaBase:     95,
			InitialOmegaBase: 80,
		},
	}
}

func poweredEngineeredScenario() config.Scenario {
	cfg := baseGRScenario("engineered_metric")
	cfg.MetricModel.Environment.Type = "minkowski"
	cfg.MetricModel.Drive.Enabled = true
	cfg.MetricModel.Drive.Type = "adm_warp_shift"
	cfg.MetricModel.Drive.BubbleRadiusM = 20
	cfg.MetricModel.Drive.WallThicknessM = 5
	cfg.MetricModel.Drive.MaxBeta = 1e-4
	cfg.MetricModel.Drive.Direction = [3]float64{0, 0, 1}
	cfg.MetricModel.Drive.Authority = 1
	cfg.MetricModel.Drive.Coherence = 1
	cfg.MetricModel.Drive.LapseAdjust = 1e-8
	cfg.MetricModel.Drive.StressEnergyDiagnostics = true
	cfg.MetricModel.DrivePower.Enabled = true
	cfg.MetricModel.DrivePower.Efficiency = 0.5
	cfg.MetricModel.PhaseDiagnostics.Enabled = true
	cfg.MetricModel.Regions.SamplePointsPerRegion = 4
	cfg.Craft.Position = [3]float64{0, 0, 0}
	cfg.Duration = 0.02
	return cfg
}

func isFinite(v float64) bool {
	return !math.IsNaN(v) && !math.IsInf(v, 0)
}
