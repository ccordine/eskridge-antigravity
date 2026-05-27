package logging

import (
	"encoding/csv"
	"fmt"
	"io"
	"strconv"

	"github.com/example/acs/internal/sim"
)

type CSVLogger struct {
	w *csv.Writer
}

func NewCSVLogger(out io.Writer) (*CSVLogger, error) {
	w := csv.NewWriter(out)
	l := &CSVLogger{w: w}
	header := []string{
		"step", "time",
		"pos_x", "pos_y", "pos_z",
		"vel_x", "vel_y", "vel_z",
		"altitude", "vertical_vel",
		"metric_model", "ship_type",
		"c", "k", "phi",
		"phase_error", "lock_quality",
		"omega_drive", "omega_0",
		"drive_power", "energy",
		"metric_g00", "metric_det", "metric_signature_valid",
		"christoffel_norm", "invariant_error", "coordinate_time", "proper_time",
		"beta_x", "beta_y", "beta_z", "lapse_alpha", "drive_authority",
		"drive_phase_rad", "drive_frequency_hz", "drive_omega_rad_s",
		"drive_coherence", "drive_lock_quality", "mode_count",
		"bubble_radius", "wall_thickness", "einstein_tensor_norm",
		"stress_energy_density", "instantaneous_stress_energy_density",
		"cycle_avg_stress_energy_density", "cockpit_curvature_norm",
		"bubble_wall_curvature_norm", "cockpit_tidal_stress",
		"bubble_wall_tidal_stress", "phase_cancellation_score",
		"phase_confinement_score", "negative_energy_flag", "nec_violation_flag",
		"negative_energy_instant", "negative_energy_cycle_avg",
		"nec_violation_instant", "nec_violation_cycle_avg",
		"curvature_scalar", "geodesic_accel_diagnostic_x", "geodesic_accel_diagnostic_y",
		"geodesic_accel_diagnostic_z", "metric_derivative_step_m",
		"craft_rest_energy_j", "craft_coordinate_energy_j", "craft_kinetic_energy_j",
		"craft_energy_delta_j", "conserved_energy_j", "conserved_energy_error_j",
		"drive_energy_available_j", "drive_energy_spent_j", "drive_power_w",
		"drive_power_requested_w", "drive_power_actual_w", "requested_drive_authority",
		"actual_drive_authority", "estimated_metric_energy_j", "estimated_field_energy_delta_j",
		"estimated_positive_energy_j", "estimated_negative_energy_j", "estimated_stress_energy_cost_j",
		"positive_energy_j", "negative_energy_j", "net_stress_energy_j", "absolute_stress_energy_j",
		"unfunded_energy_debt_j", "conservation_error_j", "conservation_error_ratio",
		"stress_energy_conservation_residual", "stress_energy_conservation_valid",
		"power_clamped", "metric_unfunded", "metric_valid",
		"power_source_type", "resonator_substrate_type", "exotic_stress_source_type",
		"source_available_energy_j", "source_max_power_w", "usable_power_w",
		"conversion_efficiency", "waste_heat_w", "radiation_loss_w", "source_mass_kg",
		"depletion_rate", "stability_risk", "physical_plausibility_rating",
		"resonator_coherence_multiplier", "resonator_phase_stability",
		"resonator_coupling_efficiency", "resonator_max_safe_authority",
		"moscovium_metastable", "moscovium_stabilization_required",
		"exotic_negative_energy_capacity_j", "exotic_stress_shaping_authority",
	}
	if err := w.Write(header); err != nil {
		return nil, err
	}
	return l, nil
}

