package drive

import (
	"math"

	"github.com/example/acs/internal/gr"
	"github.com/example/acs/internal/mathx"
)

type SpatialProfile string

const (
	SpatialProfileBubble SpatialProfile = "bubble"
	SpatialProfileWall   SpatialProfile = "wall"
)

type OscillationMode struct {
	Amplitude      float64
	OmegaRadPerSec float64
	PhaseRad       float64
	Direction      mathx.Vec3
	TensorShape    gr.Mat4
	SpatialProfile SpatialProfile
}

type ResonanceController struct {
	Modes                       []OscillationMode
	LockQuality                 float64
	Authority                   float64
	Damping                     float64
	PhaseDriftRadPerSec         float64
	ExternalCurvatureTarget     float64
	CockpitCancellationTarget   float64
	BubbleWallConfinementTarget float64
}

type MetricDriveState struct {
	PhaseRad          float64
	OmegaRadPerSec    float64
	Authority         float64
	Coherence         float64
	BubbleRadiusM     float64
	WallThicknessM    float64
	ShiftBeta         mathx.Vec3
	LapsePerturbation float64
}

func (r *ResonanceController) Update(dt float64) {
	if r == nil || dt <= 0 {
		return
	}
	if r.Damping < 0 {
		r.Damping = 0
	}
	decay := math.Exp(-r.Damping * dt)
	r.LockQuality *= decay
	for i := range r.Modes {
		r.Modes[i].PhaseRad += r.PhaseDriftRadPerSec * dt
	}
}
