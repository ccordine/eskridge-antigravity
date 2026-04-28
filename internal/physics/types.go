package physics

import "github.com/example/acs/internal/mathx"

type CelestialBody struct {
	Name     string
	Mass     float64
	Radius   float64
	Position mathx.Vec3
	Velocity mathx.Vec3
}

type DragModel struct {
	Enabled       bool
	Cd            float64
	Area          float64
	ReferenceSpan float64
	Plasma        PlasmaSheath
}

type AeroModel struct {
	Enabled  bool
	Cl0      float64
	ClAlpha  float64
	ClMax    float64
	StallAoA float64
}

type PropulsionModel struct {
	Enabled   bool
	Throttle  float64
	MaxThrust float64
}

type EMModel struct {
	Enabled bool
	ChargeC float64
}

type ThermalModel struct {
	Enabled               bool
	HeatTransferCoeff     float64
	RadiativeCoeff        float64
	Emissivity            float64
	MaxSkinTempK          float64
	InitialSkinTempK      float64
	ReferenceHeatCapacity float64
}

type StructuralModel struct {
	Enabled        bool
	MaxGLoad       float64
	MaxDynamicQPa  float64
	MaxHeatFluxWm2 float64
}

type PilotModel struct {
	Enabled          bool
	MaxGPositive     float64
	MaxGNegative     float64
	MaxGLongitudinal float64
	MaxGLateral      float64
	RecoveryTauS     float64
}

type PlasmaSheath struct {
	Enabled          bool
	Level            float64
	MaxDragReduction float64
	AuthoritySpeed   float64
	VelocityFalloff  float64
	PowerPerArea     float64
	IonizationGain   float64
}

type Craft struct {
	Mass            float64
	ShipType        string
	InertiaDiagonal mathx.Vec3
	Position        mathx.Vec3
	Velocity        mathx.Vec3
	Orientation     mathx.Quat
	AngularVelocity mathx.Vec3
	Drag            DragModel
	Aero            AeroModel
	Propulsion      PropulsionModel
	EM              EMModel
	Thermal         ThermalModel
	Structural      StructuralModel
	Pilot           PilotModel
}

type AtmosphereLayer struct {
	MinAlt       float64
	MaxAlt       float64
	Rho0         float64
	ScaleHeight  float64
	Temperature0 float64
	LapseRate    float64
	Gamma        float64
	GasConstant  float64
}

type Atmosphere struct {
	Enabled      bool
	Rho0         float64
	ScaleHeight  float64
	Wind         mathx.Vec3
	Temperature0 float64
	LapseRate    float64
	Gamma        float64
	GasConstant  float64
	Layers       []AtmosphereLayer
}

type GroundContact struct {
	Enabled      bool
	Restitution  float64
	BodyIndex    int
	SurfaceEps   float64
	TangentialMu float64
}

type Environment struct {
	G          float64
	Atmosphere Atmosphere
	Ground     GroundContact
	EField     mathx.Vec3
	BField     mathx.Vec3
}
