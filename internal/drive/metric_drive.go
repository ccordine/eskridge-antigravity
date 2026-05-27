package drive

import (
	"fmt"
	"math"

	"github.com/example/acs/internal/gr"
	"github.com/example/acs/internal/mathx"
)

type WarpShiftParams struct {
	Enabled             bool
	BubbleRadiusM       float64
	WallThicknessM      float64
	MaxBeta             float64
	Direction           mathx.Vec3
	Phase               float64
	OmegaRadPerSec      float64
	Coherence           float64
	Damping             float64
	PhaseDriftRadPerSec float64
	Authority           float64
	LapseAdjust         float64
	Modes               []OscillationMode
}

type EngineeredMetric struct {
	Environment gr.MetricProvider
	Drive       WarpShiftParams
	CraftCenter mathx.Vec3
}

type FieldParameters struct {
	Beta             mathx.Vec3
	LapseAlpha       float64
	BubbleRadius     float64
	WallThickness    float64
	Authority        float64
	Shape            float64
	PhaseRad         float64
	OmegaRadPerSec   float64
	Coherence        float64
	LockQuality      float64
	ModeCount        int
	OscillationValue float64
}

func (m EngineeredMetric) MetricAt(e gr.Event) (gr.Metric, error) {
	base := gr.Minkowski()
	var err error
	if m.Environment != nil {
		base, err = m.Environment.MetricAt(e)
		if err != nil {
			return gr.Metric{}, err
		}
	}
	params, err := m.ParametersAt(e)
	if err != nil {
		return gr.Metric{}, err
	}
	if !m.Drive.Enabled || params.Authority == 0 {
		return base, nil
	}
	alpha := math.Sqrt(math.Max(1e-30, -base[0][0])) + params.LapseAlpha
	var gamma [3][3]float64
	for i := 0; i < 3; i++ {
		for j := 0; j < 3; j++ {
			gamma[i][j] = base[i+1][j+1]
		}
	}
	beta := [3]float64{params.Beta.X, params.Beta.Y, params.Beta.Z}
	out, err := gr.ADMMetric(alpha, beta, gamma)
	if err != nil {
		return gr.Metric{}, err
	}
	for _, mode := range m.effectiveModes() {
		amp := modeValue(mode, e, m.CraftCenter, radiusOrDefault(m.Drive.BubbleRadiusM), wallOrDefault(m.Drive.WallThicknessM))
		for i := 0; i < 4; i++ {
			for j := 0; j < 4; j++ {
				out[i][j] += params.Authority * params.Coherence * amp * mode.TensorShape[i][j]
				out[j][i] = out[i][j]
			}
		}
	}
	if !gr.LorentzianSignatureValid(out) {
		return gr.Metric{}, fmt.Errorf("engineered oscillating metric is not Lorentzian")
	}
	return out, nil
}

func (m EngineeredMetric) ParametersAt(e gr.Event) (FieldParameters, error) {
	radius := m.Drive.BubbleRadiusM
	if radius <= 0 {
		radius = 20
	}
	wall := m.Drive.WallThicknessM
	if wall <= 0 {
		wall = 5
	}
	authority := math.Max(0, m.Drive.Authority)
	if authority > 1 {
		authority = 1
	}
	coherence := m.Drive.Coherence
	if coherence == 0 {
		coherence = 1
	}
	coherence = math.Max(0, math.Min(1, coherence))
	phase := m.phaseAt(e)
	osc := math.Cos(phase)
	dir := PhaseRotatedDirection(m.Drive.Direction, phase)
	dx := e.X[1] - m.CraftCenter.X
	dy := e.X[2] - m.CraftCenter.Y
	dz := e.X[3] - m.CraftCenter.Z
	r := math.Sqrt(dx*dx + dy*dy + dz*dz)
	shape := bubbleShape(r, radius, wall)
	betaMag := m.Drive.MaxBeta * authority * coherence * shape * (0.5 + 0.5*osc)
	if math.Abs(betaMag) >= 1 {
		return FieldParameters{}, fmt.Errorf("drive beta must remain subluminal in this coordinate ansatz")
	}
	return FieldParameters{
		Beta: dir.Scale(betaMag), LapseAlpha: m.Drive.LapseAdjust * authority * coherence * shape * osc,
		BubbleRadius: radius, WallThickness: wall, Authority: authority, Shape: shape,
		PhaseRad: phase, OmegaRadPerSec: m.Drive.OmegaRadPerSec, Coherence: coherence,
		LockQuality: coherence, ModeCount: len(m.effectiveModes()), OscillationValue: osc,
	}, nil
}

func (m EngineeredMetric) phaseAt(e gr.Event) float64 {
	t := e.X[0] / gr.C
	return m.Drive.Phase + (m.Drive.OmegaRadPerSec+m.Drive.PhaseDriftRadPerSec)*t
}

func (m EngineeredMetric) effectiveModes() []OscillationMode {
	if len(m.Drive.Modes) > 0 {
		return m.Drive.Modes
	}
	if m.Drive.LapseAdjust == 0 {
		return nil
	}
	mode := OscillationMode{
		Amplitude:      m.Drive.LapseAdjust,
		OmegaRadPerSec: m.Drive.OmegaRadPerSec,
		PhaseRad:       m.Drive.Phase,
		Direction:      m.Drive.Direction,
		SpatialProfile: SpatialProfileBubble,
	}
	mode.TensorShape[0][0] = -1
	return []OscillationMode{mode}
}

func modeValue(mode OscillationMode, e gr.Event, center mathx.Vec3, radius, wall float64) float64 {
	t := e.X[0] / gr.C
	dx := e.X[1] - center.X
	dy := e.X[2] - center.Y
	dz := e.X[3] - center.Z
	r := math.Sqrt(dx*dx + dy*dy + dz*dz)
	profile := bubbleShape(r, radius, wall)
	if mode.SpatialProfile == SpatialProfileWall {
		profile = wallShape(r, radius, wall)
	}
	return mode.Amplitude * profile * math.Cos(mode.OmegaRadPerSec*t+mode.PhaseRad)
}

func wallShape(r, radius, wall float64) float64 {
	if wall <= 0 {
		return 0
	}
	x := math.Abs(r-radius) / wall
	if x >= 1 {
		return 0
	}
	return 0.5 + 0.5*math.Cos(math.Pi*x)
}

func radiusOrDefault(v float64) float64 {
	if v > 0 {
		return v
	}
	return 20
}

func wallOrDefault(v float64) float64 {
	if v > 0 {
		return v
	}
	return 5
}

func bubbleShape(r, radius, wall float64) float64 {
	if wall <= 0 {
		if r <= radius {
			return 1
		}
		return 0
	}
	return 0.5 * (1 - math.Tanh((r-radius)/wall))
}
