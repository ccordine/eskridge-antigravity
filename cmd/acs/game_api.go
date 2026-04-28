package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"math/cmplx"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/example/acs/internal/config"
	"github.com/example/acs/internal/coupler"
	"github.com/example/acs/internal/energy"
	"github.com/example/acs/internal/mathx"
	"github.com/example/acs/internal/physics"
)

const (
	gameSessionTTL         = 30 * time.Minute
	gameSessionMaxCount    = 64
	gameMaxStepsPerRequest = 240
	gameCraftScaleMin      = 1.0
	gameCraftScaleMax      = 6.0
	gameCraftLazarSpanM    = 15.8
	gameDirectionalPerpMix = 0.22
	gameWarpAmpMax         = 100000.0
	gameWarpKMax           = 1000.0
	gameWarpAmpRateMin     = 9.0
	gameWarpThetaRateMin   = 10.0
	gameOscOmegaMin        = 10.0
	gameOscOmegaMax        = 400.0
	gameOscQMin            = 1.0
	gameOscQMax            = 3000.0
	gameOscBetaMin         = 0.0
	gameOscBetaMax         = 30.0
	gamePlasmaMin          = 0.0
	gamePlasmaMax          = 1.0
	gameYawAxisRate        = 3.6
	gamePitchAxisRate      = 3.2
	gameInitialAxisYaw     = 0.0
	gameInitialAxisPitch   = 0.0
	gameAttitudeAlignRate  = 3.2
	gameInfiniteEnergyJ    = 1e18
	gameBigG               = 6.67430e-11
	earthMoonDistanceM     = 384_400_000.0
	auMeters               = 149_597_870_700.0
)

type gamePlanetPreset struct {
	Name              string
	Mass              float64
	Radius            float64
	AtmosphereEnabled bool
	AtmosphereRho0    float64
	AtmosphereScaleH  float64
	AtmosphereT0      float64
	AtmosphereLapse   float64
	AtmosphereGamma   float64
	AtmosphereR       float64
	MagFieldTeslaEq   float64
}

var gamePlanetPresets = map[string]gamePlanetPreset{
	"earth": {
		Name:              "earth",
		Mass:              5.972e24,
		Radius:            6_371_000,
		AtmosphereEnabled: true,
		AtmosphereRho0:    1.225,
		AtmosphereScaleH:  8_500,
		AtmosphereT0:      288.15,
		AtmosphereLapse:   -0.0065,
		AtmosphereGamma:   1.4,
		AtmosphereR:       287.05,
		MagFieldTeslaEq:   3.12e-5,
	},
	"mercury": {
		Name:              "mercury",
		Mass:              3.3011e23,
		Radius:            2_439_700,
		AtmosphereEnabled: false,
		MagFieldTeslaEq:   3e-7,
	},
	"moon": {
		Name:              "moon",
		Mass:              7.34767309e22,
		Radius:            1_737_400,
		AtmosphereEnabled: false,
		AtmosphereRho0:    0,
		AtmosphereScaleH:  0,
		MagFieldTeslaEq:   1e-9,
	},
	"mars": {
		Name:              "mars",
		Mass:              6.4171e23,
		Radius:            3_389_500,
		AtmosphereEnabled: true,
		AtmosphereRho0:    0.020,
		AtmosphereScaleH:  11_100,
		AtmosphereT0:      210.0,
		AtmosphereLapse:   -0.0045,
		AtmosphereGamma:   1.29,
		AtmosphereR:       188.92,
		MagFieldTeslaEq:   2.0e-7,
	},
	"venus": {
		Name:              "venus",
		Mass:              4.8675e24,
		Radius:            6_051_800,
		AtmosphereEnabled: true,
		AtmosphereRho0:    65.0,
		AtmosphereScaleH:  15_900,
		AtmosphereT0:      737.0,
		AtmosphereLapse:   -0.0080,
		AtmosphereGamma:   1.30,
		AtmosphereR:       188.92,
		MagFieldTeslaEq:   1.0e-8,
	},
	"titan": {
		Name:              "titan",
		Mass:              1.3452e23,
		Radius:            2_574_730,
		AtmosphereEnabled: true,
		AtmosphereRho0:    5.30,
		AtmosphereScaleH:  20_000,
		AtmosphereT0:      94.0,
		AtmosphereLapse:   -0.0010,
		AtmosphereGamma:   1.40,
		AtmosphereR:       296.8,
		MagFieldTeslaEq:   3e-8,
	},
	"jupiter": {
		Name:              "jupiter",
		Mass:              1.8982e27,
		Radius:            69_911_000,
		AtmosphereEnabled: true,
		AtmosphereRho0:    0.16,
		AtmosphereScaleH:  27_000,
		AtmosphereT0:      165.0,
		AtmosphereLapse:   -0.0020,
		AtmosphereGamma:   1.40,
		AtmosphereR:       3600.0,
		MagFieldTeslaEq:   4.2e-4,
	},
	"neptune": {
		Name:              "neptune",
		Mass:              1.02413e26,
		Radius:            24_622_000,
		AtmosphereEnabled: true,
		AtmosphereRho0:    0.45,
		AtmosphereScaleH:  20_000,
		AtmosphereT0:      72.0,
		AtmosphereLapse:   -0.0010,
		AtmosphereGamma:   1.40,
		AtmosphereR:       3600.0,
		MagFieldTeslaEq:   1.4e-5,
	},
}

type gameStartRequest struct {
	Scenario      string  `json:"scenario"`
	StartOnGround bool    `json:"start_on_ground"`
	ShipType      string  `json:"ship_type,omitempty"`
	WarpDrive     string  `json:"warp_drive,omitempty"`
	PlanetPreset  string  `json:"planet_preset,omitempty"`
	CraftScale    float64 `json:"craft_scale,omitempty"`
}

type gameControlInput struct {
	AmpAxis          float64 `json:"amp_axis"`
	PhiAxis          float64 `json:"phi_axis"`
	YawAxis          float64 `json:"yaw_axis"`
	PitchAxis        float64 `json:"pitch_axis"`
	HoldAmpLock      bool    `json:"hold_amp_lock,omitempty"`
	HoldPhiLock      bool    `json:"hold_phi_lock,omitempty"`
	HoldYawLock      bool    `json:"hold_yaw_lock,omitempty"`
	HoldPitchLock    bool    `json:"hold_pitch_lock,omitempty"`
	OmegaTarget      float64 `json:"omega_target,omitempty"`
	QTarget          float64 `json:"q_target,omitempty"`
	BetaTarget       float64 `json:"beta_target,omitempty"`
	PlasmaTarget     float64 `json:"plasma_target,omitempty"`
	ThrottleTarget   float64 `json:"throttle_target,omitempty"`
	EMChargeTarget   float64 `json:"em_charge_target,omitempty"`
	EFieldTarget     float64 `json:"e_field_target,omitempty"`
	BFieldTarget     float64 `json:"b_field_target,omitempty"`
	LockAssist       *bool   `json:"lock_assist,omitempty"`
	AutoTrim         bool    `json:"auto_trim,omitempty"`
	AssistGoal       string  `json:"assist_goal,omitempty"`
	AutoWeight       float64 `json:"auto_weight,omitempty"`
	AutoVertical     float64 `json:"auto_vertical,omitempty"`
	AutoAltitude     float64 `json:"auto_altitude,omitempty"`
	AssistSpeedCap   float64 `json:"assist_speed_cap,omitempty"`
	AssistBrakeGain  float64 `json:"assist_brake_gain,omitempty"`
	NavMaxSpeed      float64 `json:"nav_max_speed,omitempty"`
	NavStopRadius    float64 `json:"nav_stop_radius,omitempty"`
	NavTopActive     bool    `json:"nav_top_active,omitempty"`
	NavTopGoalX      float64 `json:"nav_top_goal_x,omitempty"`
	NavTopGoalY      float64 `json:"nav_top_goal_y,omitempty"`
	NavTopGoalZ      float64 `json:"nav_top_goal_z,omitempty"`
	NavTopGoalMode   string  `json:"nav_top_goal_mode,omitempty"`
	NavProfileActive bool    `json:"nav_profile_active,omitempty"`
}

type gameStepRequest struct {
	SessionID string           `json:"session_id"`
	Steps     int              `json:"steps"`
	Controls  gameControlInput `json:"controls"`
}

type gameStopRequest struct {
	SessionID string `json:"session_id"`
}

type gameStartResponse struct {
	SessionID    string        `json:"session_id"`
	Scenario     string        `json:"scenario"`
	Dt           float64       `json:"dt"`
	GravityModel string        `json:"gravity_model"`
	WarpDrive    string        `json:"warp_drive"`
	State        gameStepState `json:"state"`
}

type gameStepResponse struct {
	State gameStepState `json:"state"`
}

type gameStopResponse struct {
	Removed bool `json:"removed"`
}

type gameCalibrationItem struct {
	Preset            string  `json:"preset"`
	Mass              float64 `json:"mass"`
	Radius            float64 `json:"radius"`
	SurfaceG          float64 `json:"surface_g"`
	AtmosphereEnabled bool    `json:"atmosphere_enabled"`
	Rho0              float64 `json:"rho0"`
	ScaleHeight       float64 `json:"scale_height"`
	MagField          float64 `json:"mag_field_t"`
}

type gameCalibrationResponse struct {
	Items []gameCalibrationItem `json:"items"`
}

