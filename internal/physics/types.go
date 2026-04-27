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
	Enabled bool
	Cd      float64
	Area    float64
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
}

type Atmosphere struct {
	Enabled     bool
	Rho0        float64
	ScaleHeight float64
	Wind        mathx.Vec3
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
}
