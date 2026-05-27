package config

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/example/acs/internal/control"
	"github.com/example/acs/internal/coupler"
	"github.com/example/acs/internal/mathx"
	"github.com/example/acs/internal/physics"
)

type Scenario struct {
	Name         string             `json:"name"`
	Seed         int64              `json:"seed"`
	Dt           float64            `json:"dt"`
	Duration     float64            `json:"duration"`
	LogEvery     int                `json:"log_every"`
	Bodies       []BodyConfig       `json:"bodies"`
	Craft        CraftConfig        `json:"craft"`
	Environment  EnvironmentConfig  `json:"environment"`
	GravityModel GravityModelConfig `json:"gravity_model"`
	MetricModel  MetricModelConfig  `json:"metric_model"`
	Coupler      CouplerConfig      `json:"coupler"`
	Controller   ControllerConfig   `json:"controller"`
}

type BodyConfig struct {
	Name     string     `json:"name"`
	Mass     float64    `json:"mass"`
	Radius   float64    `json:"radius"`
	Position [3]float64 `json:"position"`
	Velocity [3]float64 `json:"velocity"`
}

type CraftConfig struct {
	Mass            float64          `json:"mass"`
	ShipType        string           `json:"ship_type"`
	InertiaDiagonal [3]float64       `json:"inertia_diagonal"`
	Position        [3]float64       `json:"position"`
	Velocity        [3]float64       `json:"velocity"`
	Orientation     [4]float64       `json:"orientation"`
	AngularVelocity [3]float64       `json:"angular_velocity"`
	Drag            DragConfig       `json:"drag"`
	Aero            AeroConfig       `json:"aero"`
	Propulsion      PropulsionConfig `json:"propulsion"`
	EM              EMConfig         `json:"em"`
	Thermal         ThermalConfig    `json:"thermal"`
	Structural      StructuralConfig `json:"structural"`
	Pilot           PilotConfig      `json:"pilot"`
}

type DragConfig struct {
	Enabled bool               `json:"enabled"`
	Cd      float64            `json:"cd"`
	Area    float64            `json:"area"`
	Plasma  PlasmaSheathConfig `json:"plasma"`
}

type PlasmaSheathConfig struct {
	Enabled          bool    `json:"enabled"`
	Level            float64 `json:"level"`
	MaxDragReduction float64 `json:"max_drag_reduction"`
	AuthoritySpeed   float64 `json:"authority_speed"`
	VelocityFalloff  float64 `json:"velocity_falloff"`
	PowerPerArea     float64 `json:"power_per_area"`
	IonizationGain   float64 `json:"ionization_gain"`
}

type EnvironmentConfig struct {
	G              float64          `json:"g"`
	PrimaryBodyIdx int              `json:"primary_body_index"`
	Atmosphere     AtmosphereConfig `json:"atmosphere"`
	Ground         GroundConfig     `json:"ground"`
	EField         [3]float64       `json:"e_field"`
	BField         [3]float64       `json:"b_field"`
}

type AtmosphereConfig struct {
	Enabled      bool                    `json:"enabled"`
	Rho0         float64                 `json:"rho0"`
	ScaleHeight  float64                 `json:"scale_height"`
	Wind         [3]float64              `json:"wind"`
	Temperature0 float64                 `json:"temperature0"`
	LapseRate    float64                 `json:"lapse_rate"`
	Gamma        float64                 `json:"gamma"`
	GasConstant  float64                 `json:"gas_constant"`
	Layers       []AtmosphereLayerConfig `json:"layers"`
}

type AtmosphereLayerConfig struct {
	MinAlt       float64 `json:"min_alt"`
	MaxAlt       float64 `json:"max_alt"`
	Rho0         float64 `json:"rho0"`
	ScaleHeight  float64 `json:"scale_height"`
	Temperature0 float64 `json:"temperature0"`
	LapseRate    float64 `json:"lapse_rate"`
	Gamma        float64 `json:"gamma"`
	GasConstant  float64 `json:"gas_constant"`
}

type AeroConfig struct {
	Enabled  bool    `json:"enabled"`
	Cl0      float64 `json:"cl0"`
	ClAlpha  float64 `json:"cl_alpha"`
	ClMax    float64 `json:"cl_max"`
	StallAoA float64 `json:"stall_aoa"`
}

type PropulsionConfig struct {
	Enabled   bool    `json:"enabled"`
	Throttle  float64 `json:"throttle"`
	MaxThrust float64 `json:"max_thrust"`
}

type EMConfig struct {
	Enabled bool    `json:"enabled"`
	ChargeC float64 `json:"charge_c"`
}