type gameStepState struct {
	Step int     `json:"step"`
	Time float64 `json:"time"`
	Dt   float64 `json:"dt"`

	CraftMass    float64 `json:"craft_mass"`
	CraftScale   float64 `json:"craft_scale"`
	CraftSpanM   float64 `json:"craft_span_m"`
	OrientationW float64 `json:"orientation_w"`
	OrientationX float64 `json:"orientation_x"`
	OrientationY float64 `json:"orientation_y"`
	OrientationZ float64 `json:"orientation_z"`
	AngularVelX  float64 `json:"angular_vel_x"`
	AngularVelY  float64 `json:"angular_vel_y"`
	AngularVelZ  float64 `json:"angular_vel_z"`

	Position        mathx.Vec3 `json:"position"`
	Velocity        mathx.Vec3 `json:"velocity"`
	Speed           float64    `json:"speed"`
	Altitude        float64    `json:"altitude"`
	VerticalVel     float64    `json:"vertical_vel"`
	LocalUpX        float64    `json:"local_up_x"`
	LocalUpY        float64    `json:"local_up_y"`
	LocalUpZ        float64    `json:"local_up_z"`
	PrimaryName     string     `json:"primary_name"`
	PrimaryMass     float64    `json:"primary_mass"`
	PrimaryPosition mathx.Vec3 `json:"primary_position"`
	PrimaryRadius   float64    `json:"primary_radius"`

	GRaw              mathx.Vec3 `json:"g_raw"`
	GRawMag           float64    `json:"g_raw_mag"`
	EffectiveG        mathx.Vec3 `json:"effective_g"`
	EffectiveGMag     float64    `json:"effective_g_mag"`
	GravPower         float64    `json:"grav_power"`
	GravityModel      string     `json:"gravity_model"`
	CouplerEnabled    bool       `json:"coupler_enabled"`
	ShipType          string     `json:"ship_type"`
	WarpDrive         string     `json:"warp_drive"`
	AtmosphereEnabled bool       `json:"atmosphere_enabled"`
	AtmosphereRho0    float64    `json:"atmosphere_rho0"`
	AtmosphereScaleH  float64    `json:"atmosphere_scale_height"`
	AtmosphereT0      float64    `json:"atmosphere_temperature0"`
	AtmosphereLapse   float64    `json:"atmosphere_lapse_rate"`
	AtmosphereGamma   float64    `json:"atmosphere_gamma"`
	AtmosphereR       float64    `json:"atmosphere_gas_constant"`

	CouplingC       float64 `json:"coupling_c"`
	CouplingK       float64 `json:"coupling_k"`
	CouplingPhi     float64 `json:"coupling_phi"`
	ResonatorQ      float64 `json:"resonator_q"`
	ResonatorBeta   float64 `json:"resonator_beta"`
	ResonatorOmega0 float64 `json:"resonator_omega0"`

	PhaseError        float64 `json:"phase_error"`
	LockQuality       float64 `json:"lock_quality"`
	LockFlag          bool    `json:"lock_flag"`
	DriveAmp          float64 `json:"drive_amp"`
	OmegaBase         float64 `json:"omega_base"`
	DriveOmega        float64 `json:"drive_omega"`
	DrivePhase        float64 `json:"drive_phase"`
	PLLFreqDelta      float64 `json:"pll_freq_delta"`
	OscMag            float64 `json:"osc_mag"`
	DrivePower        float64 `json:"drive_power"`
	PlasmaPower       float64 `json:"plasma_power"`
	Energy            float64 `json:"energy"`
	DragForceMag      float64 `json:"drag_force_mag"`
	DragPower         float64 `json:"drag_power"`
	ThrustPower       float64 `json:"thrust_power"`
	EMPower           float64 `json:"em_power"`
	ClimbPower        float64 `json:"climb_power"`
	RequiredPower     float64 `json:"required_power"`
	PowerReqCoupler   float64 `json:"power_req_coupler"`
	PowerReqPlasma    float64 `json:"power_req_plasma"`
	PowerReqThrust    float64 `json:"power_req_thrust"`
	PowerReqEM        float64 `json:"power_req_em"`
	PowerGrantCoupler float64 `json:"power_grant_coupler"`
	PowerGrantPlasma  float64 `json:"power_grant_plasma"`
	PowerGrantThrust  float64 `json:"power_grant_thrust"`
	PowerGrantEM      float64 `json:"power_grant_em"`
	PowerCurtailFrac  float64 `json:"power_curtail_frac"`
	EnergyPool        float64 `json:"energy_pool"`
	DragCdEff         float64 `json:"drag_cd_eff"`
	DragAreaRef       float64 `json:"drag_area_ref"`
	PlasmaReduction   float64 `json:"plasma_drag_reduction"`
	LiftForceMag      float64 `json:"lift_force_mag"`
	ThrustForceMag    float64 `json:"thrust_force_mag"`
	EMForceMag        float64 `json:"em_force_mag"`
	Mach              float64 `json:"mach"`
	AoA               float64 `json:"aoa_rad"`
	LiftCoeff         float64 `json:"lift_coeff"`
	GLoad             float64 `json:"g_load"`
	DynamicPressure   float64 `json:"dynamic_pressure"`
	HeatFlux          float64 `json:"heat_flux"`
	SkinTempK         float64 `json:"skin_temp_k"`
	StructOK          bool    `json:"struct_ok"`
	PilotOK           bool    `json:"pilot_ok"`
	WarningFlags      string  `json:"warning_flags"`
	PilotStress       float64 `json:"pilot_stress"`
	StructFatigue     float64 `json:"struct_fatigue"`
	GAxisLong         float64 `json:"g_axis_long"`
	GAxisLat          float64 `json:"g_axis_lat"`
	GAxisVert         float64 `json:"g_axis_vert"`
	RelGamma          float64 `json:"rel_gamma"`
	RelBeta           float64 `json:"rel_beta"`

	YukawaAlpha            float64 `json:"yukawa_alpha"`
	YukawaLambda           float64 `json:"yukawa_lambda"`
	YukawaRepulsionPrimary float64 `json:"yukawa_repulsion_primary"`
	YukawaKernelPrimary    float64 `json:"yukawa_kernel_primary"`

	NegMassConvention      string  `json:"negmass_convention"`
	QGCraft                float64 `json:"qg_craft"`
	QGCraftBase            float64 `json:"qg_craft_base"`
	QGCraftDynamicTerm     float64 `json:"qg_craft_dynamic_term"`
	QGAuthority            float64 `json:"qg_authority"`
	QGPrimary              float64 `json:"qg_primary"`
	InertialMassSign       float64 `json:"inertial_mass_sign"`
	RunawayAccelMag        float64 `json:"runaway_accel_mag"`
	RunawayAccelLimit      float64 `json:"runaway_accel_limit"`
	RunawayFlag            bool    `json:"runaway_flag"`
	RunawayExpectedUnderC2 bool    `json:"runaway_expected_c2"`
	EffectiveInertialMass  float64 `json:"effective_inertial_mass"`
	EffectiveInertialScale float64 `json:"effective_inertial_scale"`
	ChargeRegime           string  `json:"charge_regime"`

	ControlAmpTarget      float64 `json:"control_amp_target"`
	ControlThetaTarget    float64 `json:"control_theta_target"`
	ControlOmegaTarget    float64 `json:"control_omega_target"`
	ControlQTarget        float64 `json:"control_q_target"`
	ControlBetaTarget     float64 `json:"control_beta_target"`
	ControlPlasmaTarget   float64 `json:"control_plasma_target"`
	ControlThrottleTarget float64 `json:"control_throttle_target"`
	ControlThrottleApplied float64 `json:"control_throttle_applied"`
	ControlEMChargeTarget float64 `json:"control_em_charge_target"`
	ControlEFieldTarget   float64 `json:"control_e_field_target"`
	ControlBFieldTarget   float64 `json:"control_b_field_target"`
	ControlAxisYaw        float64 `json:"control_axis_yaw"`
	ControlAxisPitch      float64 `json:"control_axis_pitch"`
	ControlWarpX          float64 `json:"control_warp_x"`
	ControlWarpY          float64 `json:"control_warp_y"`
	ControlWarpZ          float64 `json:"control_warp_z"`
	ControlLockAssist     bool    `json:"control_lock_assist"`
	ControlAmpAxis        float64 `json:"control_amp_axis"`
	ControlPhiAxis        float64 `json:"control_phi_axis"`
	ControlYawAxis        float64 `json:"control_yaw_axis"`
	ControlPitchAxis      float64 `json:"control_pitch_axis"`
	AssistPhase           string  `json:"assist_phase"`
	NavDistance           float64 `json:"nav_distance"`
	NavVAlong             float64 `json:"nav_v_along"`
	CoastCapture          bool    `json:"coast_capture"`
	NavTopReached         bool    `json:"nav_top_reached"`
	NavProfileReached     bool    `json:"nav_profile_reached"`
}

type gameControlState struct {
	AmpTarget      float64
	ThetaTarget    float64
	OmegaTarget    float64
	QTarget        float64
	BetaTarget     float64
	PlasmaTarget   float64
	ThrottleTarget float64
	EMChargeTarget float64
	EFieldTarget   float64
	BFieldTarget   float64
	AxisYaw        float64
	AxisPitch      float64
	LockAssist     bool
	AmpAxis        float64
	PhiAxis        float64
	YawAxis        float64
	PitchAxis      float64
}

type gameControlLimits struct {
	AmpAxisRate       float64
	PhiAxisRate       float64
	YawAxisRate       float64
	PitchAxisRate     float64
	MinThetaTarget    float64
	MaxThetaTarget    float64
	MinOmegaTarget    float64
	MaxOmegaTarget    float64
	MinQTarget        float64
	MaxQTarget        float64
	MinBetaTarget     float64
	MaxBetaTarget     float64
	MinPlasmaTarget   float64
	MaxPlasmaTarget   float64
	MinThrottleTarget float64
	MaxThrottleTarget float64
	MinEMChargeTarget float64
	MaxEMChargeTarget float64
	MinEFieldTarget   float64
	MaxEFieldTarget   float64
	MinBFieldTarget   float64
	MaxBFieldTarget   float64
	MinAxisPitch      float64
	MaxAxisPitch      float64
}

type gameGravityEval struct {
	raw          mathx.Vec3
	effective    mathx.Vec3
	gravityModel string

	yukawaRepulsionPrimary float64
	yukawaKernelPrimary    float64

	negMassConvention      string
	qgCraft                float64
	qgCraftBase            float64
	qgCraftDynamicTerm     float64
	qgAuthority            float64
	qgPrimary              float64
	inertialMassSign       float64
	runawayAccelMag        float64
	runawayAccelLimit      float64
	runawayFlag            bool
	runawayExpectedUnderC2 bool
}

type gameCouplingState struct {
	QGCraft        float64
	QGBase         float64
	QGDynamicTerm  float64
	QGAuthority    float64
	InertialMass   float64
	InertialScale  float64
	InertialSign   float64
	Regime         string
}

type gameSession struct {
	mu sync.Mutex

	id           string
	scenarioPath string
	scenarioName string
	createdAt    time.Time
	updatedAt    time.Time

	dt      float64
	step    int
	simTime float64

	bodies     []physics.CelestialBody
	craft      physics.Craft
	env        physics.Environment
	primaryIdx int

	couplerState   *coupler.State
	couplerEnabled bool
	basePllKp      float64
	basePllKi      float64

	gravityModel string
	warpDrive    string
	yukawaAlpha  float64
	yukawaLambda float64

	negMassConvention   string
	negMassQGCraft      float64
	negMassRunawayLimit float64
	negMassOverrides    map[string]float64
	qgDynamicState      float64
	qgAuthorityState    float64
	couplingStep        gameCouplingState
	bodyIntegrator      string
	bodySubsteps        int

	controls          gameControlState
	limits            gameControlLimits
	assistPhase       string
	navDistance       float64
	navVAlong         float64
	coastCapture      bool
	navTopReached     bool
	navProfileReached bool
	navProfilePrevErr float64
	navProfileWasOn   bool
	craftScale        float64
	skinTempK         float64
	pilotStress       float64
	structFatigue     float64
	lastEnergyBus     gameEnergyBus
}

type gameEnergyBus struct {
	ReqCouplerW   float64
	ReqPlasmaW    float64
	ReqThrustW    float64
	ReqEMW        float64
	GrantCouplerW float64
	GrantPlasmaW  float64
	GrantThrustW  float64
	GrantEMW      float64
	CurtailFrac   float64
}

func (s *paperServer) handleGameStart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req gameStartRequest
	if err := decodeJSONBody(r, &req); err != nil {
		http.Error(w, "invalid JSON request", http.StatusBadRequest)
		return
	}

	cfgPath, cfg, err := s.resolveScenario(req.Scenario)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	sessionID, err := newGameSessionID()
	if err != nil {
		http.Error(w, "failed to allocate session", http.StatusInternalServerError)
		return
	}

	session, err := newGameSession(sessionID, cfgPath, cfg, req.StartOnGround, req.ShipType, req.WarpDrive, req.PlanetPreset, req.CraftScale)
	if err != nil {
		http.Error(w, "failed to initialize session", http.StatusInternalServerError)
		return
	}

	state, err := session.State()
	if err != nil {
		http.Error(w, "failed to initialize session state", http.StatusInternalServerError)
		return
	}

	s.gameMu.Lock()
	s.pruneGameSessionsLocked(time.Now().UTC())
	s.gameSessions[sessionID] = session
	s.gameMu.Unlock()

	writeJSON(w, http.StatusOK, gameStartResponse{
		SessionID:    sessionID,
		Scenario:     cfg.Name,
		Dt:           cfg.Dt,
		GravityModel: session.gravityModel,
		WarpDrive:    session.warpDrive,
		State:        state,
	})
}

func (s *paperServer) handleGameStep(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req gameStepRequest
	if err := decodeJSONBody(r, &req); err != nil {
		http.Error(w, "invalid JSON request", http.StatusBadRequest)
		return
	}
	req.SessionID = strings.TrimSpace(req.SessionID)
	if req.SessionID == "" {
		http.Error(w, "session_id is required", http.StatusBadRequest)
		return
	}
	if req.Steps <= 0 {
		req.Steps = 1
	}

	s.gameMu.Lock()
	s.pruneGameSessionsLocked(time.Now().UTC())
	session := s.gameSessions[req.SessionID]
	s.gameMu.Unlock()
	if session == nil {
		http.Error(w, "unknown or expired session", http.StatusNotFound)
		return
	}

	state, err := session.Step(req.Steps, req.Controls)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, gameStepResponse{State: state})
}

func (s *paperServer) handleGameStop(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req gameStopRequest
	_ = decodeJSONBody(r, &req)
	sessionID := strings.TrimSpace(req.SessionID)
	if sessionID == "" {
		sessionID = strings.TrimSpace(r.URL.Query().Get("session_id"))
	}
	if sessionID == "" {
		http.Error(w, "session_id is required", http.StatusBadRequest)
		return
	}

	removed := false
	s.gameMu.Lock()
	if _, ok := s.gameSessions[sessionID]; ok {
		delete(s.gameSessions, sessionID)
		removed = true
	}
	s.gameMu.Unlock()

	writeJSON(w, http.StatusOK, gameStopResponse{Removed: removed})
}

