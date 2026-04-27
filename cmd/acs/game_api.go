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
	"strings"
	"sync"
	"time"

	"github.com/example/acs/internal/config"
	"github.com/example/acs/internal/coupler"
	"github.com/example/acs/internal/mathx"
	"github.com/example/acs/internal/physics"
)

const (
	gameSessionTTL         = 30 * time.Minute
	gameSessionMaxCount    = 64
	gameMaxStepsPerRequest = 240
)

type gameStartRequest struct {
	Scenario      string `json:"scenario"`
	StartOnGround bool   `json:"start_on_ground"`
	ShipType      string `json:"ship_type,omitempty"`
}

type gameControlInput struct {
	AmpAxis    float64 `json:"amp_axis"`
	PhiAxis    float64 `json:"phi_axis"`
	YawAxis    float64 `json:"yaw_axis"`
	PitchAxis  float64 `json:"pitch_axis"`
	LockAssist *bool   `json:"lock_assist,omitempty"`
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
	State        gameStepState `json:"state"`
}

type gameStepResponse struct {
	State gameStepState `json:"state"`
}

type gameStopResponse struct {
	Removed bool `json:"removed"`
}

type gameStepState struct {
	Step int     `json:"step"`
	Time float64 `json:"time"`
	Dt   float64 `json:"dt"`

	CraftMass float64 `json:"craft_mass"`

	Position        mathx.Vec3 `json:"position"`
	Velocity        mathx.Vec3 `json:"velocity"`
	Speed           float64    `json:"speed"`
	Altitude        float64    `json:"altitude"`
	VerticalVel     float64    `json:"vertical_vel"`
	PrimaryPosition mathx.Vec3 `json:"primary_position"`
	PrimaryRadius   float64    `json:"primary_radius"`

	GRaw           mathx.Vec3 `json:"g_raw"`
	GRawMag        float64    `json:"g_raw_mag"`
	EffectiveG     mathx.Vec3 `json:"effective_g"`
	EffectiveGMag  float64    `json:"effective_g_mag"`
	GravPower      float64    `json:"grav_power"`
	GravityModel   string     `json:"gravity_model"`
	CouplerEnabled bool       `json:"coupler_enabled"`
	ShipType       string     `json:"ship_type"`

	CouplingC   float64 `json:"coupling_c"`
	CouplingK   float64 `json:"coupling_k"`
	CouplingPhi float64 `json:"coupling_phi"`

	PhaseError   float64 `json:"phase_error"`
	LockQuality  float64 `json:"lock_quality"`
	LockFlag     bool    `json:"lock_flag"`
	DriveAmp     float64 `json:"drive_amp"`
	OmegaBase    float64 `json:"omega_base"`
	DriveOmega   float64 `json:"drive_omega"`
	DrivePhase   float64 `json:"drive_phase"`
	PLLFreqDelta float64 `json:"pll_freq_delta"`
	OscMag       float64 `json:"osc_mag"`
	DrivePower   float64 `json:"drive_power"`
	Energy       float64 `json:"energy"`

	YukawaAlpha            float64 `json:"yukawa_alpha"`
	YukawaLambda           float64 `json:"yukawa_lambda"`
	YukawaRepulsionPrimary float64 `json:"yukawa_repulsion_primary"`
	YukawaKernelPrimary    float64 `json:"yukawa_kernel_primary"`

	NegMassConvention      string  `json:"negmass_convention"`
	QGCraft                float64 `json:"qg_craft"`
	QGPrimary              float64 `json:"qg_primary"`
	InertialMassSign       float64 `json:"inertial_mass_sign"`
	RunawayAccelMag        float64 `json:"runaway_accel_mag"`
	RunawayAccelLimit      float64 `json:"runaway_accel_limit"`
	RunawayFlag            bool    `json:"runaway_flag"`
	RunawayExpectedUnderC2 bool    `json:"runaway_expected_c2"`

	ControlAmpTarget   float64 `json:"control_amp_target"`
	ControlThetaTarget float64 `json:"control_theta_target"`
	ControlAxisYaw     float64 `json:"control_axis_yaw"`
	ControlAxisPitch   float64 `json:"control_axis_pitch"`
	ControlWarpX       float64 `json:"control_warp_x"`
	ControlWarpY       float64 `json:"control_warp_y"`
	ControlWarpZ       float64 `json:"control_warp_z"`
	ControlLockAssist  bool    `json:"control_lock_assist"`
	ControlAmpAxis     float64 `json:"control_amp_axis"`
	ControlPhiAxis     float64 `json:"control_phi_axis"`
	ControlYawAxis     float64 `json:"control_yaw_axis"`
	ControlPitchAxis   float64 `json:"control_pitch_axis"`
}