type ThermalConfig struct {
	Enabled               bool    `json:"enabled"`
	HeatTransferCoeff     float64 `json:"heat_transfer_coeff"`
	RadiativeCoeff        float64 `json:"radiative_coeff"`
	Emissivity            float64 `json:"emissivity"`
	MaxSkinTempK          float64 `json:"max_skin_temp_k"`
	InitialSkinTempK      float64 `json:"initial_skin_temp_k"`
	ReferenceHeatCapacity float64 `json:"reference_heat_capacity"`
}

type StructuralConfig struct {
	Enabled        bool    `json:"enabled"`
	MaxGLoad       float64 `json:"max_g_load"`
	MaxDynamicQPa  float64 `json:"max_dynamic_q_pa"`
	MaxHeatFluxWm2 float64 `json:"max_heat_flux_w_m2"`
}

type PilotConfig struct {
	Enabled          bool    `json:"enabled"`
	MaxGPositive     float64 `json:"max_g_positive"`
	MaxGNegative     float64 `json:"max_g_negative"`
	MaxGLongitudinal float64 `json:"max_g_longitudinal"`
	MaxGLateral      float64 `json:"max_g_lateral"`
	RecoveryTauS     float64 `json:"recovery_tau_s"`
}

type GroundConfig struct {
	Enabled      bool    `json:"enabled"`
	BodyIndex    int     `json:"body_index"`
	Restitution  float64 `json:"restitution"`
	SurfaceEps   float64 `json:"surface_eps"`
	TangentialMu float64 `json:"tangential_mu"`
}

type GravityModelConfig struct {
	Type    string             `json:"type"`
	Yukawa  YukawaConfig       `json:"yukawa"`
	NegMass NegMassModelConfig `json:"negmass"`
}

type MetricModelConfig struct {
	Type                 string                     `json:"type"`
	C                    float64                    `json:"c"`
	Environment          MetricEnvironmentConfig    `json:"environment"`
	Drive                MetricDriveConfig          `json:"drive"`
	DrivePower           DrivePowerConfig           `json:"drive_power"`
	RawPowerSource       RawPowerSourceConfig       `json:"raw_power_source"`
	ResonatorSubstrate   ResonatorSubstrateConfig   `json:"resonator_substrate"`
	ExoticStressSource   ExoticStressSourceConfig   `json:"exotic_stress_source"`
	ConversionEfficiency ConversionEfficiencyConfig `json:"conversion_efficiency"`
	Numerics             MetricNumericsConfig       `json:"numerics"`
	PhaseDiagnostics     PhaseDiagnosticsConfig     `json:"phase_diagnostics"`
	Regions              MetricRegionsConfig        `json:"regions"`
}

type MetricEnvironmentConfig struct {
	Type             string `json:"type"`
	PrimaryBodyIndex int    `json:"primary_body_index"`
}

type MetricDriveConfig struct {
	Enabled                 bool                          `json:"enabled"`
	Type                    string                        `json:"type"`
	BubbleRadiusM           float64                       `json:"bubble_radius_m"`
	WallThicknessM          float64                       `json:"wall_thickness_m"`
	MaxBeta                 float64                       `json:"max_beta"`
	Direction               [3]float64                    `json:"direction"`
	Phase                   float64                       `json:"phase"`
	OmegaRadPerSec          float64                       `json:"omega_rad_s"`
	FrequencyHz             float64                       `json:"frequency_hz"`
	Coherence               float64                       `json:"coherence"`
	Damping                 float64                       `json:"damping"`
	PhaseDriftRadPerSec     float64                       `json:"phase_drift_rad_s"`
	Authority               float64                       `json:"authority"`
	LapseAdjust             float64                       `json:"lapse_adjust"`
	StressEnergyDiagnostics bool                          `json:"stress_energy_diagnostics"`
	Modes                   []MetricOscillationModeConfig `json:"modes"`
}

type DrivePowerConfig struct {
	Enabled              bool    `json:"enabled"`
	EnergyAvailableJ     float64 `json:"energy_available_j"`
	MaxPowerW            float64 `json:"max_power_w"`
	Efficiency           float64 `json:"efficiency"`
	AllowUnfundedMetrics bool    `json:"allow_unfunded_metrics"`
	UnfundedBehavior     string  `json:"unfunded_behavior"`
}

type RawPowerSourceConfig struct {
	Type                       string  `json:"type"`
	AvailableEnergyJ           float64 `json:"available_energy_j"`
	MaxPowerW                  float64 `json:"max_power_w"`
	ConversionEfficiency       float64 `json:"conversion_efficiency"`
	WasteHeatW                 float64 `json:"waste_heat_w"`
	RadiationLossW             float64 `json:"radiation_loss_w"`
	SourceMassKG               float64 `json:"source_mass_kg"`
	DepletionRate              float64 `json:"depletion_rate"`
	StabilityRisk              float64 `json:"stability_risk"`
	PhysicalPlausibilityRating float64 `json:"physical_plausibility_rating"`
	Notes                      string  `json:"notes"`
}