func (s *paperServer) handleGameCalibration(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	keys := make([]string, 0, len(gamePlanetPresets))
	for k := range gamePlanetPresets {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	out := make([]gameCalibrationItem, 0, len(keys))
	for _, k := range keys {
		p := gamePlanetPresets[k]
		g := 0.0
		if p.Radius > 0 {
			g = gameBigG * p.Mass / (p.Radius * p.Radius)
		}
		out = append(out, gameCalibrationItem{
			Preset:            k,
			Mass:              p.Mass,
			Radius:            p.Radius,
			SurfaceG:          g,
			AtmosphereEnabled: p.AtmosphereEnabled,
			Rho0:              p.AtmosphereRho0,
			ScaleHeight:       p.AtmosphereScaleH,
			MagField:          p.MagFieldTeslaEq,
		})
	}
	writeJSON(w, http.StatusOK, gameCalibrationResponse{Items: out})
}

func (s *paperServer) pruneGameSessionsLocked(now time.Time) {
	for id, sess := range s.gameSessions {
		if now.Sub(sess.LastUpdated()) > gameSessionTTL {
			delete(s.gameSessions, id)
		}
	}

	for len(s.gameSessions) > gameSessionMaxCount {
		var oldestID string
		var oldest time.Time
		for id, sess := range s.gameSessions {
			updated := sess.LastUpdated()
			if oldestID == "" || updated.Before(oldest) {
				oldestID = id
				oldest = updated
			}
		}
		if oldestID == "" {
			return
		}
		delete(s.gameSessions, oldestID)
	}
}

func decodeJSONBody(r *http.Request, dst any) error {
	if r == nil || dst == nil {
		return nil
	}
	if r.Body == nil {
		return nil
	}

	dec := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		if errors.Is(err, io.EOF) {
			return nil
		}
		return err
	}
	return nil
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func newGameSessionID() (string, error) {
	var b [12]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(b[:]), nil
}

func newGameSession(id, cfgPath string, cfg config.Scenario, startOnGround bool, shipTypeOverride, warpDriveOverride, planetPresetOverride string, craftScaleOverride float64) (*gameSession, error) {
	if err := cfg.Validate(); err != nil {
		return nil, err
	}

	gravityModel := "coupling"
	warpDrive := normalizedWarpDriveSelection(warpDriveOverride)

	couplerState := coupler.New(cfg.CouplerRuntime())
	couplerEnabled := cfg.Coupler.Enabled && gravityModel == "coupling"
	switch warpDrive {
	case "resonant_pll", "geodesic", "inertial_gradient", "plasma_mhd", "alcubierre_ag":
		gravityModel = "coupling"
		couplerEnabled = true
	default:
		warpDrive = "resonant_pll"
		gravityModel = "coupling"
		couplerEnabled = true
	}
	if !couplerEnabled {
		couplerState.C = 1.0
		couplerState.K = 0.0
		couplerState.LockQuality = 0.0
		couplerState.Energy = 0.0
		couplerState.DrivePower = 0.0
	}

	axisYaw := gameInitialAxisYaw
	axisPitch := gameInitialAxisPitch

	if couplerEnabled {
		couplerState.Params.DirectionalEnabled = true
		couplerState.Params.FieldAxisBody = mathx.Vec3{Z: 1}
		couplerState.Params.PowerLimit = 0
		couplerState.Params.EnergyInitial = gameInfiniteEnergyJ
		couplerState.Energy = gameInfiniteEnergyJ
		if couplerState.Params.MaxAmplitude < gameWarpAmpMax {
			couplerState.Params.MaxAmplitude = gameWarpAmpMax
		}
		if couplerState.Params.KMax < gameWarpKMax {
			couplerState.Params.KMax = gameWarpKMax
		}
		if couplerState.Params.AmpRate < gameWarpAmpRateMin {
			couplerState.Params.AmpRate = gameWarpAmpRateMin
		}
		if couplerState.Params.ThetaRate < gameWarpThetaRateMin {
			couplerState.Params.ThetaRate = gameWarpThetaRateMin
		}
		// In game mode, if parallel/perp gains are identical then yaw/pitch steering
		// has no directional authority (proj+perp == full gravity vector). Ensure
		// a non-trivial anisotropy so warp orientation can induce lateral fall/drift.
		if math.Abs(couplerState.Params.ParallelFactor-couplerState.Params.PerpFactor) <= 1e-9 {
			if couplerState.Params.ParallelFactor == 0 {
				couplerState.Params.ParallelFactor = 1.0
			}
			couplerState.Params.PerpFactor = couplerState.Params.ParallelFactor * gameDirectionalPerpMix
		}
		applyWarpDriveProfile(couplerState, warpDrive)
	}

	ampAxisRate := couplerState.Params.AmpRate
	if ampAxisRate <= 0 {
		ampAxisRate = 2.5
	}
	phiAxisRate := couplerState.Params.ThetaRate
	if phiAxisRate <= 0 {
		phiAxisRate = 3.0
	}
	yawAxisRate := gameYawAxisRate
	pitchAxisRate := gamePitchAxisRate
	minThetaTarget := -math.Pi
	maxThetaTarget := math.Pi
	minOmegaTarget := gameOscOmegaMin
	maxOmegaTarget := gameOscOmegaMax
	minQTarget := gameOscQMin
	maxQTarget := gameOscQMax
	minBetaTarget := gameOscBetaMin
	maxBetaTarget := gameOscBetaMax
	minAxisPitch := -1.53
	maxAxisPitch := 1.53
	plasmaStart := mathx.Clamp(cfg.Craft.Drag.Plasma.Level, gamePlasmaMin, gamePlasmaMax)
	if warpDrive == "plasma_mhd" && plasmaStart < 0.45 {
		plasmaStart = 0.45
	}

	negMassConvention := strings.ToUpper(strings.TrimSpace(cfg.GravityModel.NegMass.Convention))
	if negMassConvention != "C1" && negMassConvention != "C2" {
		negMassConvention = "C1"
	}
	negMassQGCraft := cfg.GravityModel.NegMass.QGCraft
	if negMassQGCraft == 0 {
		negMassQGCraft = 1
	}
	negMassRunawayLimit := cfg.GravityModel.NegMass.RunawayAccelLimit
	if negMassRunawayLimit <= 0 {
		negMassRunawayLimit = 1e6
	}

	now := time.Now().UTC()
	session := &gameSession{
		id:                  id,
		scenarioPath:        cfgPath,
		scenarioName:        cfg.Name,
		createdAt:           now,
		updatedAt:           now,
		dt:                  cfg.Dt,
		bodies:              cfg.BodiesRuntime(),
		craft:               cfg.CraftRuntime(),
		env:                 cfg.EnvironmentRuntime(),
		primaryIdx:          cfg.Environment.PrimaryBodyIdx,
		couplerState:        couplerState,
		couplerEnabled:      couplerEnabled,
		basePllKp:           couplerState.Params.PllKp,
		basePllKi:           couplerState.Params.PllKi,
		gravityModel:        gravityModel,
		warpDrive:           warpDrive,
		yukawaAlpha:         cfg.GravityModel.Yukawa.Alpha,
		yukawaLambda:        cfg.GravityModel.Yukawa.Lambda,
		negMassConvention:   negMassConvention,
		negMassQGCraft:      negMassQGCraft,
		negMassRunawayLimit: negMassRunawayLimit,
		negMassOverrides:    copyChargeOverrides(cfg.GravityModel.NegMass.QGOverrides),
		qgDynamicState:      0,
		qgAuthorityState:    0,
		bodyIntegrator:      "semi_implicit",
		bodySubsteps:        1,
		controls: gameControlState{
			AmpTarget:      couplerState.Cmd.Amplitude,
			ThetaTarget:    couplerState.Cmd.ThetaTarget,
			OmegaTarget:    mathx.Clamp(couplerState.Params.Omega0, minOmegaTarget, maxOmegaTarget),
			QTarget:        mathx.Clamp(couplerState.Params.Q, minQTarget, maxQTarget),
			BetaTarget:     mathx.Clamp(couplerState.Params.Beta, minBetaTarget, maxBetaTarget),
			PlasmaTarget:   plasmaStart,
			ThrottleTarget: 0.0,
			EMChargeTarget: 0.0,
			EFieldTarget:   0.0,
			BFieldTarget:   0.0,
			AxisYaw:        axisYaw,
			AxisPitch:      axisPitch,
			LockAssist:     true,
		},
		limits: gameControlLimits{
			AmpAxisRate:       ampAxisRate,
			PhiAxisRate:       phiAxisRate,
			YawAxisRate:       yawAxisRate,
			PitchAxisRate:     pitchAxisRate,
			MinThetaTarget:    minThetaTarget,
			MaxThetaTarget:    maxThetaTarget,
			MinOmegaTarget:    minOmegaTarget,
			MaxOmegaTarget:    maxOmegaTarget,
			MinQTarget:        minQTarget,
			MaxQTarget:        maxQTarget,
			MinBetaTarget:     minBetaTarget,
			MaxBetaTarget:     maxBetaTarget,
			MinPlasmaTarget:   gamePlasmaMin,
			MaxPlasmaTarget:   gamePlasmaMax,
			MinThrottleTarget: -1.0,
			MaxThrottleTarget: 1.0,
			MinEMChargeTarget: -20000.0,
			MaxEMChargeTarget: 20000.0,
			MinEFieldTarget:   -100000.0,
			MaxEFieldTarget:   100000.0,
			MinBFieldTarget:   -5.0,
			MaxBFieldTarget:   5.0,
			MinAxisPitch:      minAxisPitch,
			MaxAxisPitch:      maxAxisPitch,
		},
		craftScale: gameCraftScaleMin,
	}
	applyPlanetPresetToSession(session, planetPresetOverride)
	if shipType, ok := normalizeShipTypeForGame(shipTypeOverride); ok {
		session.craft.ShipType = shipType
	}
	applyCraftScaleToSession(session, craftScaleOverride)
	ensureGameAerodynamics(session)
	applyWarpDriveControlProfile(session, warpDrive)
	session.skinTempK = session.craft.Thermal.InitialSkinTempK
	if session.skinTempK <= 0 {
		session.skinTempK = 295
	}
	session.pilotStress = 0
	session.structFatigue = 0

	session.controls.AmpTarget = mathx.Clamp(session.controls.AmpTarget, couplerState.Params.MinAmplitude, couplerState.Params.MaxAmplitude)
	session.controls.ThetaTarget = mathx.Clamp(session.controls.ThetaTarget, session.limits.MinThetaTarget, session.limits.MaxThetaTarget)
	session.controls.OmegaTarget = mathx.Clamp(session.controls.OmegaTarget, session.limits.MinOmegaTarget, session.limits.MaxOmegaTarget)
	session.controls.QTarget = mathx.Clamp(session.controls.QTarget, session.limits.MinQTarget, session.limits.MaxQTarget)
	session.controls.BetaTarget = mathx.Clamp(session.controls.BetaTarget, session.limits.MinBetaTarget, session.limits.MaxBetaTarget)
	session.controls.PlasmaTarget = mathx.Clamp(session.controls.PlasmaTarget, session.limits.MinPlasmaTarget, session.limits.MaxPlasmaTarget)
	session.controls.ThrottleTarget = mathx.Clamp(session.controls.ThrottleTarget, session.limits.MinThrottleTarget, session.limits.MaxThrottleTarget)
	session.controls.EMChargeTarget = mathx.Clamp(session.controls.EMChargeTarget, session.limits.MinEMChargeTarget, session.limits.MaxEMChargeTarget)
	session.controls.EFieldTarget = mathx.Clamp(session.controls.EFieldTarget, session.limits.MinEFieldTarget, session.limits.MaxEFieldTarget)
	session.controls.BFieldTarget = mathx.Clamp(session.controls.BFieldTarget, session.limits.MinBFieldTarget, session.limits.MaxBFieldTarget)
	session.controls.AxisPitch = mathx.Clamp(session.controls.AxisPitch, session.limits.MinAxisPitch, session.limits.MaxAxisPitch)
	session.snapCraftAttitudeLocked()
	if startOnGround && session.env.Ground.Enabled {
		session.placeCraftOnGround()
	}
	session.syncWarpAxisLocked()

	return session, nil
}

func normalizedWarpDriveSelection(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "", "standard", "pll", "coupling", "pll_standard", "resonant_pll":
		return "resonant_pll"
	case "high_q_resonant", "high_q", "highq", "resonant":
		return "resonant_pll"
	case "inertial_vector", "vector", "inertial_gradient":
		return "inertial_gradient"
	case "plasma_sheath", "plasmasheath", "sheath", "plasma_mhd":
		return "plasma_mhd"
	case "alcubierre", "alcubierre_ag", "alcubierre-inspired", "alcubierre_inspired", "ag_bubble":
		return "alcubierre_ag"
	case "geodesic":
		return "geodesic"
	case "scenario", "scenario_default", "default":
		return "resonant_pll"
	default:
		return "resonant_pll"
	}
}

func warpDriveForScenario(cfg config.Scenario) string {
	_ = cfg
	return "resonant_pll"
}

func applyWarpDriveProfile(cs *coupler.State, warpDrive string) {
	if cs == nil {
		return
	}
	switch strings.ToLower(strings.TrimSpace(warpDrive)) {
	case "geodesic":
		cs.Params.ParallelFactor = 2.4
		cs.Params.PerpFactor = 0.2
		cs.Params.KMax = math.Max(cs.Params.KMax, 220.0)
		cs.Params.ThetaRate = math.Max(cs.Params.ThetaRate, 12.5)
		cs.Params.AmpRate = math.Max(cs.Params.AmpRate, 10.5)
	case "inertial_gradient":
		cs.Params.ParallelFactor = 3.0
		cs.Params.PerpFactor = 0.05
		cs.Params.KMax = math.Max(cs.Params.KMax, 320.0)
		cs.Params.ThetaRate = math.Max(cs.Params.ThetaRate, 15.0)
		cs.Params.AmpRate = math.Max(cs.Params.AmpRate, 12.0)
	case "plasma_mhd":
		cs.Params.ParallelFactor = 2.0
		cs.Params.PerpFactor = 0.15
		cs.Params.KMax = math.Max(cs.Params.KMax, 180.0)
		cs.Params.ThetaRate = math.Max(cs.Params.ThetaRate, 11.5)
		cs.Params.AmpRate = math.Max(cs.Params.AmpRate, 10.0)
	case "alcubierre_ag":
		cs.Params.ParallelFactor = 3.6
		cs.Params.PerpFactor = 0.03
		cs.Params.KMax = math.Max(cs.Params.KMax, 520.0)
		cs.Params.ThetaRate = math.Max(cs.Params.ThetaRate, 18.0)
		cs.Params.AmpRate = math.Max(cs.Params.AmpRate, 14.0)
	default: // resonant_pll
		cs.Params.ParallelFactor = 1.8
		cs.Params.PerpFactor = 0.25
		cs.Params.KMax = math.Max(cs.Params.KMax, 140.0)
		cs.Params.ThetaRate = math.Max(cs.Params.ThetaRate, 11.0)
		cs.Params.AmpRate = math.Max(cs.Params.AmpRate, 10.0)
	}
}

