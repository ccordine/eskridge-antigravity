package config

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/example/acs/internal/control"
	"github.com/example/acs/internal/coupler"
	"github.com/example/acs/internal/mathx"
	"github.com/example/acs/internal/physics"
)

type Scenario struct {
	Name        string            `json:"name"`
	Seed        int64             `json:"seed"`
	Dt          float64           `json:"dt"`
	Duration    float64           `json:"duration"`
	LogEvery    int               `json:"log_every"`
	Bodies      []BodyConfig      `json:"bodies"`
	Craft       CraftConfig       `json:"craft"`
	Environment EnvironmentConfig `json:"environment"`
	Coupler     CouplerConfig     `json:"coupler"`
	Controller  ControllerConfig  `json:"controller"`
}

type BodyConfig struct {
	Name     string     `json:"name"`
	Mass     float64    `json:"mass"`
	Radius   float64    `json:"radius"`
	Position [3]float64 `json:"position"`
	Velocity [3]float64 `json:"velocity"`
}

type CraftConfig struct {
	Mass            float64    `json:"mass"`
	InertiaDiagonal [3]float64 `json:"inertia_diagonal"`
	Position        [3]float64 `json:"position"`
	Velocity        [3]float64 `json:"velocity"`
	Orientation     [4]float64 `json:"orientation"`
	AngularVelocity [3]float64 `json:"angular_velocity"`
	Drag            DragConfig `json:"drag"`
}

type DragConfig struct {
	Enabled bool    `json:"enabled"`
	Cd      float64 `json:"cd"`
	Area    float64 `json:"area"`
}

type EnvironmentConfig struct {
	G              float64          `json:"g"`
	PrimaryBodyIdx int              `json:"primary_body_index"`
	Atmosphere     AtmosphereConfig `json:"atmosphere"`
	Ground         GroundConfig     `json:"ground"`
}

type AtmosphereConfig struct {
	Enabled     bool       `json:"enabled"`
	Rho0        float64    `json:"rho0"`
	ScaleHeight float64    `json:"scale_height"`
	Wind        [3]float64 `json:"wind"`
}

type GroundConfig struct {
	Enabled      bool    `json:"enabled"`
	BodyIndex    int     `json:"body_index"`
	Restitution  float64 `json:"restitution"`
	SurfaceEps   float64 `json:"surface_eps"`
	TangentialMu float64 `json:"tangential_mu"`
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

func (s Scenario) Validate() error {
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
	if s.Environment.G == 0 {
		return fmt.Errorf("environment.g must be non-zero")
	}
	if s.Environment.PrimaryBodyIdx < 0 || s.Environment.PrimaryBodyIdx >= len(s.Bodies) {
		return fmt.Errorf("environment.primary_body_index out of range")
	}
	if s.LogEvery <= 0 {
		s.LogEvery = 1
	}
	return nil
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
		InertiaDiagonal: v3(s.Craft.InertiaDiagonal),
		Position:        v3(s.Craft.Position),
		Velocity:        v3(s.Craft.Velocity),
		Orientation:     q.Normalize(),
		AngularVelocity: v3(s.Craft.AngularVelocity),
		Drag: physics.DragModel{
			Enabled: s.Craft.Drag.Enabled,
			Cd:      s.Craft.Drag.Cd,
			Area:    s.Craft.Drag.Area,
		},
	}
}

func (s Scenario) EnvironmentRuntime() physics.Environment {
	return physics.Environment{
		G: s.Environment.G,
		Atmosphere: physics.Atmosphere{
			Enabled:     s.Environment.Atmosphere.Enabled,
			Rho0:        s.Environment.Atmosphere.Rho0,
			ScaleHeight: s.Environment.Atmosphere.ScaleHeight,
			Wind:        v3(s.Environment.Atmosphere.Wind),
		},
		Ground: physics.GroundContact{
			Enabled:      s.Environment.Ground.Enabled,
			BodyIndex:    s.Environment.Ground.BodyIndex,
			Restitution:  s.Environment.Ground.Restitution,
			SurfaceEps:   s.Environment.Ground.SurfaceEps,
			TangentialMu: s.Environment.Ground.TangentialMu,
		},
	}
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