type ResonatorSubstrateConfig struct {
	Type                        string  `json:"type"`
	Isotope                     string  `json:"isotope"`
	Metastable                  bool    `json:"metastable"`
	RequiresActiveStabilization bool    `json:"requires_active_stabilization"`
	CoherenceMultiplier         float64 `json:"coherence_multiplier"`
	PhaseStability              float64 `json:"phase_stability"`
	CouplingEfficiency          float64 `json:"coupling_efficiency"`
	MaxSafeMetricAuthority      float64 `json:"max_safe_metric_authority"`
	BubbleWallConfinementAid    float64 `json:"bubble_wall_confinement_aid"`
	CockpitCancellationAid      float64 `json:"cockpit_cancellation_aid"`
	StabilizationPowerW         float64 `json:"stabilization_power_w"`
	StorageEnergyJ              float64 `json:"storage_energy_j"`
	StabilityRisk               float64 `json:"stability_risk"`
	PhysicalPlausibilityRating  float64 `json:"physical_plausibility_rating"`
	Notes                       string  `json:"notes"`
}

type ExoticStressSourceConfig struct {
	Type                       string  `json:"type"`
	AvailableEnergyJ           float64 `json:"available_energy_j"`
	MaxPowerW                  float64 `json:"max_power_w"`
	ConversionEfficiency       float64 `json:"conversion_efficiency"`
	NegativeEnergyCapacityJ    float64 `json:"negative_energy_capacity_j"`
	StressShapingAuthority     float64 `json:"stress_shaping_authority"`
	NECViolationCapacity       float64 `json:"nec_violation_capacity"`
	WasteHeatW                 float64 `json:"waste_heat_w"`
	RadiationLossW             float64 `json:"radiation_loss_w"`
	SourceMassKG               float64 `json:"source_mass_kg"`
	DepletionRate              float64 `json:"depletion_rate"`
	StabilityRisk              float64 `json:"stability_risk"`
	PhysicalPlausibilityRating float64 `json:"physical_plausibility_rating"`
	Notes                      string  `json:"notes"`
}

type ConversionEfficiencyConfig struct {
	Type                  string  `json:"type"`
	Efficiency            float64 `json:"efficiency"`
	MetricCouplingFactor  float64 `json:"metric_coupling_factor"`
	WasteHeatFraction     float64 `json:"waste_heat_fraction"`
	RadiationLossFraction float64 `json:"radiation_loss_fraction"`
	Notes                 string  `json:"notes"`
}

type MetricOscillationModeConfig struct {
	Amplitude      float64       `json:"amplitude"`
	OmegaRadPerSec float64       `json:"omega_rad_s"`
	FrequencyHz    float64       `json:"frequency_hz"`
	PhaseRad       float64       `json:"phase_rad"`
	Direction      [3]float64    `json:"direction"`
	TensorShape    [4][4]float64 `json:"tensor_shape"`
	SpatialProfile string        `json:"spatial_profile"`
}

type PhaseDiagnosticsConfig struct {
	Enabled         bool `json:"enabled"`
	CycleAverage    bool `json:"cycle_average"`
	SamplesPerCycle int  `json:"samples_per_cycle"`
	PhaseSweep      bool `json:"phase_sweep"`
	PhaseSweepSteps int  `json:"phase_sweep_steps"`
}

type MetricRegionsConfig struct {
	CockpitRadiusM        float64 `json:"cockpit_radius_m"`
	BubbleRadiusM         float64 `json:"bubble_radius_m"`
	WallThicknessM        float64 `json:"wall_thickness_m"`
	SamplePointsPerRegion int     `json:"sample_points_per_region"`
}

type MetricNumericsConfig struct {
	ProperTimeSubstepS    float64 `json:"proper_time_substep_s"`
	MetricDerivativeStepM float64 `json:"metric_derivative_step_m"`
	MaxSubstepsPerTick    int     `json:"max_substeps_per_tick"`
}

type YukawaConfig struct {
	Alpha  float64 `json:"alpha"`
	Lambda float64 `json:"lambda"`
}

type NegMassModelConfig struct {
	Convention        string             `json:"convention"`
	QGCraft           float64            `json:"qg_craft"`
	QGOverrides       map[string]float64 `json:"qg_overrides"`
	RunawayAccelLimit float64            `json:"runaway_accel_limit"`
}