func applyWarpDriveControlProfile(session *gameSession, warpDrive string) {
	if session == nil {
		return
	}
	// Global neutral defaults.
	session.controls.ThrottleTarget = 0
	session.controls.EMChargeTarget = 0
	session.controls.EFieldTarget = 0
	session.controls.BFieldTarget = 0

	switch strings.ToLower(strings.TrimSpace(warpDrive)) {
	case "geodesic":
		session.controls.QTarget = mathx.Clamp(math.Max(session.controls.QTarget, 220), session.limits.MinQTarget, session.limits.MaxQTarget)
		session.controls.BetaTarget = mathx.Clamp(math.Max(session.controls.BetaTarget, 2.2), session.limits.MinBetaTarget, session.limits.MaxBetaTarget)
		session.controls.PlasmaTarget = mathx.Clamp(math.Max(session.controls.PlasmaTarget, 0.08), session.limits.MinPlasmaTarget, session.limits.MaxPlasmaTarget)
		session.controls.ThrottleTarget = 0.18
		session.controls.EFieldTarget = 1200
	case "inertial_gradient":
		session.controls.QTarget = mathx.Clamp(math.Max(session.controls.QTarget, 320), session.limits.MinQTarget, session.limits.MaxQTarget)
		session.controls.BetaTarget = mathx.Clamp(math.Max(session.controls.BetaTarget, 3.1), session.limits.MinBetaTarget, session.limits.MaxBetaTarget)
		session.controls.PlasmaTarget = mathx.Clamp(math.Max(session.controls.PlasmaTarget, 0.15), session.limits.MinPlasmaTarget, session.limits.MaxPlasmaTarget)
		session.controls.ThrottleTarget = 0.26
		session.controls.EFieldTarget = 2200
		session.controls.BFieldTarget = 0.08
	case "plasma_mhd":
		session.controls.QTarget = mathx.Clamp(math.Max(session.controls.QTarget, 180), session.limits.MinQTarget, session.limits.MaxQTarget)
		session.controls.BetaTarget = mathx.Clamp(math.Max(session.controls.BetaTarget, 2.6), session.limits.MinBetaTarget, session.limits.MaxBetaTarget)
		session.controls.PlasmaTarget = mathx.Clamp(math.Max(session.controls.PlasmaTarget, 0.72), session.limits.MinPlasmaTarget, session.limits.MaxPlasmaTarget)
		session.controls.ThrottleTarget = 0.20
		session.controls.EMChargeTarget = 600
		session.controls.EFieldTarget = 1800
		session.controls.BFieldTarget = 0.12
	case "alcubierre_ag":
		session.controls.QTarget = mathx.Clamp(math.Max(session.controls.QTarget, 420), session.limits.MinQTarget, session.limits.MaxQTarget)
		session.controls.BetaTarget = mathx.Clamp(math.Max(session.controls.BetaTarget, 4.2), session.limits.MinBetaTarget, session.limits.MaxBetaTarget)
		session.controls.PlasmaTarget = mathx.Clamp(math.Max(session.controls.PlasmaTarget, 0.10), session.limits.MinPlasmaTarget, session.limits.MaxPlasmaTarget)
		session.controls.ThrottleTarget = 0.34
		session.controls.EMChargeTarget = 1800
		session.controls.EFieldTarget = 4200
		session.controls.BFieldTarget = 0.22
	default: // resonant_pll
		session.controls.QTarget = mathx.Clamp(math.Max(session.controls.QTarget, 120), session.limits.MinQTarget, session.limits.MaxQTarget)
		session.controls.BetaTarget = mathx.Clamp(math.Max(session.controls.BetaTarget, 1.8), session.limits.MinBetaTarget, session.limits.MaxBetaTarget)
		session.controls.PlasmaTarget = mathx.Clamp(math.Max(session.controls.PlasmaTarget, 0.05), session.limits.MinPlasmaTarget, session.limits.MaxPlasmaTarget)
		session.controls.ThrottleTarget = 0.12
		session.controls.EFieldTarget = 900
	}
	session.controls.ThrottleTarget = mathx.Clamp(session.controls.ThrottleTarget, session.limits.MinThrottleTarget, session.limits.MaxThrottleTarget)
	session.controls.EMChargeTarget = mathx.Clamp(session.controls.EMChargeTarget, session.limits.MinEMChargeTarget, session.limits.MaxEMChargeTarget)
	session.controls.EFieldTarget = mathx.Clamp(session.controls.EFieldTarget, session.limits.MinEFieldTarget, session.limits.MaxEFieldTarget)
	session.controls.BFieldTarget = mathx.Clamp(session.controls.BFieldTarget, session.limits.MinBFieldTarget, session.limits.MaxBFieldTarget)
}

func applyPlanetPresetToSession(session *gameSession, presetRaw string) {
	if session == nil {
		return
	}
	presetKey, ok := normalizePlanetPresetForGame(presetRaw)
	if !ok {
		return
	}
	if presetKey == "earth_moon" {
		applyEarthMoonPresetToSession(session)
		return
	}
	if presetKey == "milky_way" {
		applyMilkyWayPresetToSession(session)
		return
	}
	preset, ok := gamePlanetPresets[presetKey]
	if !ok {
		return
	}
	if len(session.bodies) == 0 {
		return
	}

	idx := session.primaryIdx
	if idx < 0 || idx >= len(session.bodies) {
		idx = 0
	}

	primary := session.bodies[idx]
	rel := session.craft.Position.Sub(primary.Position)
	dist := rel.Norm()
	altitude := 0.0
	if dist > 0 {
		altitude = dist - primary.Radius
	}
	if math.IsNaN(altitude) || math.IsInf(altitude, 0) || altitude < 0 {
		altitude = 0
	}
	dir := rel.Normalize()
	if dir.Norm2() == 0 {
		dir = mathx.Vec3{Z: 1}
	}

	session.bodies[idx].Name = preset.Name
	session.bodies[idx].Mass = preset.Mass
	session.bodies[idx].Radius = preset.Radius
	session.env.Atmosphere.Enabled = preset.AtmosphereEnabled
	session.env.Atmosphere.Rho0 = preset.AtmosphereRho0
	session.env.Atmosphere.ScaleHeight = preset.AtmosphereScaleH
	session.env.Atmosphere.Temperature0 = preset.AtmosphereT0
	session.env.Atmosphere.LapseRate = preset.AtmosphereLapse
	session.env.Atmosphere.Gamma = preset.AtmosphereGamma
	session.env.Atmosphere.GasConstant = preset.AtmosphereR
	session.env.Atmosphere.Layers = defaultAtmosphereLayersForPreset(preset)
	session.env.BField = mathx.Vec3{Y: preset.MagFieldTeslaEq}
	session.craft.Position = session.bodies[idx].Position.Add(dir.Scale(preset.Radius + altitude))
}

func applyEarthMoonPresetToSession(session *gameSession) {
	if session == nil {
		return
	}
	earth, okEarth := gamePlanetPresets["earth"]
	moon, okMoon := gamePlanetPresets["moon"]
	if !okEarth || !okMoon {
		return
	}
	if len(session.bodies) == 0 {
		return
	}

	idx := session.primaryIdx
	if idx < 0 || idx >= len(session.bodies) {
		idx = 0
	}
	primary := session.bodies[idx]
	rel := session.craft.Position.Sub(primary.Position)
	dist := rel.Norm()
	altitude := 0.0
	if dist > 0 {
		altitude = dist - primary.Radius
	}
	if math.IsNaN(altitude) || math.IsInf(altitude, 0) || altitude < 0 {
		altitude = 0
	}
	dir := rel.Normalize()
	if dir.Norm2() == 0 {
		dir = mathx.Vec3{Z: 1}
	}

	// Circular two-body initialization around the Earth-Moon barycenter.
	// This is deterministic and stable under the existing semi-implicit integrator.
	totalMass := earth.Mass + moon.Mass
	if totalMass <= 0 {
		totalMass = earth.Mass
	}
	rEarth := earthMoonDistanceM * (moon.Mass / totalMass)
	rMoon := earthMoonDistanceM * (earth.Mass / totalMass)
	omega := math.Sqrt((gameBigG * totalMass) / (earthMoonDistanceM * earthMoonDistanceM * earthMoonDistanceM))
	vEarth := omega * rEarth
	vMoon := omega * rMoon

	earthBody := physics.CelestialBody{
		Name:     earth.Name,
		Mass:     earth.Mass,
		Radius:   earth.Radius,
		Position: mathx.Vec3{X: -rEarth, Y: 0, Z: 0},
		Velocity: mathx.Vec3{X: 0, Y: -vEarth, Z: 0},
	}
	moonBody := physics.CelestialBody{
		Name:     moon.Name,
		Mass:     moon.Mass,
		Radius:   moon.Radius,
		Position: mathx.Vec3{X: rMoon, Y: 0, Z: 0},
		Velocity: mathx.Vec3{X: 0, Y: vMoon, Z: 0},
	}

	if len(session.bodies) >= 2 {
		session.bodies[0] = earthBody
		session.bodies[1] = moonBody
	} else {
		session.bodies = []physics.CelestialBody{earthBody, moonBody}
	}
	session.primaryIdx = 0
	if session.env.Ground.BodyIndex < 0 || session.env.Ground.BodyIndex >= len(session.bodies) {
		session.env.Ground.BodyIndex = session.primaryIdx
	}

	session.env.Atmosphere.Enabled = earth.AtmosphereEnabled
	session.env.Atmosphere.Rho0 = earth.AtmosphereRho0
	session.env.Atmosphere.ScaleHeight = earth.AtmosphereScaleH
	session.env.Atmosphere.Temperature0 = earth.AtmosphereT0
	session.env.Atmosphere.LapseRate = earth.AtmosphereLapse
	session.env.Atmosphere.Gamma = earth.AtmosphereGamma
	session.env.Atmosphere.GasConstant = earth.AtmosphereR
	session.env.Atmosphere.Layers = defaultAtmosphereLayersForPreset(earth)
	session.env.BField = mathx.Vec3{Y: earth.MagFieldTeslaEq}

	session.craft.Position = earthBody.Position.Add(dir.Scale(earth.Radius + altitude))
	session.craft.Velocity = earthBody.Velocity
}

func applyMilkyWayPresetToSession(session *gameSession) {
	if session == nil {
		return
	}
	earth, okEarth := gamePlanetPresets["earth"]
	moon, okMoon := gamePlanetPresets["moon"]
	if !okEarth || !okMoon {
		return
	}
	type orbitBody struct {
		name   string
		mass   float64
		radius float64
		rAU    float64
	}
	sunMass := 1.98847e30
	sunRadius := 695_700_000.0
	planets := []orbitBody{
		{name: "mercury", mass: 3.3011e23, radius: 2_439_700, rAU: 0.387098},
		{name: "venus", mass: 4.8675e24, radius: 6_051_800, rAU: 0.723332},
		{name: "earth", mass: earth.Mass, radius: earth.Radius, rAU: 1.0},
		{name: "mars", mass: 6.4171e23, radius: 3_389_500, rAU: 1.523679},
		{name: "jupiter", mass: 1.8982e27, radius: 69_911_000, rAU: 5.2044},
		{name: "saturn", mass: 5.6834e26, radius: 58_232_000, rAU: 9.5826},
		{name: "uranus", mass: 8.6810e25, radius: 25_362_000, rAU: 19.2184},
		{name: "neptune", mass: 1.02413e26, radius: 24_622_000, rAU: 30.11},
	}
	bodies := make([]physics.CelestialBody, 0, len(planets)+2)
	bodies = append(bodies, physics.CelestialBody{
		Name:     "sun",
		Mass:     sunMass,
		Radius:   sunRadius,
		Position: mathx.Vec3{},
		Velocity: mathx.Vec3{},
	})
	for i, p := range planets {
		r := p.rAU * auMeters
		phi := (float64(i) * (2 * math.Pi / float64(len(planets))))
		x := r * math.Cos(phi)
		y := r * math.Sin(phi)
		v := math.Sqrt(gameBigG * sunMass / math.Max(r, 1))
		vx := -v * math.Sin(phi)
		vy := v * math.Cos(phi)
		bodies = append(bodies, physics.CelestialBody{
			Name:     p.name,
			Mass:     p.mass,
			Radius:   p.radius,
			Position: mathx.Vec3{X: x, Y: y, Z: 0},
			Velocity: mathx.Vec3{X: vx, Y: vy, Z: 0},
		})
	}
	earthIdx := -1
	for i := range bodies {
		if bodies[i].Name == "earth" {
			earthIdx = i
			break
		}
	}
	if earthIdx < 0 {
		return
	}
	earthBody := bodies[earthIdx]
	moonR := earthMoonDistanceM
	moonV := math.Sqrt(gameBigG * earthBody.Mass / moonR)
	bodies = append(bodies, physics.CelestialBody{
		Name:     "moon",
		Mass:     moon.Mass,
		Radius:   moon.Radius,
		Position: earthBody.Position.Add(mathx.Vec3{X: moonR, Y: 0, Z: 0}),
		Velocity: earthBody.Velocity.Add(mathx.Vec3{X: 0, Y: moonV, Z: 0}),
	})
	session.bodies = bodies
	var totalMomentum mathx.Vec3
	for i := range session.bodies {
		totalMomentum = totalMomentum.Add(session.bodies[i].Velocity.Scale(session.bodies[i].Mass))
	}
	if session.bodies[0].Mass > 0 {
		session.bodies[0].Velocity = session.bodies[0].Velocity.Sub(totalMomentum.Scale(1.0 / session.bodies[0].Mass))
	}
	session.primaryIdx = earthIdx
	session.env.Ground.BodyIndex = earthIdx
	session.bodyIntegrator = "rk4"
	session.bodySubsteps = 12
	session.env.Atmosphere.Enabled = earth.AtmosphereEnabled
	session.env.Atmosphere.Rho0 = earth.AtmosphereRho0
	session.env.Atmosphere.ScaleHeight = earth.AtmosphereScaleH
	session.env.Atmosphere.Temperature0 = earth.AtmosphereT0
	session.env.Atmosphere.LapseRate = earth.AtmosphereLapse
	session.env.Atmosphere.Gamma = earth.AtmosphereGamma
	session.env.Atmosphere.GasConstant = earth.AtmosphereR
	session.env.Atmosphere.Layers = defaultAtmosphereLayersForPreset(earth)
	session.env.BField = mathx.Vec3{Y: earth.MagFieldTeslaEq}
	session.craft.Position = earthBody.Position.Add(mathx.Vec3{Z: earth.Radius + 500.0})
	session.craft.Velocity = earthBody.Velocity
}