type gameControlState struct {
	AmpTarget   float64
	ThetaTarget float64
	AxisYaw     float64
	AxisPitch   float64
	LockAssist  bool
	AmpAxis     float64
	PhiAxis     float64
	YawAxis     float64
	PitchAxis   float64
}

type gameControlLimits struct {
	AmpAxisRate   float64
	PhiAxisRate   float64
	YawAxisRate   float64
	PitchAxisRate float64
	MinAxisPitch  float64
	MaxAxisPitch  float64
}

type gameGravityEval struct {
	raw          mathx.Vec3
	effective    mathx.Vec3
	gravityModel string

	yukawaRepulsionPrimary float64
	yukawaKernelPrimary    float64

	negMassConvention      string
	qgCraft                float64
	qgPrimary              float64
	inertialMassSign       float64
	runawayAccelMag        float64
	runawayAccelLimit      float64
	runawayFlag            bool
	runawayExpectedUnderC2 bool
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
	yukawaAlpha  float64
	yukawaLambda float64

	negMassConvention   string
	negMassQGCraft      float64
	negMassRunawayLimit float64
	negMassOverrides    map[string]float64

	controls gameControlState
	limits   gameControlLimits
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

	session, err := newGameSession(sessionID, cfgPath, cfg, req.StartOnGround, req.ShipType)
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

func newGameSession(id, cfgPath string, cfg config.Scenario, startOnGround bool, shipTypeOverride string) (*gameSession, error) {
	if err := cfg.Validate(); err != nil {
		return nil, err
	}

	gravityModel := strings.ToLower(strings.TrimSpace(cfg.GravityModel.Type))
	if gravityModel == "" {
		gravityModel = "coupling"
	}

	couplerState := coupler.New(cfg.CouplerRuntime())
	couplerEnabled := cfg.Coupler.Enabled && gravityModel == "coupling"
	if !couplerEnabled {
		couplerState.C = 1.0
		couplerState.K = 0.0
		couplerState.LockQuality = 0.0
		couplerState.Energy = 0.0
		couplerState.DrivePower = 0.0
	}

	axis := couplerState.Params.FieldAxisBody
	if axis.Norm2() == 0 {
		axis = mathx.Vec3{X: 0.32, Y: 0, Z: 0.95}
	}
	axis = axis.Normalize()
	if axis.Norm2() == 0 {
		axis = mathx.Vec3{X: 0.32, Y: 0, Z: 0.95}
	}
	axisYaw, axisPitch := axisYawPitchFromVec(axis)

	if couplerEnabled {
		couplerState.Params.DirectionalEnabled = true
		couplerState.Params.FieldAxisBody = axisFromYawPitch(axisYaw, axisPitch)
	}

	ampAxisRate := couplerState.Params.AmpRate
	if ampAxisRate <= 0 {
		ampAxisRate = 2.5
	}
	phiAxisRate := couplerState.Params.ThetaRate
	if phiAxisRate <= 0 {
		phiAxisRate = 3.0
	}
	yawAxisRate := 1.5
	pitchAxisRate := 1.2
	minAxisPitch := -1.45
	maxAxisPitch := 1.45

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
		yukawaAlpha:         cfg.GravityModel.Yukawa.Alpha,
		yukawaLambda:        cfg.GravityModel.Yukawa.Lambda,
		negMassConvention:   negMassConvention,
		negMassQGCraft:      negMassQGCraft,
		negMassRunawayLimit: negMassRunawayLimit,
		negMassOverrides:    copyChargeOverrides(cfg.GravityModel.NegMass.QGOverrides),
		controls: gameControlState{
			AmpTarget:   couplerState.Cmd.Amplitude,
			ThetaTarget: couplerState.Cmd.ThetaTarget,
			AxisYaw:     axisYaw,
			AxisPitch:   axisPitch,
			LockAssist:  true,
		},
		limits: gameControlLimits{
			AmpAxisRate:   ampAxisRate,
			PhiAxisRate:   phiAxisRate,
			YawAxisRate:   yawAxisRate,
			PitchAxisRate: pitchAxisRate,
			MinAxisPitch:  minAxisPitch,
			MaxAxisPitch:  maxAxisPitch,
		},
	}
	if shipType, ok := normalizeShipTypeForGame(shipTypeOverride); ok {
		session.craft.ShipType = shipType
	}

	session.controls.AmpTarget = mathx.Clamp(session.controls.AmpTarget, couplerState.Params.MinAmplitude, couplerState.Params.MaxAmplitude)
	session.controls.ThetaTarget = mathx.WrapAngle(session.controls.ThetaTarget)
	session.controls.AxisPitch = mathx.Clamp(session.controls.AxisPitch, session.limits.MinAxisPitch, session.limits.MaxAxisPitch)
	if startOnGround && session.env.Ground.Enabled {
		session.placeCraftOnGround()
	}

	return session, nil
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
		gs.applyControlsLocked(input, gs.dt)
		lastEval = gs.evaluateGravityLocked()

		primary := gs.primaryBodyLocked()
		fDrag := physics.DragForce(gs.craft, gs.env, primary)
		fNet := lastEval.effective.Scale(gs.craft.Mass).Add(fDrag)
		gs.craft.IntegrateSemiImplicit(gs.dt, fNet, mathx.Vec3{})

		if gs.env.Ground.Enabled {
			ground := gs.groundBodyLocked()
			physics.ResolveGroundContact(&gs.craft, gs.env, ground)
		}

		physics.IntegrateBodiesSemiImplicit(gs.dt, gs.env.G, gs.bodies)
		if !gs.craft.Position.IsFinite() || !gs.craft.Velocity.IsFinite() {
			return gameStepState{}, fmt.Errorf("state diverged at step %d", gs.step)
		}

		gs.step++
		gs.simTime += gs.dt
	}

	gs.touchLocked()
	return gs.buildStateLocked(lastEval), nil
}