type CouplerConfig struct {
	Enabled bool `json:"enabled"`

	Omega0          float64 `json:"omega0"`
	Omega0DriftRate float64 `json:"omega0_drift_rate"`
	Q               float64 `json:"q"`
	Beta            float64 `json:"beta"`
	Alpha           float64 `json:"alpha"`
	KMax            float64 `json:"k_max"`
	PhiBias         float64 `json:"phi_bias"`
	DefaultC        float64 `json:"default_c"`

	PllKp float64 `json:"pll_kp"`
	PllKi float64 `json:"pll_ki"`

	LockOmegaWindow float64 `json:"lock_omega_window"`
	LockCollapse    float64 `json:"lock_collapse"`
	LockRecover     float64 `json:"lock_recover"`

	PowerC1    float64 `json:"power_c1"`
	PowerC2    float64 `json:"power_c2"`
	PowerLimit float64 `json:"power_limit"`
	Energy     float64 `json:"energy"`

	MinAmplitude float64 `json:"min_amplitude"`
	MaxAmplitude float64 `json:"max_amplitude"`
	AmpRate      float64 `json:"amp_rate"`
	ThetaRate    float64 `json:"theta_rate"`

	MinOmegaBase  float64 `json:"min_omega_base"`
	MaxOmegaBase  float64 `json:"max_omega_base"`
	OmegaBaseRate float64 `json:"omega_base_rate"`

	InitialAmplitude   float64 `json:"initial_amplitude"`
	InitialThetaTarget float64 `json:"initial_theta_target"`
	InitialOmegaBase   float64 `json:"initial_omega_base"`
	InitialDrivePhase  float64 `json:"initial_drive_phase"`

	DirectionalEnabled bool       `json:"directional_enabled"`
	FieldAxisBody      [3]float64 `json:"field_axis_body"`
	ParallelFactor     float64    `json:"parallel_factor"`
	PerpFactor         float64    `json:"perp_factor"`
}

type ControllerConfig struct {
	Enabled        bool    `json:"enabled"`
	TargetAltitude float64 `json:"target_altitude"`
	Kp             float64 `json:"kp"`
	Ki             float64 `json:"ki"`
	Kd             float64 `json:"kd"`
	CMin           float64 `json:"c_min"`
	CMax           float64 `json:"c_max"`
}

func Load(path string) (Scenario, error) {
	f, err := os.Open(path)
	if err != nil {
		return Scenario{}, err
	}
	defer f.Close()

	dec := json.NewDecoder(f)
	dec.DisallowUnknownFields()
	var cfg Scenario
	if err := dec.Decode(&cfg); err != nil {
		return Scenario{}, err
	}
	if err := cfg.Validate(); err != nil {
		return Scenario{}, err
	}
	return cfg, nil
}