func defaultAtmosphereLayersForPreset(p gamePlanetPreset) []physics.AtmosphereLayer {
	if !p.AtmosphereEnabled || p.AtmosphereScaleH <= 0 || p.AtmosphereRho0 <= 0 {
		return nil
	}
	midAlt := math.Max(1000, p.AtmosphereScaleH*1.8)
	topAlt := math.Max(midAlt+2000, p.AtmosphereScaleH*5.5)
	rho1 := p.AtmosphereRho0 * 0.18
	rho2 := p.AtmosphereRho0 * 0.015
	return []physics.AtmosphereLayer{
		{
			MinAlt:       0,
			MaxAlt:       midAlt,
			Rho0:         p.AtmosphereRho0,
			ScaleHeight:  p.AtmosphereScaleH,
			Temperature0: p.AtmosphereT0,
			LapseRate:    p.AtmosphereLapse,
			Gamma:        p.AtmosphereGamma,
			GasConstant:  p.AtmosphereR,
		},
		{
			MinAlt:       midAlt,
			MaxAlt:       topAlt,
			Rho0:         rho1,
			ScaleHeight:  p.AtmosphereScaleH * 0.9,
			Temperature0: p.AtmosphereT0 + p.AtmosphereLapse*midAlt,
			LapseRate:    p.AtmosphereLapse * 0.6,
			Gamma:        p.AtmosphereGamma,
			GasConstant:  p.AtmosphereR,
		},
		{
			MinAlt:       topAlt,
			MaxAlt:       1e9,
			Rho0:         rho2,
			ScaleHeight:  p.AtmosphereScaleH * 1.3,
			Temperature0: p.AtmosphereT0 + p.AtmosphereLapse*topAlt,
			LapseRate:    p.AtmosphereLapse * 0.2,
			Gamma:        p.AtmosphereGamma,
			GasConstant:  p.AtmosphereR,
		},
	}
}

func applyCraftScaleToSession(session *gameSession, scaleRaw float64) {
	if session == nil {
		return
	}
	scale := normalizeCraftScaleForGame(scaleRaw)
	scale2 := scale * scale
	scale3 := scale2 * scale
	scale5 := scale3 * scale2

	if session.craft.Mass > 0 {
		session.craft.Mass *= scale3
	}
	if session.craft.Drag.Area > 0 {
		session.craft.Drag.Area *= scale2
	}
	session.craft.InertiaDiagonal = session.craft.InertiaDiagonal.Scale(scale5)
	session.craftScale = scale
}

func ensureGameAerodynamics(session *gameSession) {
	if session == nil {
		return
	}

	session.craft.Drag.ReferenceSpan = craftSpanMetersForScale(session.craftScale)
	if session.craft.Drag.Cd <= 0 {
		session.craft.Drag.Cd = defaultDragCoefficientForShip(session.craft.ShipType)
	}
	if session.env.Atmosphere.Enabled {
		session.craft.Drag.Enabled = true
		session.craft.Drag.Plasma.Enabled = true
		session.craft.Aero.Enabled = true
	} else {
		session.craft.Drag.Plasma.Enabled = false
		session.craft.Aero.Enabled = false
	}
	if session.craft.Drag.Plasma.MaxDragReduction <= 0 {
		session.craft.Drag.Plasma.MaxDragReduction = 0.995
	}
	if session.craft.Drag.Plasma.AuthoritySpeed <= 0 {
		session.craft.Drag.Plasma.AuthoritySpeed = 28.0
	}
	if session.craft.Drag.Plasma.VelocityFalloff <= 0 {
		session.craft.Drag.Plasma.VelocityFalloff = 280.0
	}
	if session.craft.Drag.Plasma.PowerPerArea <= 0 {
		session.craft.Drag.Plasma.PowerPerArea = 320.0
	}
	if strings.EqualFold(session.warpDrive, "plasma_mhd") && session.craft.Drag.Plasma.Level < 1.0 {
		session.craft.Drag.Plasma.Level = 1.0
	}
	session.craft.Drag.Plasma.Level = mathx.Clamp(session.craft.Drag.Plasma.Level, gamePlasmaMin, gamePlasmaMax)
	if session.craft.Aero.ClAlpha == 0 {
		session.craft.Aero.ClAlpha = 5.4
	}
	if session.craft.Aero.ClMax == 0 {
		session.craft.Aero.ClMax = 1.35
	}
	if session.craft.Aero.StallAoA == 0 {
		session.craft.Aero.StallAoA = 0.35
	}
	if session.env.Atmosphere.Temperature0 <= 0 {
		session.env.Atmosphere.Temperature0 = 288.15
	}
	if session.env.Atmosphere.LapseRate == 0 {
		session.env.Atmosphere.LapseRate = -0.0065
	}
	if session.env.Atmosphere.Gamma <= 0 {
		session.env.Atmosphere.Gamma = 1.4
	}
	if session.env.Atmosphere.GasConstant <= 0 {
		session.env.Atmosphere.GasConstant = 287.05
	}
	session.craft.Thermal.Enabled = true
	if session.craft.Thermal.HeatTransferCoeff <= 0 {
		session.craft.Thermal.HeatTransferCoeff = 7.5e-4
	}
	if session.craft.Thermal.RadiativeCoeff <= 0 {
		session.craft.Thermal.RadiativeCoeff = 1.2e-8
	}
	if session.craft.Thermal.Emissivity <= 0 {
		session.craft.Thermal.Emissivity = 0.85
	}
	if session.craft.Thermal.InitialSkinTempK <= 0 {
		session.craft.Thermal.InitialSkinTempK = 295
	}
	if session.craft.Thermal.ReferenceHeatCapacity <= 0 {
		session.craft.Thermal.ReferenceHeatCapacity = 1.8e6
	}
	if session.craft.Thermal.MaxSkinTempK <= 0 {
		session.craft.Thermal.MaxSkinTempK = 1400
	}
	session.craft.Structural.Enabled = true
	if session.craft.Structural.MaxGLoad <= 0 {
		session.craft.Structural.MaxGLoad = 30
	}
	if session.craft.Structural.MaxDynamicQPa <= 0 {
		session.craft.Structural.MaxDynamicQPa = 1.2e6
	}
	if session.craft.Structural.MaxHeatFluxWm2 <= 0 {
		session.craft.Structural.MaxHeatFluxWm2 = 4e6
	}
	session.craft.Pilot.Enabled = true
	if session.craft.Pilot.MaxGPositive <= 0 {
		session.craft.Pilot.MaxGPositive = 9
	}
	if session.craft.Pilot.MaxGNegative <= 0 {
		session.craft.Pilot.MaxGNegative = 3
	}
	if session.craft.Pilot.MaxGLongitudinal <= 0 {
		session.craft.Pilot.MaxGLongitudinal = 6
	}
	if session.craft.Pilot.MaxGLateral <= 0 {
		session.craft.Pilot.MaxGLateral = 4
	}
	if session.craft.Pilot.RecoveryTauS <= 0 {
		session.craft.Pilot.RecoveryTauS = 4
	}
}

func defaultDragCoefficientForShip(shipType string) float64 {
	switch strings.ToLower(strings.TrimSpace(shipType)) {
	case "sphere":
		return 0.47
	case "egg":
		return 0.19
	case "pyramid":
		return 0.32
	case "flat_triangle":
		return 0.14
	default:
		return 0.18
	}
}

func copyChargeOverrides(in map[string]float64) map[string]float64 {
	if len(in) == 0 {
		return nil
	}

	out := make(map[string]float64, len(in)*2)
	for name, value := range in {
		trimmed := strings.TrimSpace(name)
		if trimmed == "" {
			continue
		}
		out[trimmed] = value
		out[strings.ToLower(trimmed)] = value
	}
	return out
}

func normalizePlanetPresetForGame(raw string) (string, bool) {
	preset := strings.ToLower(strings.TrimSpace(raw))
	switch preset {
	case "", "earth", "terra":
		return "earth", true
	case "mercury":
		return "mercury", true
	case "moon", "luna":
		return "moon", true
	case "earth_moon", "earth+moon", "earth-moon", "terra_luna":
		return "earth_moon", true
	case "milky_way", "milkyway", "galaxy", "solar_system":
		return "milky_way", true
	case "mars":
		return "mars", true
	case "venus":
		return "venus", true
	case "titan":
		return "titan", true
	case "jupiter":
		return "jupiter", true
	case "neptune":
		return "neptune", true
	default:
		return "", false
	}
}

func normalizeCraftScaleForGame(raw float64) float64 {
	if math.IsNaN(raw) || math.IsInf(raw, 0) || raw <= 0 {
		return gameCraftScaleMin
	}
	return mathx.Clamp(raw, gameCraftScaleMin, gameCraftScaleMax)
}

func craftSpanMetersForScale(scale float64) float64 {
	return gameCraftLazarSpanM * normalizeCraftScaleForGame(scale)
}

func normalizeShipTypeForGame(raw string) (string, bool) {
	ship := strings.ToLower(strings.TrimSpace(raw))
	switch ship {
	case "":
		return "", false
	case "saucer", "sphere", "egg", "pyramid":
		return ship, true
	case "flat_triangle", "flat-triangle", "flat triangle", "triangle", "delta":
		return "flat_triangle", true
	default:
		return "", false
	}
}

func (gs *gameSession) LastUpdated() time.Time {
	gs.mu.Lock()
	defer gs.mu.Unlock()
	return gs.updatedAt
}

func (gs *gameSession) State() (gameStepState, error) {
	gs.mu.Lock()
	defer gs.mu.Unlock()

	gs.enforceCanonicalModeLocked()
	gs.updateCouplingStateLocked(0)
	eval := gs.evaluateGravityLocked()
	gs.touchLocked()
	return gs.buildStateLocked(eval), nil
}

func (gs *gameSession) Step(steps int, input gameControlInput) (gameStepState, error) {
	gs.mu.Lock()
	defer gs.mu.Unlock()

	if steps < 1 {
		steps = 1
	}
	if steps > gameMaxStepsPerRequest {
		steps = gameMaxStepsPerRequest
	}

	lastEval := gameGravityEval{}
	for i := 0; i < steps; i++ {
		gs.enforceCanonicalModeLocked()
		gs.updateDominantPrimaryLocked()
		gs.applyControlsLocked(input, gs.dt)
		gs.applyAssistAutopilotLocked(input, gs.dt)
		gs.updateCouplingStateLocked(gs.dt)
		lastEval = gs.evaluateGravityLocked()
		gs.updateDerivedActuationLocked(lastEval)

		primary := gs.primaryBodyLocked()
		forceEval := physics.EvaluateForces(gs.craft, gs.env, primary, lastEval.effective)
		forceEval = gs.enforceEnergyBudgetLocked(forceEval, gs.dt, primary, lastEval.effective)
		gs.integrateLimitHistoryLocked(forceEval, gs.dt)
		effMass := gs.couplingStep.InertialMass
		netForce := forceEval.Net
		if math.Abs(effMass) > 1e-9 && gs.craft.Mass > 1e-9 {
			netForce = netForce.Scale(gs.craft.Mass / effMass)
		}
		gs.craft.IntegrateSemiImplicit(gs.dt, netForce, mathx.Vec3{})

		if gs.env.Ground.Enabled {
			ground := gs.groundBodyLocked()
			physics.ResolveGroundContact(&gs.craft, gs.env, ground)
		}

		substeps := gs.bodySubsteps
		if substeps < 1 {
			substeps = 1
		}
		bodyDt := gs.dt / float64(substeps)
		for bsi := 0; bsi < substeps; bsi++ {
			if gs.bodyIntegrator == "rk4" {
				physics.IntegrateBodiesRK4(bodyDt, gs.env.G, gs.bodies)
			} else {
				physics.IntegrateBodiesSemiImplicit(bodyDt, gs.env.G, gs.bodies)
			}
		}
		gs.updateDominantPrimaryLocked()
		if !gs.craft.Position.IsFinite() || !gs.craft.Velocity.IsFinite() {
			return gameStepState{}, fmt.Errorf("state diverged at step %d", gs.step)
		}
		gs.updateCraftAttitudeLocked(gs.dt)
		gs.syncWarpAxisLocked()

		gs.step++
		gs.simTime += gs.dt
	}

	gs.touchLocked()
	return gs.buildStateLocked(lastEval), nil
}

func (gs *gameSession) enforceCanonicalModeLocked() {
	if gs == nil {
		return
	}
	gs.gravityModel = "coupling"
}