func (gs *gameSession) applyControlsLocked(input gameControlInput, dt float64) {
	ampAxis := mathx.Clamp(input.AmpAxis, -1, 1)
	phiAxis := mathx.Clamp(input.PhiAxis, -1, 1)
	yawAxis := mathx.Clamp(input.YawAxis, -1, 1)
	pitchAxis := mathx.Clamp(input.PitchAxis, -1, 1)

	gs.controls.AmpAxis = ampAxis
	gs.controls.PhiAxis = phiAxis
	gs.controls.YawAxis = yawAxis
	gs.controls.PitchAxis = pitchAxis
	if input.LockAssist != nil {
		gs.controls.LockAssist = *input.LockAssist
	}

	gs.controls.AmpTarget = mathx.Clamp(
		gs.controls.AmpTarget+ampAxis*gs.limits.AmpAxisRate*dt,
		gs.couplerState.Params.MinAmplitude,
		gs.couplerState.Params.MaxAmplitude,
	)
	gs.controls.ThetaTarget = mathx.WrapAngle(gs.controls.ThetaTarget + phiAxis*gs.limits.PhiAxisRate*dt)
	gs.controls.AxisYaw = mathx.WrapAngle(gs.controls.AxisYaw + yawAxis*gs.limits.YawAxisRate*dt)
	gs.controls.AxisPitch = mathx.Clamp(gs.controls.AxisPitch+pitchAxis*gs.limits.PitchAxisRate*dt, gs.limits.MinAxisPitch, gs.limits.MaxAxisPitch)

	if !gs.couplerEnabled {
		return
	}

	if gs.controls.LockAssist {
		gs.couplerState.Params.PllKp = gs.basePllKp
		gs.couplerState.Params.PllKi = gs.basePllKi
	} else {
		gs.couplerState.Params.PllKp = 0
		gs.couplerState.Params.PllKi = 0
	}

	gs.couplerState.Params.DirectionalEnabled = true
	gs.couplerState.Params.FieldAxisBody = axisFromYawPitch(gs.controls.AxisYaw, gs.controls.AxisPitch)

	omegaBase := gs.couplerState.OmegaBase
	if gs.controls.LockAssist {
		omegaBase = gs.couplerState.Params.Omega0
	}
	gs.couplerState.SetCommand(coupler.Command{
		Amplitude:   gs.controls.AmpTarget,
		ThetaTarget: gs.controls.ThetaTarget,
		OmegaBase:   omegaBase,
	})
	gs.couplerState.Update(dt)
}