func (s *Scenario) Validate() error {
	if s.Dt <= 0 {
		return fmt.Errorf("dt must be > 0")
	}
	if s.Duration <= 0 {
		return fmt.Errorf("duration must be > 0")
	}
	if len(s.Bodies) == 0 {
		return fmt.Errorf("at least one body is required")
	}
	if s.Craft.Mass <= 0 {
		return fmt.Errorf("craft.mass must be > 0")
	}
	shipType := strings.ToLower(strings.TrimSpace(s.Craft.ShipType))
	if shipType == "" {
		shipType = "saucer"
	}
	normalizedShipType, ok := normalizeShipType(shipType)
	if !ok {
		return fmt.Errorf("craft.ship_type must be saucer, sphere, egg, pyramid, or flat_triangle")
	}
	s.Craft.ShipType = normalizedShipType
	if s.Environment.PrimaryBodyIdx < 0 || s.Environment.PrimaryBodyIdx >= len(s.Bodies) {
		return fmt.Errorf("environment.primary_body_index out of range")
	}
	if s.LogEvery <= 0 {
		s.LogEvery = 1
	}

	if s.Environment.G == 0 {
		s.Environment.G = 6.67430e-11
	}
	s.MetricModel.Type = strings.ToLower(strings.TrimSpace(s.MetricModel.Type))
	if s.MetricModel.Type == "" {
		s.MetricModel.Type = "schwarzschild_isotropic"
	}
	if strings.TrimSpace(s.GravityModel.Type) != "" {
		return fmt.Errorf("gravity_model is obsolete; use metric_model")
	}
	switch s.MetricModel.Type {
	case "minkowski", "schwarzschild_isotropic", "engineered_metric":
	default:
		return fmt.Errorf("metric_model.type must be minkowski, schwarzschild_isotropic, or engineered_metric")
	}
	if s.MetricModel.C == 0 {
		s.MetricModel.C = 299792458
	}
	if s.MetricModel.Environment.PrimaryBodyIndex == 0 {
		s.MetricModel.Environment.PrimaryBodyIndex = s.Environment.PrimaryBodyIdx
	}
	if s.MetricModel.Environment.PrimaryBodyIndex < 0 || s.MetricModel.Environment.PrimaryBodyIndex >= len(s.Bodies) {
		return fmt.Errorf("metric_model.environment.primary_body_index out of range")
	}
	s.MetricModel.Environment.Type = strings.ToLower(strings.TrimSpace(s.MetricModel.Environment.Type))
	if s.MetricModel.Environment.Type == "" {
		if s.MetricModel.Type == "minkowski" {
			s.MetricModel.Environment.Type = "minkowski"
		} else {
			s.MetricModel.Environment.Type = "schwarzschild_isotropic"
		}
	}
	switch s.MetricModel.Environment.Type {
	case "minkowski", "schwarzschild_isotropic":
	default:
		return fmt.Errorf("metric_model.environment.type must be minkowski or schwarzschild_isotropic")
	}
	if s.MetricModel.Type == "engineered_metric" {
		s.MetricModel.Drive.Type = strings.ToLower(strings.TrimSpace(s.MetricModel.Drive.Type))
		if s.MetricModel.Drive.Type == "" {
			s.MetricModel.Drive.Type = "adm_warp_shift"
		}
		if s.MetricModel.Drive.Type != "adm_warp_shift" {
			return fmt.Errorf("metric_model.drive.type must be adm_warp_shift")
		}
		if s.MetricModel.Drive.BubbleRadiusM <= 0 {
			return fmt.Errorf("metric_model.drive.bubble_radius_m must be > 0")
		}
		if s.MetricModel.Drive.WallThicknessM <= 0 {
			return fmt.Errorf("metric_model.drive.wall_thickness_m must be > 0")
		}
		if abs(s.MetricModel.Drive.MaxBeta) >= 1 {
			return fmt.Errorf("metric_model.drive.max_beta must have magnitude < 1")
		}
		if s.MetricModel.Drive.Authority < 0 || s.MetricModel.Drive.Authority > 1 {
			return fmt.Errorf("metric_model.drive.authority must be in [0,1]")
		}
		if s.MetricModel.Drive.Enabled && !s.MetricModel.DrivePower.Enabled {
			s.MetricModel.DrivePower.Enabled = true
		}
		if s.MetricModel.Drive.FrequencyHz > 0 {
			s.MetricModel.Drive.OmegaRadPerSec = 2 * 3.141592653589793 * s.MetricModel.Drive.FrequencyHz
		}
		if s.MetricModel.Drive.OmegaRadPerSec < 0 {
			return fmt.Errorf("metric_model.drive.omega_rad_s must be >= 0")
		}
		if s.MetricModel.Drive.Coherence == 0 {
			s.MetricModel.Drive.Coherence = 1
		}
		if s.MetricModel.Drive.Coherence < 0 || s.MetricModel.Drive.Coherence > 1 {
			return fmt.Errorf("metric_model.drive.coherence must be in [0,1]")
		}
		for i := range s.MetricModel.Drive.Modes {
			if s.MetricModel.Drive.Modes[i].FrequencyHz > 0 {
				s.MetricModel.Drive.Modes[i].OmegaRadPerSec = 2 * 3.141592653589793 * s.MetricModel.Drive.Modes[i].FrequencyHz
			}
			if s.MetricModel.Drive.Modes[i].OmegaRadPerSec < 0 {
				return fmt.Errorf("metric_model.drive.modes[%d].omega_rad_s must be >= 0", i)
			}
		}
	}
	if err := s.normalizeSourceStack(); err != nil {
		return err
	}
	if s.MetricModel.Numerics.ProperTimeSubstepS <= 0 {
		s.MetricModel.Numerics.ProperTimeSubstepS = 0.0005
	}
	if s.MetricModel.Numerics.MetricDerivativeStepM <= 0 {
		s.MetricModel.Numerics.MetricDerivativeStepM = 0.1
	}
	if s.MetricModel.Numerics.MaxSubstepsPerTick <= 0 {
		s.MetricModel.Numerics.MaxSubstepsPerTick = 1000
	}
	if s.MetricModel.PhaseDiagnostics.SamplesPerCycle <= 0 {
		s.MetricModel.PhaseDiagnostics.SamplesPerCycle = 32
	}
	if s.MetricModel.PhaseDiagnostics.PhaseSweepSteps <= 0 {
		s.MetricModel.PhaseDiagnostics.PhaseSweepSteps = 64
	}
	if s.MetricModel.Regions.CockpitRadiusM <= 0 {
		s.MetricModel.Regions.CockpitRadiusM = 2
	}
	if s.MetricModel.Regions.BubbleRadiusM <= 0 {
		s.MetricModel.Regions.BubbleRadiusM = s.MetricModel.Drive.BubbleRadiusM
	}
	if s.MetricModel.Regions.BubbleRadiusM <= 0 {
		s.MetricModel.Regions.BubbleRadiusM = 20
	}
	if s.MetricModel.Regions.WallThicknessM <= 0 {
		s.MetricModel.Regions.WallThicknessM = s.MetricModel.Drive.WallThicknessM
	}
	if s.MetricModel.Regions.WallThicknessM <= 0 {
		s.MetricModel.Regions.WallThicknessM = 5
	}
	if s.MetricModel.Regions.SamplePointsPerRegion <= 0 {
		s.MetricModel.Regions.SamplePointsPerRegion = 64
	}
	if s.MetricModel.DrivePower.Efficiency == 0 {
		s.MetricModel.DrivePower.Efficiency = 1
	}
	if s.MetricModel.DrivePower.Efficiency <= 0 || s.MetricModel.DrivePower.Efficiency > 1 {
		return fmt.Errorf("metric_model.drive_power.efficiency must be in (0,1]")
	}
	if s.MetricModel.DrivePower.MaxPowerW < 0 {
		return fmt.Errorf("metric_model.drive_power.max_power_w must be >= 0")
	}
	if s.MetricModel.DrivePower.EnergyAvailableJ < 0 {
		return fmt.Errorf("metric_model.drive_power.energy_available_j must be >= 0")
	}
	s.MetricModel.DrivePower.UnfundedBehavior = strings.ToLower(strings.TrimSpace(s.MetricModel.DrivePower.UnfundedBehavior))
	if s.MetricModel.DrivePower.UnfundedBehavior == "" {
		s.MetricModel.DrivePower.UnfundedBehavior = "fail"
	}
	switch s.MetricModel.DrivePower.UnfundedBehavior {
	case "fail", "clamp", "diagnostic_only":
	default:
		return fmt.Errorf("metric_model.drive_power.unfunded_behavior must be fail, clamp, or diagnostic_only")
	}

	return nil
}