func (gs *gameSession) integrateLimitHistoryLocked(f physics.ForceBreakdown, dt float64) {
	if dt <= 0 {
		return
	}
	ambient := gs.env.Atmosphere.Temperature0
	if ambient <= 0 {
		ambient = 288.15
	}
	if gs.skinTempK <= 0 {
		gs.skinTempK = gs.craft.Thermal.InitialSkinTempK
		if gs.skinTempK <= 0 {
			gs.skinTempK = ambient
		}
	}
	// First-order thermal accumulation.
	capacity := gs.craft.Thermal.ReferenceHeatCapacity
	if capacity <= 0 {
		capacity = 1.8e6
	}
	cool := 0.02
	gs.skinTempK += dt * ((f.HeatFlux / capacity) - cool*(gs.skinTempK-ambient))
	if gs.skinTempK < ambient {
		gs.skinTempK = ambient
	}

	// Pilot stress accumulation with exponential-like recovery.
	pTau := gs.craft.Pilot.RecoveryTauS
	if pTau <= 0 {
		pTau = 4.0
	}
	stressIn := math.Max(0, f.GLoad-3.5) * dt / pTau
	stressOut := gs.pilotStress * dt / (pTau * 2.2)
	gs.pilotStress += stressIn - stressOut
	if gs.pilotStress < 0 {
		gs.pilotStress = 0
	}
	if gs.pilotStress > 3 {
		gs.pilotStress = 3
	}

	// Structural fatigue accumulates on dynamic pressure + heat flux exceedance.
	maxQ := gs.craft.Structural.MaxDynamicQPa
	if maxQ <= 0 {
		maxQ = 1.2e6
	}
	maxHF := gs.craft.Structural.MaxHeatFluxWm2
	if maxHF <= 0 {
		maxHF = 4e6
	}
	qRatio := math.Max(0, f.DynamicQ/maxQ-1.0)
	hRatio := math.Max(0, f.HeatFlux/maxHF-1.0)
	gs.structFatigue += dt * (qRatio*0.4 + hRatio*0.6)
	gs.structFatigue -= dt * 0.01
	if gs.structFatigue < 0 {
		gs.structFatigue = 0
	}
	if gs.structFatigue > 5 {
		gs.structFatigue = 5
	}
}

func (gs *gameSession) enforceEnergyBudgetLocked(forceEval physics.ForceBreakdown, dt float64, primary physics.CelestialBody, gravityAccel mathx.Vec3) physics.ForceBreakdown {
	if gs == nil || dt <= 0 || gs.couplerState == nil {
		return forceEval
	}
	availableJ := math.Max(0, gs.couplerState.Energy)
	reqPlasma := math.Max(0, forceEval.DragEval.PlasmaPower)
	vRel := gs.craft.Velocity.Sub(primary.Velocity)
	reqThrust := math.Max(0, forceEval.Thrust.Dot(vRel))
	reqEM := math.Max(0, forceEval.EM.Dot(vRel))
	req := energy.Request{
		CouplerW: math.Max(0, gs.couplerState.DrivePower),
		PlasmaW:  reqPlasma,
		ThrustW:  reqThrust,
		EMW:      reqEM,
	}
	grant := energy.Allocate(availableJ, dt, req)
	scale := 1.0
	totalReq := reqPlasma + reqThrust + reqEM
	if totalReq > 1e-9 {
		scale = (grant.PlasmaW + grant.ThrustW + grant.EMW) / totalReq
	}
	if scale < 0.999999 {
		gs.craft.Drag.Plasma.Level = mathx.Clamp(gs.craft.Drag.Plasma.Level*scale, gamePlasmaMin, gamePlasmaMax)
		gs.craft.Propulsion.Throttle = mathx.Clamp(gs.craft.Propulsion.Throttle*scale, -1, 1)
		gs.craft.EM.ChargeC *= scale
		forceEval = physics.EvaluateForces(gs.craft, gs.env, primary, gravityAccel)
		reqPlasma = math.Max(0, forceEval.DragEval.PlasmaPower)
		reqThrust = math.Max(0, forceEval.Thrust.Dot(vRel))
		reqEM = math.Max(0, forceEval.EM.Dot(vRel))
	}
	couplerScale := 1.0
	if req.CouplerW > 1e-9 {
		couplerScale = grant.CouplerW / req.CouplerW
	}
	if couplerScale < 1.0 {
		gs.couplerState.ADrive *= couplerScale
		gs.couplerState.DrivePower = grant.CouplerW
		gs.couplerState.LockQuality = math.Max(0, gs.couplerState.LockQuality-(1-couplerScale)*0.08)
		gs.couplerState.C = gs.couplerState.Params.DefaultC + gs.couplerState.LockQuality*(gs.couplerState.C-gs.couplerState.Params.DefaultC)
	}
	gs.couplerState.Energy -= grant.UsedJ
	if gs.couplerState.Energy < 0 {
		gs.couplerState.Energy = 0
	}
	gs.lastEnergyBus = gameEnergyBus{
		ReqCouplerW:   req.CouplerW,
		ReqPlasmaW:    req.PlasmaW,
		ReqThrustW:    req.ThrustW,
		ReqEMW:        req.EMW,
		GrantCouplerW: grant.CouplerW,
		GrantPlasmaW:  grant.PlasmaW,
		GrantThrustW:  grant.ThrustW,
		GrantEMW:      grant.EMW,
		CurtailFrac:   grant.CurtailFrac,
	}
	return forceEval
}

func (gs *gameSession) updateDerivedActuationLocked(eval gameGravityEval) {
	primary := gs.primaryBodyLocked()
	up := gs.craft.Position.Sub(primary.Position).Normalize()
	if up.Norm2() == 0 {
		up = mathx.Vec3{Z: 1}
	}
	gMag := eval.raw.Norm()
	warpAxis := gs.warpAxisWorldLocked()
	tiltSin := warpAxis.Cross(up).Norm()
	cMag := math.Abs(gs.couplerState.C)
	if cMag > 8 {
		cMag = 8
	}
	authority := math.Max(0, cMag-0.1)
	// Field-vector model: tilt + coupling magnitude converts vertical authority into
	// lateral effective propulsion to allow planetary translation.
	gs.craft.Propulsion.Enabled = true
	autoThrottle := mathx.Clamp(tiltSin*authority, 0, 1)
	gs.craft.Propulsion.Throttle = mathx.Clamp(autoThrottle+gs.controls.ThrottleTarget, -1, 1)
	gs.craft.Propulsion.MaxThrust = gs.craft.Mass * gMag * (1 + 6*authority)

	// EM vector field controls in local body-near-planet frame.
	forward, right := tangentBasisFromUp(up)
	if forward.Norm2() == 0 {
		forward = mathx.Vec3{X: 1}
	}
	if right.Norm2() == 0 {
		right = mathx.Vec3{Y: 1}
	}
	baseB := gs.env.BField.Norm()
	if baseB <= 0 {
		baseB = 3.12e-5
	}
	rMag := gs.craft.Position.Sub(primary.Position).Norm()
	dipoleScale := 1.0
	if primary.Radius > 0 && rMag > 0 {
		dipoleScale = math.Pow(primary.Radius/rMag, 3)
	}
	planetB := right.Scale(baseB * dipoleScale)
	gs.env.EField = up.Scale(gs.controls.EFieldTarget)
	gs.env.BField = planetB.Add(right.Scale(gs.controls.BFieldTarget))
	gs.craft.EM.Enabled = math.Abs(gs.controls.EMChargeTarget) > 1e-9
	gs.craft.EM.ChargeC = gs.controls.EMChargeTarget
}

func (gs *gameSession) applyControlsLocked(input gameControlInput, dt float64) {
	ampAxis := mathx.Clamp(input.AmpAxis, -1, 1)
	phiAxis := mathx.Clamp(input.PhiAxis, -1, 1)
	yawAxis := mathx.Clamp(input.YawAxis, -1, 1)
	pitchAxis := mathx.Clamp(input.PitchAxis, -1, 1)

	prevAmpTarget := gs.controls.AmpTarget
	prevThetaTarget := gs.controls.ThetaTarget
	prevAxisYaw := gs.controls.AxisYaw
	prevAxisPitch := gs.controls.AxisPitch
	if !math.IsNaN(input.OmegaTarget) && !math.IsInf(input.OmegaTarget, 0) {
		gs.controls.OmegaTarget = mathx.Clamp(input.OmegaTarget, gs.limits.MinOmegaTarget, gs.limits.MaxOmegaTarget)
	}
	if !math.IsNaN(input.QTarget) && !math.IsInf(input.QTarget, 0) {
		gs.controls.QTarget = mathx.Clamp(input.QTarget, gs.limits.MinQTarget, gs.limits.MaxQTarget)
	}
	if !math.IsNaN(input.BetaTarget) && !math.IsInf(input.BetaTarget, 0) {
		gs.controls.BetaTarget = mathx.Clamp(input.BetaTarget, gs.limits.MinBetaTarget, gs.limits.MaxBetaTarget)
	}
	if !math.IsNaN(input.PlasmaTarget) {
		gs.controls.PlasmaTarget = mathx.Clamp(input.PlasmaTarget, gs.limits.MinPlasmaTarget, gs.limits.MaxPlasmaTarget)
	}
	if !math.IsNaN(input.ThrottleTarget) && !math.IsInf(input.ThrottleTarget, 0) {
		gs.controls.ThrottleTarget = mathx.Clamp(input.ThrottleTarget, gs.limits.MinThrottleTarget, gs.limits.MaxThrottleTarget)
	}
	if !math.IsNaN(input.EMChargeTarget) && !math.IsInf(input.EMChargeTarget, 0) {
		gs.controls.EMChargeTarget = mathx.Clamp(input.EMChargeTarget, gs.limits.MinEMChargeTarget, gs.limits.MaxEMChargeTarget)
	}
	if !math.IsNaN(input.EFieldTarget) && !math.IsInf(input.EFieldTarget, 0) {
		gs.controls.EFieldTarget = mathx.Clamp(input.EFieldTarget, gs.limits.MinEFieldTarget, gs.limits.MaxEFieldTarget)
	}
	if !math.IsNaN(input.BFieldTarget) && !math.IsInf(input.BFieldTarget, 0) {
		gs.controls.BFieldTarget = mathx.Clamp(input.BFieldTarget, gs.limits.MinBFieldTarget, gs.limits.MaxBFieldTarget)
	}
	if input.LockAssist != nil {
		gs.controls.LockAssist = *input.LockAssist
	}

	gs.controls.AmpTarget = mathx.Clamp(
		gs.controls.AmpTarget+ampAxis*gs.limits.AmpAxisRate*dt,
		gs.couplerState.Params.MinAmplitude,
		gs.couplerState.Params.MaxAmplitude,
	)
	gs.controls.ThetaTarget = mathx.Clamp(gs.controls.ThetaTarget+phiAxis*gs.limits.PhiAxisRate*dt, gs.limits.MinThetaTarget, gs.limits.MaxThetaTarget)
	gs.controls.AxisYaw = mathx.WrapAngle(gs.controls.AxisYaw + yawAxis*gs.limits.YawAxisRate*dt)
	gs.controls.AxisPitch = mathx.Clamp(gs.controls.AxisPitch+pitchAxis*gs.limits.PitchAxisRate*dt, gs.limits.MinAxisPitch, gs.limits.MaxAxisPitch)
	if dt > 1e-9 {
		ampAxisApplied := (gs.controls.AmpTarget - prevAmpTarget) / (gs.limits.AmpAxisRate * dt)
		phiAxisApplied := (gs.controls.ThetaTarget - prevThetaTarget) / (gs.limits.PhiAxisRate * dt)
		yawAxisApplied := mathx.WrapAngle(gs.controls.AxisYaw-prevAxisYaw) / (gs.limits.YawAxisRate * dt)
		pitchAxisApplied := (gs.controls.AxisPitch - prevAxisPitch) / (gs.limits.PitchAxisRate * dt)
		gs.controls.AmpAxis = mathx.Clamp(ampAxisApplied, -1, 1)
		gs.controls.PhiAxis = mathx.Clamp(phiAxisApplied, -1, 1)
		gs.controls.YawAxis = mathx.Clamp(yawAxisApplied, -1, 1)
		gs.controls.PitchAxis = mathx.Clamp(pitchAxisApplied, -1, 1)
	} else {
		gs.controls.AmpAxis = ampAxis
		gs.controls.PhiAxis = phiAxis
		gs.controls.YawAxis = yawAxis
		gs.controls.PitchAxis = pitchAxis
	}

	if !gs.couplerEnabled {
		return
	}

	gs.couplerState.Params.Omega0 = gs.controls.OmegaTarget
	gs.couplerState.Params.Q = gs.controls.QTarget
	gs.couplerState.Params.Beta = gs.controls.BetaTarget
	gs.craft.Drag.Plasma.Level = gs.controls.PlasmaTarget

	if gs.controls.LockAssist {
		gs.couplerState.Params.PllKp = gs.basePllKp
		gs.couplerState.Params.PllKi = gs.basePllKi
	} else {
		gs.couplerState.Params.PllKp = 0
		gs.couplerState.Params.PllKi = 0
	}

	gs.couplerState.Params.DirectionalEnabled = true
	gs.syncWarpAxisLocked()

	omegaBase := gs.controls.OmegaTarget
	gs.couplerState.SetCommand(coupler.Command{
		Amplitude:   gs.controls.AmpTarget,
		ThetaTarget: gs.controls.ThetaTarget,
		OmegaBase:   omegaBase,
	})
	gs.couplerState.Update(dt)
}

func (gs *gameSession) syncWarpAxisLocked() {
	if gs == nil || gs.couplerState == nil {
		return
	}
	axisWorld := gs.warpAxisWorldLocked()
	axisBody := gs.craft.Orientation.Conj().Rotate(axisWorld)
	if axisBody.Norm2() == 0 {
		axisBody = mathx.Vec3{Z: 1}
	}
	gs.couplerState.Params.FieldAxisBody = axisBody.Normalize()
}

func (gs *gameSession) warpAxisWorldLocked() mathx.Vec3 {
	primary := gs.primaryBodyLocked()
	return warpAxisWorldFromYawPitch(gs.craft.Position, primary.Position, gs.controls.AxisYaw, gs.controls.AxisPitch)
}

func warpAxisWorldFromYawPitch(position, primaryPosition mathx.Vec3, yaw, pitch float64) mathx.Vec3 {
	up := position.Sub(primaryPosition).Normalize()
	if up.Norm2() == 0 {
		up = mathx.Vec3{Z: 1}
	}

	forward, _ := tangentBasisFromUp(up)
	heading := headingFromUpYaw(up, yaw)
	if heading.Norm2() == 0 {
		heading = forward
	}

	tilt := mathx.Clamp(pitch, -1.55, 1.55)
	axis := up.Scale(math.Cos(tilt)).Add(heading.Scale(math.Sin(tilt)))
	if axis.Norm2() == 0 {
		return up
	}
	return axis.Normalize()
}