func axisFromYawPitch(yaw, pitch float64) mathx.Vec3 {
	p := mathx.Clamp(pitch, -1.55, 1.55)
	cp := math.Cos(p)
	v := mathx.Vec3{
		X: math.Cos(yaw) * cp,
		Y: math.Sin(yaw) * cp,
		Z: math.Sin(p),
	}
	if v.Norm2() == 0 {
		return mathx.Vec3{Z: 1}
	}
	return v.Normalize()
}

func axisYawPitchFromVec(v mathx.Vec3) (float64, float64) {
	if v.Norm2() == 0 {
		return 0, math.Pi / 2
	}
	n := v.Normalize()
	h := math.Hypot(n.X, n.Y)
	yaw := 0.0
	if h > 1e-9 {
		yaw = math.Atan2(n.Y, n.X)
	}
	pitch := math.Atan2(n.Z, h)
	return yaw, pitch
}

func (gs *gameSession) evaluateGravityLocked() gameGravityEval {
	gRaw := physics.GravityAt(gs.craft.Position, gs.env.G, gs.bodies)
	eval := gameGravityEval{
		raw:          gRaw,
		effective:    gRaw,
		gravityModel: gs.gravityModel,
	}

	switch gs.gravityModel {
	case "coupling":
		if gs.couplerEnabled {
			eval.effective = gs.couplerState.EffectiveGravityAccel(gRaw, gs.craft.Orientation)
		}
	case "yukawa":
		var diag []physics.YukawaBodyDiagnostic
		eval.effective, diag = physics.GravityAtYukawa(gs.craft.Position, gs.env.G, gs.bodies, gs.yukawaAlpha, gs.yukawaLambda)
		eval.yukawaRepulsionPrimary, eval.yukawaKernelPrimary = findYukawaPrimary(gs.primaryBodyLocked().Name, diag)
	case "negmass":
		inertialSign := 1.0
		if gs.negMassConvention == "C2" && gs.negMassQGCraft < 0 {
			inertialSign = -1
		}
		eval.inertialMassSign = inertialSign
		eval.negMassConvention = gs.negMassConvention
		eval.qgCraft = gs.negMassQGCraft
		eval.runawayAccelLimit = gs.negMassRunawayLimit
		var diag []physics.SignedChargeBodyDiagnostic
		eval.effective, diag = physics.GravityAtSignedCharge(
			gs.craft.Position,
			gs.env.G,
			gs.bodies,
			gs.negMassQGCraft,
			inertialSign,
			gs.negMassOverrides,
		)
		eval.qgPrimary = findSignedChargePrimary(gs.primaryBodyLocked().Name, diag)
		eval.runawayAccelMag = eval.effective.Norm()
		eval.runawayFlag = eval.runawayAccelMag >= gs.negMassRunawayLimit
		eval.runawayExpectedUnderC2 = eval.runawayFlag && gs.negMassConvention == "C2"
	default:
		eval.effective = gRaw
	}

	return eval
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

func (gs *gameSession) buildStateLocked(eval gameGravityEval) gameStepState {
	primary := gs.primaryBodyLocked()
	r := gs.craft.Position.Sub(primary.Position)
	d := r.Norm()
	up := mathx.Vec3{}
	if d > 0 {
		up = r.Scale(1.0 / d)
	}
	altitude := d - primary.Radius
	vertVel := gs.craft.Velocity.Sub(primary.Velocity).Dot(up)

	return gameStepState{
		Step:      gs.step,
		Time:      gs.simTime,
		Dt:        gs.dt,
		CraftMass: gs.craft.Mass,
		ShipType:  gs.craft.ShipType,

		Position:        gs.craft.Position,
		Velocity:        gs.craft.Velocity,
		Speed:           gs.craft.Velocity.Sub(primary.Velocity).Norm(),
		Altitude:        altitude,
		VerticalVel:     vertVel,
		PrimaryPosition: primary.Position,
		PrimaryRadius:   primary.Radius,

		GRaw:           eval.raw,
		GRawMag:        eval.raw.Norm(),
		EffectiveG:     eval.effective,
		EffectiveGMag:  eval.effective.Norm(),
		GravPower:      gs.craft.Mass * eval.effective.Dot(gs.craft.Velocity),
		GravityModel:   gs.gravityModel,
		CouplerEnabled: gs.couplerEnabled,

		CouplingC:   gs.couplerState.C,
		CouplingK:   gs.couplerState.K,
		CouplingPhi: gs.couplerState.Phi,

		PhaseError:   gs.couplerState.PhaseError,
		LockQuality:  gs.couplerState.LockQuality,
		LockFlag:     gs.couplerState.LockQuality >= 0.5,
		DriveAmp:     gs.couplerState.ADrive,
		OmegaBase:    gs.couplerState.OmegaBase,
		DriveOmega:   gs.couplerState.OmegaDrive,
		DrivePhase:   gs.couplerState.ThetaDrive,
		PLLFreqDelta: gs.couplerState.DeltaOmega,
		OscMag:       cmplx.Abs(gs.couplerState.Z),
		DrivePower:   gs.couplerState.DrivePower,
		Energy:       gs.couplerState.Energy,

		YukawaAlpha:            gs.yukawaAlpha,
		YukawaLambda:           gs.yukawaLambda,
		YukawaRepulsionPrimary: eval.yukawaRepulsionPrimary,
		YukawaKernelPrimary:    eval.yukawaKernelPrimary,

		NegMassConvention:      eval.negMassConvention,
		QGCraft:                eval.qgCraft,
		QGPrimary:              eval.qgPrimary,
		InertialMassSign:       eval.inertialMassSign,
		RunawayAccelMag:        eval.runawayAccelMag,
		RunawayAccelLimit:      eval.runawayAccelLimit,
		RunawayFlag:            eval.runawayFlag,
		RunawayExpectedUnderC2: eval.runawayExpectedUnderC2,

		ControlAmpTarget:   gs.controls.AmpTarget,
		ControlThetaTarget: gs.controls.ThetaTarget,
		ControlAxisYaw:     gs.controls.AxisYaw,
		ControlAxisPitch:   gs.controls.AxisPitch,
		ControlWarpX:       gs.couplerState.Params.FieldAxisBody.X,
		ControlWarpY:       gs.couplerState.Params.FieldAxisBody.Y,
		ControlWarpZ:       gs.couplerState.Params.FieldAxisBody.Z,
		ControlLockAssist:  gs.controls.LockAssist,
		ControlAmpAxis:     gs.controls.AmpAxis,
		ControlPhiAxis:     gs.controls.PhiAxis,
		ControlYawAxis:     gs.controls.YawAxis,
		ControlPitchAxis:   gs.controls.PitchAxis,
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