func (s *Scenario) normalizeSourceStack() error {
	src := &s.MetricModel.RawPowerSource
	src.Type = strings.ToLower(strings.TrimSpace(src.Type))
	if src.Type != "" {
		switch src.Type {
		case "fission", "fusion", "antimatter", "beamed_power", "capacitor", "pulsed_discharge", "black_hole", "hawking", "vacuum_casimir", "dark_matter", "moscovium_storage", "debug_infinite":
		default:
			return fmt.Errorf("metric_model.raw_power_source.type is unsupported")
		}
		if src.ConversionEfficiency == 0 {
			src.ConversionEfficiency = 1
		}
		if src.ConversionEfficiency <= 0 || src.ConversionEfficiency > 1 {
			return fmt.Errorf("metric_model.raw_power_source.conversion_efficiency must be in (0,1]")
		}
		if src.AvailableEnergyJ < 0 || src.MaxPowerW < 0 || src.SourceMassKG < 0 {
			return fmt.Errorf("metric_model.raw_power_source energy, power, and mass must be >= 0")
		}
	}

	sub := &s.MetricModel.ResonatorSubstrate
	sub.Type = strings.ToLower(strings.TrimSpace(sub.Type))
	if sub.Type != "" {
		switch sub.Type {
		case "generic", "moscovium", "metastable_moscovium", "superconductor", "exotic_crystal", "debug_ideal":
		default:
			return fmt.Errorf("metric_model.resonator_substrate.type is unsupported")
		}
		if sub.CoherenceMultiplier == 0 {
			sub.CoherenceMultiplier = 1
		}
		if sub.PhaseStability == 0 {
			sub.PhaseStability = 1
		}
		if sub.CouplingEfficiency == 0 {
			sub.CouplingEfficiency = 1
		}
		if sub.MaxSafeMetricAuthority == 0 {
			sub.MaxSafeMetricAuthority = 1
		}
		if sub.CoherenceMultiplier < 0 || sub.PhaseStability < 0 || sub.CouplingEfficiency <= 0 || sub.MaxSafeMetricAuthority < 0 {
			return fmt.Errorf("metric_model.resonator_substrate multipliers must be non-negative and efficiency must be > 0")
		}
		if sub.MaxSafeMetricAuthority > 1 {
			sub.MaxSafeMetricAuthority = 1
		}
	}

	exotic := &s.MetricModel.ExoticStressSource
	exotic.Type = strings.ToLower(strings.TrimSpace(exotic.Type))
	if exotic.Type != "" {
		switch exotic.Type {
		case "vacuum_casimir", "negative_energy", "dark_matter", "none", "debug_exotic":
		default:
			return fmt.Errorf("metric_model.exotic_stress_source.type is unsupported")
		}
		if exotic.ConversionEfficiency == 0 {
			exotic.ConversionEfficiency = 1
		}
		if exotic.ConversionEfficiency <= 0 || exotic.ConversionEfficiency > 1 {
			return fmt.Errorf("metric_model.exotic_stress_source.conversion_efficiency must be in (0,1]")
		}
	}

	conv := &s.MetricModel.ConversionEfficiency
	conv.Type = strings.ToLower(strings.TrimSpace(conv.Type))
	if conv.Type == "" {
		conv.Type = "explicit"
	}
	if conv.Efficiency == 0 {
		conv.Efficiency = 1
	}
	if conv.MetricCouplingFactor == 0 {
		conv.MetricCouplingFactor = 1
	}
	if conv.Efficiency <= 0 || conv.Efficiency > 1 || conv.MetricCouplingFactor <= 0 {
		return fmt.Errorf("metric_model.conversion_efficiency values are invalid")
	}
	return nil
}