func tangentBasisFromUp(up mathx.Vec3) (mathx.Vec3, mathx.Vec3) {
	forwardRef := mathx.Vec3{X: 1}
	forward := forwardRef.Sub(up.Scale(forwardRef.Dot(up)))
	if forward.Norm2() <= 1e-9 {
		forwardRef = mathx.Vec3{Y: 1}
		forward = forwardRef.Sub(up.Scale(forwardRef.Dot(up)))
	}
	if forward.Norm2() <= 1e-9 {
		forward = mathx.Vec3{Y: 1}
	}
	forward = forward.Normalize()
	right := up.Cross(forward).Normalize()
	if right.Norm2() <= 1e-9 {
		right = mathx.Vec3{Y: 1}
	}
	return forward, right
}

func headingFromUpYaw(up mathx.Vec3, yaw float64) mathx.Vec3 {
	forward, right := tangentBasisFromUp(up)
	heading := forward.Scale(math.Cos(yaw)).Add(right.Scale(math.Sin(yaw)))
	if heading.Norm2() == 0 {
		return forward
	}
	return heading.Normalize()
}

func (gs *gameSession) desiredCraftForwardLocked(desiredUp mathx.Vec3) mathx.Vec3 {
	primary := gs.primaryBodyLocked()
	velRel := gs.craft.Velocity.Sub(primary.Velocity)
	forward := velRel.Sub(desiredUp.Scale(velRel.Dot(desiredUp)))
	if forward.Norm2() <= 1e-9 {
		forward = headingFromUpYaw(desiredUp, gs.controls.AxisYaw)
	}
	forward = forward.Sub(desiredUp.Scale(forward.Dot(desiredUp)))
	if forward.Norm2() <= 1e-9 {
		forward, _ = tangentBasisFromUp(desiredUp)
	}
	if forward.Norm2() == 0 {
		return mathx.Vec3{X: 1}
	}
	return forward.Normalize()
}

func (gs *gameSession) desiredCraftOrientationLocked() mathx.Quat {
	desiredUp := gs.warpAxisWorldLocked()
	if desiredUp.Norm2() == 0 {
		desiredUp = mathx.Vec3{Z: 1}
	}
	desiredUp = desiredUp.Normalize()
	desiredForward := gs.desiredCraftForwardLocked(desiredUp)
	return quatFromForwardUp(desiredForward, desiredUp)
}

func (gs *gameSession) snapCraftAttitudeLocked() {
	gs.craft.Orientation = gs.desiredCraftOrientationLocked()
	gs.craft.AngularVelocity = mathx.Vec3{}
}

func (gs *gameSession) updateCraftAttitudeLocked(dt float64) {
	if gs == nil || dt <= 0 {
		return
	}
	target := gs.desiredCraftOrientationLocked()
	current := gs.craft.Orientation.Normalize()
	next, omega := quatRotateToward(current, target, gameAttitudeAlignRate*dt, dt)
	gs.craft.Orientation = next
	gs.craft.AngularVelocity = omega
}

func quatFromForwardUp(forward, up mathx.Vec3) mathx.Quat {
	f := forward.Normalize()
	u := up.Normalize()
	if f.Norm2() == 0 {
		f = mathx.Vec3{X: 1}
	}
	if u.Norm2() == 0 {
		u = mathx.Vec3{Z: 1}
	}
	r := u.Cross(f).Normalize()
	if r.Norm2() == 0 {
		r = mathx.Vec3{Y: 1}
	}
	f = r.Cross(u).Normalize()
	return quatFromRotationMatrix(
		f.X, r.X, u.X,
		f.Y, r.Y, u.Y,
		f.Z, r.Z, u.Z,
	)
}

func quatFromRotationMatrix(m00, m01, m02, m10, m11, m12, m20, m21, m22 float64) mathx.Quat {
	trace := m00 + m11 + m22
	if trace > 0 {
		s := math.Sqrt(trace+1.0) * 2
		return mathx.Quat{
			W: 0.25 * s,
			X: (m21 - m12) / s,
			Y: (m02 - m20) / s,
			Z: (m10 - m01) / s,
		}.Normalize()
	}
	if m00 > m11 && m00 > m22 {
		s := math.Sqrt(1.0+m00-m11-m22) * 2
		return mathx.Quat{
			W: (m21 - m12) / s,
			X: 0.25 * s,
			Y: (m01 + m10) / s,
			Z: (m02 + m20) / s,
		}.Normalize()
	}
	if m11 > m22 {
		s := math.Sqrt(1.0+m11-m00-m22) * 2
		return mathx.Quat{
			W: (m02 - m20) / s,
			X: (m01 + m10) / s,
			Y: 0.25 * s,
			Z: (m12 + m21) / s,
		}.Normalize()
	}
	s := math.Sqrt(1.0+m22-m00-m11) * 2
	return mathx.Quat{
		W: (m10 - m01) / s,
		X: (m02 + m20) / s,
		Y: (m12 + m21) / s,
		Z: 0.25 * s,
	}.Normalize()
}

func quatFromAxisAngle(axis mathx.Vec3, angle float64) mathx.Quat {
	n := axis.Normalize()
	if n.Norm2() == 0 || math.Abs(angle) <= 1e-9 {
		return mathx.IdentityQuat()
	}
	half := angle * 0.5
	s := math.Sin(half)
	return mathx.Quat{
		W: math.Cos(half),
		X: n.X * s,
		Y: n.Y * s,
		Z: n.Z * s,
	}.Normalize()
}

func quatRotateToward(current, target mathx.Quat, maxAngle, dt float64) (mathx.Quat, mathx.Vec3) {
	curr := current.Normalize()
	want := target.Normalize()
	dot := curr.W*want.W + curr.X*want.X + curr.Y*want.Y + curr.Z*want.Z
	if dot < 0 {
		want.W = -want.W
		want.X = -want.X
		want.Y = -want.Y
		want.Z = -want.Z
	}
	delta := want.Mul(curr.Conj()).Normalize()
	w := mathx.Clamp(delta.W, -1, 1)
	angle := 2 * math.Acos(w)
	if angle > math.Pi {
		angle -= 2 * math.Pi
	}
	angle = math.Abs(angle)
	if angle <= 1e-6 {
		return want, mathx.Vec3{}
	}
	sinHalf := math.Sqrt(math.Max(1-(w*w), 0))
	axis := mathx.Vec3{X: delta.X, Y: delta.Y, Z: delta.Z}
	if sinHalf > 1e-6 {
		axis = axis.Scale(1.0 / sinHalf)
	}
	axis = axis.Normalize()
	step := math.Min(angle, math.Max(maxAngle, 0))
	next := quatFromAxisAngle(axis, step).Mul(curr).Normalize()
	omega := mathx.Vec3{}
	if dt > 0 && axis.Norm2() > 0 {
		omega = axis.Scale(step / dt)
	}
	return next, omega
}

func (gs *gameSession) evaluateGravityLocked() gameGravityEval {
	gRaw := physics.GravityAt(gs.craft.Position, gs.env.G, gs.bodies)
	eval := gameGravityEval{
		raw:          gRaw,
		effective:    gRaw,
		gravityModel: gs.gravityModel,
	}

	if gs.couplerEnabled {
		qgNow := gs.couplingStep.QGCraft
		qgDynamic := gs.couplingStep.QGDynamicTerm
		qgAuthority := gs.couplingStep.QGAuthority
		eval.qgCraftBase = gs.negMassQGCraft
		eval.qgCraftDynamicTerm = qgDynamic
		eval.qgCraft = qgNow
		eval.qgAuthority = qgAuthority
		coupled := gs.couplerState.EffectiveGravityAccel(gRaw, gs.craft.Orientation)
		authority := mathx.Clamp(qgAuthority, 0, 1)
		eval.effective = gRaw.Scale(1-authority).Add(coupled.Scale(authority))
	}

	return eval
}

func (gs *gameSession) targetChargeStateLocked() (float64, float64) {
	if gs == nil || gs.couplerState == nil {
		return 0, 0
	}
	lockQ := mathx.Clamp(gs.couplerState.LockQuality, 0, 1)
	powerW := math.Max(0, gs.couplerState.DrivePower)
	powerFactor := 1 - math.Exp(-powerW/2.0e7)
	qFactor := 1 - math.Exp(-math.Max(0, gs.controls.QTarget)/260.0)
	betaFactor := 1 - math.Exp(-math.Max(0, gs.controls.BetaTarget)/1.8)
	authority := mathx.Clamp(lockQ*powerFactor*qFactor*betaFactor, 0, 1)
	phaseDrive := math.Sin(gs.controls.ThetaTarget)
	// Dynamic term permits decouple (near zero) and negative-charge regimes as
	// resonator authority rises; sign/direction is phase-driven.
	dynamic := mathx.Clamp(2.0*authority*phaseDrive, -2.5, 2.5)
	return dynamic, authority
}

func (gs *gameSession) updateChargeDynamicsLocked(dt float64) {
	if gs == nil || dt <= 0 {
		return
	}
	dynTarget, authTarget := gs.targetChargeStateLocked()
	authTau := 0.30
	dynTau := 0.45
	authA := mathx.Clamp(dt/math.Max(authTau, 1e-6), 0, 1)
	dynA := mathx.Clamp(dt/math.Max(dynTau, 1e-6), 0, 1)
	gs.qgAuthorityState += (authTarget - gs.qgAuthorityState) * authA
	gs.qgDynamicState += (dynTarget - gs.qgDynamicState) * dynA
	gs.qgAuthorityState = mathx.Clamp(gs.qgAuthorityState, 0, 1)
	gs.qgDynamicState = mathx.Clamp(gs.qgDynamicState, -2.5, 2.5)
}

func (gs *gameSession) updateCouplingStateLocked(dt float64) {
	if gs == nil {
		return
	}
	if dt > 0 {
		gs.updateChargeDynamicsLocked(dt)
	}
	qgNow, dyn, authority := gs.dynamicChargeStateLocked()
	inertialMass, inertialScale := gs.effectiveInertialStateLocked()
	inertialSign := 1.0
	if inertialScale < 0 {
		inertialSign = -1.0
	}
	gs.couplingStep = gameCouplingState{
		QGCraft:       qgNow,
		QGBase:        gs.negMassQGCraft,
		QGDynamicTerm: dyn,
		QGAuthority:   authority,
		InertialMass:  inertialMass,
		InertialScale: inertialScale,
		InertialSign:  inertialSign,
		Regime:        gs.chargeRegimeLocked(),
	}
}

func (gs *gameSession) dynamicChargeStateLocked() (float64, float64, float64) {
	base := gs.negMassQGCraft
	dynamic := gs.qgDynamicState
	authority := gs.qgAuthorityState
	return base + dynamic, dynamic, authority
}

func (gs *gameSession) effectiveInertialStateLocked() (float64, float64) {
	if gs == nil {
		return 0, 1.0
	}
	// Coupling mode: use persistent resonator authority+phase to allow
	// gradual decoupling and sign inversion at high authority.
	if gs.couplerEnabled && gs.couplerState != nil {
		lockQ := mathx.Clamp(gs.couplerState.LockQuality, 0, 1)
		authority := gs.qgAuthorityState
		phaseDrive := math.Sin(gs.controls.ThetaTarget)
		decouple := mathx.Clamp(authority*math.Abs(phaseDrive), 0, 1)
		scale := mathx.Clamp(1.0-(0.985*decouple), 0.015, 1.5)
		sign := 1.0
		// Require strong lock + authority before allowing inertial inversion.
		if lockQ > 0.85 && authority > 0.75 && phaseDrive < -0.88 {
			sign = -1.0
		}
		effMass := gs.craft.Mass * scale * sign
		if math.Abs(effMass) < 1e-9 {
			effMass = gs.craft.Mass * 0.015
		}
		return effMass, scale * sign
	}
	return gs.craft.Mass, 1.0
}

func (gs *gameSession) chargeRegimeLocked() string {
	if gs == nil {
		return "coupled"
	}
	lockQ := 0.0
	if gs.couplerState != nil {
		lockQ = mathx.Clamp(gs.couplerState.LockQuality, 0, 1)
	}
	_, _, authority := gs.dynamicChargeStateLocked()
	_, inertialScale := gs.effectiveInertialStateLocked()
	if authority < 0.10 || lockQ < 0.40 {
		return "spinup"
	}
	if inertialScale < -0.08 {
		return "negative"
	}
	if math.Abs(inertialScale) <= 0.08 {
		return "decoupled"
	}
	if math.Abs(inertialScale) <= 0.70 {
		return "partial"
	}
	return "coupled"
}

func (gs *gameSession) primaryBodyLocked() physics.CelestialBody {
	if len(gs.bodies) == 0 {
		return physics.CelestialBody{}
	}
	idx := gs.primaryIdx
	if idx < 0 || idx >= len(gs.bodies) {
		idx = 0
	}
	return gs.bodies[idx]
}

func (gs *gameSession) groundBodyLocked() physics.CelestialBody {
	if len(gs.bodies) == 0 {
		return physics.CelestialBody{}
	}
	idx := gs.env.Ground.BodyIndex
	if idx < 0 || idx >= len(gs.bodies) {
		idx = gs.primaryIdx
	}
	if idx < 0 || idx >= len(gs.bodies) {
		idx = 0
	}
	return gs.bodies[idx]
}