func (l *CSVLogger) Sample(s sim.Sample) error {
	record := []string{
		itoa(s.Step), f64(s.Time),
		f64(s.Position.X), f64(s.Position.Y), f64(s.Position.Z),
		f64(s.Velocity.X), f64(s.Velocity.Y), f64(s.Velocity.Z),
		f64(s.Altitude), f64(s.VerticalVel),
		s.MetricModel, s.ShipType,
		f64(s.CouplingC), f64(s.CouplingK), f64(s.CouplingPhi),
		f64(s.PhaseError), f64(s.LockQuality),
		f64(s.OmegaDrive), f64(s.Omega0),
		f64(s.DrivePower), f64(s.Energy),
		f64(s.MetricG00), f64(s.MetricDet), b01(s.MetricSignatureValid),
		f64(s.ChristoffelNorm), f64(s.InvariantError), f64(s.CoordinateTime), f64(s.ProperTime),
		f64(s.Beta.X), f64(s.Beta.Y), f64(s.Beta.Z), f64(s.LapseAlpha), f64(s.DriveAuthority),
		f64(s.DrivePhaseRad), f64(s.DriveFrequencyHz), f64(s.DriveOmegaRadS),
		f64(s.DriveCoherence), f64(s.DriveLockQuality), itoa(s.ModeCount),
		f64(s.BubbleRadius), f64(s.WallThickness), f64(s.EinsteinTensorNorm),
		f64(s.StressEnergyDensity), f64(s.InstantStressEnergyDensity),
		f64(s.CycleAvgStressEnergyDensity), f64(s.CockpitCurvatureNorm),
		f64(s.BubbleWallCurvatureNorm), f64(s.CockpitTidalStress),
		f64(s.BubbleWallTidalStress), f64(s.PhaseCancellationScore),
		f64(s.PhaseConfinementScore), b01(s.NegativeEnergyFlag), b01(s.NECViolationFlag),
		b01(s.NegativeEnergyInstant), b01(s.NegativeEnergyCycleAvg),
		b01(s.NECViolationInstant), b01(s.NECViolationCycleAvg),
		f64(s.CurvatureScalar), f64(s.GeodesicAccelDiagnostic.X), f64(s.GeodesicAccelDiagnostic.Y),
		f64(s.GeodesicAccelDiagnostic.Z), f64(s.MetricDerivativeStepM),
		f64(s.CraftRestEnergyJ), f64(s.CraftCoordinateEnergyJ), f64(s.CraftKineticEnergyJ),
		f64(s.CraftEnergyDeltaJ), f64(s.ConservedEnergyJ), f64(s.ConservedEnergyErrorJ),
		f64(s.DriveEnergyAvailableJ), f64(s.DriveEnergySpentJ), f64(s.DrivePowerW),
		f64(s.DrivePowerRequestedW), f64(s.DrivePowerActualW), f64(s.RequestedDriveAuthority),
		f64(s.ActualDriveAuthority), f64(s.EstimatedMetricEnergyJ), f64(s.EstimatedFieldEnergyDeltaJ),
		f64(s.EstimatedPositiveEnergyJ), f64(s.EstimatedNegativeEnergyJ), f64(s.EstimatedStressEnergyCostJ),
		f64(s.PositiveEnergyJ), f64(s.NegativeEnergyJ), f64(s.NetStressEnergyJ), f64(s.AbsoluteStressEnergyJ),
		f64(s.UnfundedEnergyDebtJ), f64(s.ConservationErrorJ), f64(s.ConservationErrorRatio),
		f64(s.StressEnergyConservationResidual), b01(s.StressEnergyConservationValid),
		b01(s.PowerClamped), b01(s.MetricUnfunded), b01(s.MetricValid),
		s.PowerSourceType, s.ResonatorSubstrateType, s.ExoticStressSourceType,
		f64(s.SourceAvailableEnergyJ), f64(s.SourceMaxPowerW), f64(s.UsablePowerW),
		f64(s.ConversionEfficiency), f64(s.WasteHeatW), f64(s.RadiationLossW), f64(s.SourceMassKG),
		f64(s.DepletionRate), f64(s.StabilityRisk), f64(s.PhysicalPlausibilityRating),
		f64(s.ResonatorCoherenceMultiplier), f64(s.ResonatorPhaseStability),
		f64(s.ResonatorCouplingEfficiency), f64(s.ResonatorMaxSafeAuthority),
		b01(s.MoscoviumMetastable), b01(s.MoscoviumStabilizationRequired),
		f64(s.ExoticNegativeEnergyCapacityJ), f64(s.ExoticStressShapingAuthority),
	}
	return l.w.Write(record)
}

func (l *CSVLogger) Flush() error {
	l.w.Flush()
	if err := l.w.Error(); err != nil {
		return fmt.Errorf("csv flush failed: %w", err)
	}
	return nil
}

func f64(v float64) string {
	return strconv.FormatFloat(v, 'g', 16, 64)
}

func itoa(v int) string {
	return strconv.Itoa(v)
}

func b01(v bool) string {
	if v {
		return "1"
	}
	return "0"
}