func abs(v float64) float64 {
	if v < 0 {
		return -v
	}
	return v
}

func normalizeShipType(ship string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(ship)) {
	case "saucer":
		return "saucer", true
	case "sphere":
		return "sphere", true
	case "egg":
		return "egg", true
	case "pyramid":
		return "pyramid", true
	case "flat_triangle", "flat-triangle", "flat triangle", "triangle", "delta":
		return "flat_triangle", true
	default:
		return "", false
	}
}

func (s Scenario) BodiesRuntime() []physics.CelestialBody {
	out := make([]physics.CelestialBody, 0, len(s.Bodies))
	for _, b := range s.Bodies {
		out = append(out, physics.CelestialBody{
			Name:     b.Name,
			Mass:     b.Mass,
			Radius:   b.Radius,
			Position: v3(b.Position),
			Velocity: v3(b.Velocity),
		})
	}
	return out
}

func (s Scenario) CraftRuntime() physics.Craft {
	q := mathx.Quat{W: s.Craft.Orientation[0], X: s.Craft.Orientation[1], Y: s.Craft.Orientation[2], Z: s.Craft.Orientation[3]}
	if q.W == 0 && q.X == 0 && q.Y == 0 && q.Z == 0 {
		q = mathx.IdentityQuat()
	}
	return physics.Craft{
		Mass:            s.Craft.Mass,
		ShipType:        s.Craft.ShipType,
		InertiaDiagonal: v3(s.Craft.InertiaDiagonal),
		Position:        v3(s.Craft.Position),
		Velocity:        v3(s.Craft.Velocity),
		Orientation:     q.Normalize(),
		AngularVelocity: v3(s.Craft.AngularVelocity),
		Drag: physics.DragModel{
			Enabled: s.Craft.Drag.Enabled,
			Cd:      s.Craft.Drag.Cd,
			Area:    s.Craft.Drag.Area,
			Plasma: physics.PlasmaSheath{
				Enabled:          s.Craft.Drag.Plasma.Enabled,
				Level:            s.Craft.Drag.Plasma.Level,
				MaxDragReduction: s.Craft.Drag.Plasma.MaxDragReduction,
				AuthoritySpeed:   s.Craft.Drag.Plasma.AuthoritySpeed,
				VelocityFalloff:  s.Craft.Drag.Plasma.VelocityFalloff,
				PowerPerArea:     s.Craft.Drag.Plasma.PowerPerArea,
				IonizationGain:   s.Craft.Drag.Plasma.IonizationGain,
			},
		},
		Aero: physics.AeroModel{
			Enabled:  s.Craft.Aero.Enabled,
			Cl0:      s.Craft.Aero.Cl0,
			ClAlpha:  s.Craft.Aero.ClAlpha,
			ClMax:    s.Craft.Aero.ClMax,
			StallAoA: s.Craft.Aero.StallAoA,
		},
		Propulsion: physics.PropulsionModel{
			Enabled:   s.Craft.Propulsion.Enabled,
			Throttle:  s.Craft.Propulsion.Throttle,
			MaxThrust: s.Craft.Propulsion.MaxThrust,
		},
		EM: physics.EMModel{
			Enabled: s.Craft.EM.Enabled,
			ChargeC: s.Craft.EM.ChargeC,
		},
		Thermal: physics.ThermalModel{
			Enabled:               s.Craft.Thermal.Enabled,
			HeatTransferCoeff:     s.Craft.Thermal.HeatTransferCoeff,
			RadiativeCoeff:        s.Craft.Thermal.RadiativeCoeff,
			Emissivity:            s.Craft.Thermal.Emissivity,
			MaxSkinTempK:          s.Craft.Thermal.MaxSkinTempK,
			InitialSkinTempK:      s.Craft.Thermal.InitialSkinTempK,
			ReferenceHeatCapacity: s.Craft.Thermal.ReferenceHeatCapacity,
		},
		Structural: physics.StructuralModel{
			Enabled:        s.Craft.Structural.Enabled,
			MaxGLoad:       s.Craft.Structural.MaxGLoad,
			MaxDynamicQPa:  s.Craft.Structural.MaxDynamicQPa,
			MaxHeatFluxWm2: s.Craft.Structural.MaxHeatFluxWm2,
		},
		Pilot: physics.PilotModel{
			Enabled:          s.Craft.Pilot.Enabled,
			MaxGPositive:     s.Craft.Pilot.MaxGPositive,
			MaxGNegative:     s.Craft.Pilot.MaxGNegative,
			MaxGLongitudinal: s.Craft.Pilot.MaxGLongitudinal,
			MaxGLateral:      s.Craft.Pilot.MaxGLateral,
			RecoveryTauS:     s.Craft.Pilot.RecoveryTauS,
		},
	}
}