func (gs *gameSession) dominantBodyIndexLocked() int {
	if gs == nil || len(gs.bodies) == 0 {
		return 0
	}
	bestIdx := 0
	bestA := -1.0
	for i := range gs.bodies {
		b := gs.bodies[i]
		rv := gs.craft.Position.Sub(b.Position)
		r2 := rv.Norm2()
		if r2 <= 1e-9 || b.Mass <= 0 {
			continue
		}
		a := gs.env.G * b.Mass / r2
		if a > bestA {
			bestA = a
			bestIdx = i
		}
	}
	if bestA < 0 {
		return 0
	}
	return bestIdx
}

func (gs *gameSession) applyPrimaryEnvironmentFromBodyLocked() {
	if gs == nil || len(gs.bodies) == 0 {
		return
	}
	idx := gs.primaryIdx
	if idx < 0 || idx >= len(gs.bodies) {
		idx = 0
	}
	name := strings.ToLower(strings.TrimSpace(gs.bodies[idx].Name))
	if preset, ok := gamePlanetPresets[name]; ok {
		gs.env.Atmosphere.Enabled = preset.AtmosphereEnabled
		gs.env.Atmosphere.Rho0 = preset.AtmosphereRho0
		gs.env.Atmosphere.ScaleHeight = preset.AtmosphereScaleH
		gs.env.Atmosphere.Temperature0 = preset.AtmosphereT0
		gs.env.Atmosphere.LapseRate = preset.AtmosphereLapse
		gs.env.Atmosphere.Gamma = preset.AtmosphereGamma
		gs.env.Atmosphere.GasConstant = preset.AtmosphereR
		gs.env.Atmosphere.Layers = defaultAtmosphereLayersForPreset(preset)
		gs.env.BField = mathx.Vec3{Y: preset.MagFieldTeslaEq}
	}
	gs.env.Ground.BodyIndex = idx
}

func (gs *gameSession) updateDominantPrimaryLocked() {
	if gs == nil || len(gs.bodies) == 0 {
		return
	}
	idx := gs.dominantBodyIndexLocked()
	if idx < 0 || idx >= len(gs.bodies) {
		return
	}
	gs.primaryIdx = idx
	gs.applyPrimaryEnvironmentFromBodyLocked()
}

func (gs *gameSession) buildStateLocked(eval gameGravityEval) gameStepState {
	primary := gs.primaryBodyLocked()
	effInertialMass := gs.couplingStep.InertialMass
	effInertialScale := gs.couplingStep.InertialScale
	chargeRegime := gs.couplingStep.Regime
	r := gs.craft.Position.Sub(primary.Position)
	d := r.Norm()
	up := mathx.Vec3{}
	if d > 0 {
		up = r.Scale(1.0 / d)
	}
	altitude := d - primary.Radius
	vertVel := gs.craft.Velocity.Sub(primary.Velocity).Dot(up)

	warpAxis := gs.warpAxisWorldLocked()
	forceEval := physics.EvaluateForces(gs.craft, gs.env, primary, eval.effective)
	vRel := gs.craft.Velocity.Sub(primary.Velocity)
	dragPower := math.Max(0, -forceEval.Drag.Dot(vRel))
	thrustPower := math.Max(0, forceEval.Thrust.Dot(vRel))
	emPower := math.Max(0, forceEval.EM.Dot(vRel))
	climbPower := math.Max(0, -gs.craft.Mass*eval.effective.Dot(vRel))
	requiredPower := dragPower + thrustPower + emPower + climbPower + math.Max(0, forceEval.DragEval.PlasmaPower)
	combinedWarnings := append([]string{}, forceEval.Warnings...)
	if gs.pilotStress > 1.0 {
		combinedWarnings = append(combinedWarnings, "pilot-stress")
	}
	if gs.structFatigue > 1.0 {
		combinedWarnings = append(combinedWarnings, "struct-fatigue")
	}
	pilotOK := forceEval.PilotOK && gs.pilotStress < 1.6
	structOK := forceEval.StructOK && gs.structFatigue < 2.0

	return gameStepState{
		Step:         gs.step,
		Time:         gs.simTime,
		Dt:           gs.dt,
		CraftMass:    gs.craft.Mass,
		CraftScale:   gs.craftScale,
		CraftSpanM:   craftSpanMetersForScale(gs.craftScale),
		OrientationW: gs.craft.Orientation.W,
		OrientationX: gs.craft.Orientation.X,
		OrientationY: gs.craft.Orientation.Y,
		OrientationZ: gs.craft.Orientation.Z,
		AngularVelX:  gs.craft.AngularVelocity.X,
		AngularVelY:  gs.craft.AngularVelocity.Y,
		AngularVelZ:  gs.craft.AngularVelocity.Z,
		ShipType:     gs.craft.ShipType,

		Position:        gs.craft.Position,
		Velocity:        gs.craft.Velocity,
		Speed:           gs.craft.Velocity.Sub(primary.Velocity).Norm(),
		Altitude:        altitude,
		VerticalVel:     vertVel,
		LocalUpX:        up.X,
		LocalUpY:        up.Y,
		LocalUpZ:        up.Z,
		PrimaryName:     primary.Name,
		PrimaryMass:     primary.Mass,
		PrimaryPosition: primary.Position,
		PrimaryRadius:   primary.Radius,

		GRaw:              eval.raw,
		GRawMag:           eval.raw.Norm(),
		EffectiveG:        eval.effective,
		EffectiveGMag:     eval.effective.Norm(),
		GravPower:         gs.craft.Mass * eval.effective.Dot(gs.craft.Velocity),
		GravityModel:      gs.gravityModel,
		CouplerEnabled:    gs.couplerEnabled,
		WarpDrive:         gs.warpDrive,
		AtmosphereEnabled: gs.env.Atmosphere.Enabled,
		AtmosphereRho0:    gs.env.Atmosphere.Rho0,
		AtmosphereScaleH:  gs.env.Atmosphere.ScaleHeight,
		AtmosphereT0:      gs.env.Atmosphere.Temperature0,
		AtmosphereLapse:   gs.env.Atmosphere.LapseRate,
		AtmosphereGamma:   gs.env.Atmosphere.Gamma,
		AtmosphereR:       gs.env.Atmosphere.GasConstant,

		CouplingC:       gs.couplerState.C,
		CouplingK:       gs.couplerState.K,
		CouplingPhi:     gs.couplerState.Phi,
		ResonatorQ:      gs.couplerState.Params.Q,
		ResonatorBeta:   gs.couplerState.Params.Beta,
		ResonatorOmega0: gs.couplerState.Params.Omega0,

		PhaseError:        gs.couplerState.PhaseError,
		LockQuality:       gs.couplerState.LockQuality,
		LockFlag:          gs.couplerState.LockQuality >= 0.5,
		DriveAmp:          gs.couplerState.ADrive,
		OmegaBase:         gs.couplerState.OmegaBase,
		DriveOmega:        gs.couplerState.OmegaDrive,
		DrivePhase:        gs.couplerState.ThetaDrive,
		PLLFreqDelta:      gs.couplerState.DeltaOmega,
		OscMag:            cmplx.Abs(gs.couplerState.Z),
		DrivePower:        gs.couplerState.DrivePower,
		PlasmaPower:       forceEval.DragEval.PlasmaPower,
		Energy:            gs.couplerState.Energy,
		DragForceMag:      forceEval.DragEval.Force.Norm(),
		DragPower:         dragPower,
		ThrustPower:       thrustPower,
		EMPower:           emPower,
		ClimbPower:        climbPower,
		RequiredPower:     requiredPower,
		PowerReqCoupler:   gs.lastEnergyBus.ReqCouplerW,
		PowerReqPlasma:    gs.lastEnergyBus.ReqPlasmaW,
		PowerReqThrust:    gs.lastEnergyBus.ReqThrustW,
		PowerReqEM:        gs.lastEnergyBus.ReqEMW,
		PowerGrantCoupler: gs.lastEnergyBus.GrantCouplerW,
		PowerGrantPlasma:  gs.lastEnergyBus.GrantPlasmaW,
		PowerGrantThrust:  gs.lastEnergyBus.GrantThrustW,
		PowerGrantEM:      gs.lastEnergyBus.GrantEMW,
		PowerCurtailFrac:  gs.lastEnergyBus.CurtailFrac,
		EnergyPool:        gs.couplerState.Energy,
		DragCdEff:         forceEval.DragEval.EffectiveCd,
		DragAreaRef:       forceEval.DragEval.ReferenceArea,
		PlasmaReduction:   forceEval.DragEval.PlasmaReduction,
		LiftForceMag:      forceEval.Lift.Norm(),
		ThrustForceMag:    forceEval.Thrust.Norm(),
		EMForceMag:        forceEval.EM.Norm(),
		Mach:              forceEval.DragEval.Mach,
		AoA:               forceEval.AoA,
		LiftCoeff:         forceEval.LiftCoeff,
		GLoad:             forceEval.GLoad,
		DynamicPressure:   forceEval.DynamicQ,
		HeatFlux:          forceEval.HeatFlux,
		SkinTempK:         gs.skinTempK,
		StructOK:          structOK,
		PilotOK:           pilotOK,
		WarningFlags:      strings.Join(combinedWarnings, ","),
		PilotStress:       gs.pilotStress,
		StructFatigue:     gs.structFatigue,
		GAxisLong:         forceEval.GAxisLong,
		GAxisLat:          forceEval.GAxisLat,
		GAxisVert:         forceEval.GAxisVert,
		RelGamma:          forceEval.RelGamma,
		RelBeta:           forceEval.RelBeta,

		YukawaAlpha:            gs.yukawaAlpha,
		YukawaLambda:           gs.yukawaLambda,
		YukawaRepulsionPrimary: eval.yukawaRepulsionPrimary,
		YukawaKernelPrimary:    eval.yukawaKernelPrimary,

		NegMassConvention:      eval.negMassConvention,
		QGCraft:                eval.qgCraft,
		QGCraftBase:            eval.qgCraftBase,
		QGCraftDynamicTerm:     eval.qgCraftDynamicTerm,
		QGAuthority:            eval.qgAuthority,
		QGPrimary:              eval.qgPrimary,
		InertialMassSign:       eval.inertialMassSign,
		RunawayAccelMag:        eval.runawayAccelMag,
		RunawayAccelLimit:      eval.runawayAccelLimit,
		RunawayFlag:            eval.runawayFlag,
		RunawayExpectedUnderC2: eval.runawayExpectedUnderC2,
		EffectiveInertialMass:  effInertialMass,
		EffectiveInertialScale: effInertialScale,
		ChargeRegime:           chargeRegime,

		ControlAmpTarget:      gs.controls.AmpTarget,
		ControlThetaTarget:    gs.controls.ThetaTarget,
		ControlOmegaTarget:    gs.controls.OmegaTarget,
		ControlQTarget:        gs.controls.QTarget,
		ControlBetaTarget:     gs.controls.BetaTarget,
		ControlPlasmaTarget:   gs.controls.PlasmaTarget,
		ControlThrottleTarget: gs.controls.ThrottleTarget,
		ControlThrottleApplied: gs.craft.Propulsion.Throttle,
		ControlEMChargeTarget: gs.controls.EMChargeTarget,
		ControlEFieldTarget:   gs.controls.EFieldTarget,
		ControlBFieldTarget:   gs.controls.BFieldTarget,
		ControlAxisYaw:        gs.controls.AxisYaw,
		ControlAxisPitch:      gs.controls.AxisPitch,
		ControlWarpX:          warpAxis.X,
		ControlWarpY:          warpAxis.Y,
		ControlWarpZ:          warpAxis.Z,
		ControlLockAssist:     gs.controls.LockAssist,
		ControlAmpAxis:        gs.controls.AmpAxis,
		ControlPhiAxis:        gs.controls.PhiAxis,
		ControlYawAxis:        gs.controls.YawAxis,
		ControlPitchAxis:      gs.controls.PitchAxis,
		AssistPhase:           gs.assistPhase,
		NavDistance:           gs.navDistance,
		NavVAlong:             gs.navVAlong,
		CoastCapture:          gs.coastCapture,
		NavTopReached:         gs.navTopReached,
		NavProfileReached:     gs.navProfileReached,
	}
}

func (gs *gameSession) touchLocked() {
	gs.updatedAt = time.Now().UTC()
}

func (gs *gameSession) placeCraftOnGround() {
	ground := gs.groundBodyLocked()
	r := gs.craft.Position.Sub(ground.Position)
	if r.Norm2() == 0 {
		r = mathx.Vec3{Z: 1}
	}
	n := r.Normalize()
	if n.Norm2() == 0 {
		n = mathx.Vec3{Z: 1}
	}
	minD := ground.Radius + gs.env.Ground.SurfaceEps
	gs.craft.Position = ground.Position.Add(n.Scale(minD))
	gs.craft.Velocity = ground.Velocity
}

func findYukawaPrimary(primaryName string, diag []physics.YukawaBodyDiagnostic) (float64, float64) {
	for i := range diag {
		if diag[i].Body == primaryName {
			return diag[i].RepulsionFactor, diag[i].KernelFactor
		}
	}
	if len(diag) > 0 {
		return diag[0].RepulsionFactor, diag[0].KernelFactor
	}
	return 0, 1
}

func findSignedChargePrimary(primaryName string, diag []physics.SignedChargeBodyDiagnostic) float64 {
	for i := range diag {
		if diag[i].Body == primaryName {
			return diag[i].SignedCharge
		}
	}
	if len(diag) > 0 {
		return diag[0].SignedCharge
	}
	return 0
}