func (s Scenario) EnvironmentRuntime() physics.Environment {
	return physics.Environment{
		G: s.Environment.G,
		Atmosphere: physics.Atmosphere{
			Enabled:      s.Environment.Atmosphere.Enabled,
			Rho0:         s.Environment.Atmosphere.Rho0,
			ScaleHeight:  s.Environment.Atmosphere.ScaleHeight,
			Wind:         v3(s.Environment.Atmosphere.Wind),
			Temperature0: s.Environment.Atmosphere.Temperature0,
			LapseRate:    s.Environment.Atmosphere.LapseRate,
			Gamma:        s.Environment.Atmosphere.Gamma,
			GasConstant:  s.Environment.Atmosphere.GasConstant,
			Layers:       atmosphereLayersRuntime(s.Environment.Atmosphere.Layers),
		},
		Ground: physics.GroundContact{
			Enabled:      s.Environment.Ground.Enabled,
			BodyIndex:    s.Environment.Ground.BodyIndex,
			Restitution:  s.Environment.Ground.Restitution,
			SurfaceEps:   s.Environment.Ground.SurfaceEps,
			TangentialMu: s.Environment.Ground.TangentialMu,
		},
		EField: v3(s.Environment.EField),
		BField: v3(s.Environment.BField),
	}
}

func atmosphereLayersRuntime(in []AtmosphereLayerConfig) []physics.AtmosphereLayer {
	if len(in) == 0 {
		return nil
	}
	out := make([]physics.AtmosphereLayer, 0, len(in))
	for _, l := range in {
		out = append(out, physics.AtmosphereLayer{
			MinAlt:       l.MinAlt,
			MaxAlt:       l.MaxAlt,
			Rho0:         l.Rho0,
			ScaleHeight:  l.ScaleHeight,
			Temperature0: l.Temperature0,
			LapseRate:    l.LapseRate,
			Gamma:        l.Gamma,
			GasConstant:  l.GasConstant,
		})
	}
	return out
}

func (s Scenario) CouplerRuntime() coupler.Params {
	p := coupler.Params{
		Omega0:             s.Coupler.Omega0,
		Omega0DriftRate:    s.Coupler.Omega0DriftRate,
		Q:                  s.Coupler.Q,
		Beta:               s.Coupler.Beta,
		Alpha:              s.Coupler.Alpha,
		KMax:               s.Coupler.KMax,
		PhiBias:            s.Coupler.PhiBias,
		DefaultC:           s.Coupler.DefaultC,
		PllKp:              s.Coupler.PllKp,
		PllKi:              s.Coupler.PllKi,
		LockOmegaWindow:    s.Coupler.LockOmegaWindow,
		LockCollapse:       s.Coupler.LockCollapse,
		LockRecover:        s.Coupler.LockRecover,
		PowerC1:            s.Coupler.PowerC1,
		PowerC2:            s.Coupler.PowerC2,
		PowerLimit:         s.Coupler.PowerLimit,
		EnergyInitial:      s.Coupler.Energy,
		MinAmplitude:       s.Coupler.MinAmplitude,
		MaxAmplitude:       s.Coupler.MaxAmplitude,
		AmpRate:            s.Coupler.AmpRate,
		ThetaRate:          s.Coupler.ThetaRate,
		MinOmegaBase:       s.Coupler.MinOmegaBase,
		MaxOmegaBase:       s.Coupler.MaxOmegaBase,
		OmegaBaseRate:      s.Coupler.OmegaBaseRate,
		InitialAmplitude:   s.Coupler.InitialAmplitude,
		InitialThetaTarget: s.Coupler.InitialThetaTarget,
		InitialOmegaBase:   s.Coupler.InitialOmegaBase,
		InitialDrivePhase:  s.Coupler.InitialDrivePhase,
		DirectionalEnabled: s.Coupler.DirectionalEnabled,
		FieldAxisBody:      v3(s.Coupler.FieldAxisBody),
		ParallelFactor:     s.Coupler.ParallelFactor,
		PerpFactor:         s.Coupler.PerpFactor,
	}
	if !s.Coupler.Enabled {
		p.EnergyInitial = 0
	}
	return p
}

func (s Scenario) ControllerRuntime() control.HoverControllerConfig {
	return control.HoverControllerConfig{
		Enabled:        s.Controller.Enabled,
		TargetAltitude: s.Controller.TargetAltitude,
		Kp:             s.Controller.Kp,
		Ki:             s.Controller.Ki,
		Kd:             s.Controller.Kd,
		CMin:           s.Controller.CMin,
		CMax:           s.Controller.CMax,
	}
}

func v3(a [3]float64) mathx.Vec3 {
	return mathx.Vec3{X: a[0], Y: a[1], Z: a[2]}
}
