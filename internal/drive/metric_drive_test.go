package drive

import (
	"math"
	"testing"

	"github.com/example/acs/internal/gr"
	"github.com/example/acs/internal/mathx"
)

func TestOscillatingPerturbationChangesWithTime(t *testing.T) {
	mode := OscillationMode{
		Amplitude:      1e-6,
		OmegaRadPerSec: 2 * math.Pi,
		SpatialProfile: SpatialProfileBubble,
	}
	mode.TensorShape[1][1] = 1
	provider := EngineeredMetric{
		Environment: gr.MinkowskiProvider{},
		CraftCenter: mathx.Vec3{},
		Drive: WarpShiftParams{
			Enabled:        true,
			BubbleRadiusM:  20,
			WallThicknessM: 5,
			MaxBeta:        1e-5,
			Direction:      mathx.Vec3{Z: 1},
			Authority:      1,
			Coherence:      1,
			Modes:          []OscillationMode{mode},
		},
	}
	g0, err := provider.MetricAt(gr.Event{X: gr.Vec4{0, 0, 0, 0}})
	if err != nil {
		t.Fatal(err)
	}
	g1, err := provider.MetricAt(gr.Event{X: gr.Vec4{0.5 * gr.C, 0, 0, 0}})
	if err != nil {
		t.Fatal(err)
	}
	if g0[1][1] == g1[1][1] {
		t.Fatalf("same position at different oscillation phase should change metric")
	}
	if !gr.LorentzianSignatureValid(g0) || !gr.LorentzianSignatureValid(g1) {
		t.Fatalf("valid oscillating perturbation must remain Lorentzian")
	}
}

func TestX0DerivativeUsesCTScale(t *testing.T) {
	mode := OscillationMode{
		Amplitude:      1e-6,
		OmegaRadPerSec: 3,
		PhaseRad:       math.Pi / 2,
		SpatialProfile: SpatialProfileBubble,
	}
	mode.TensorShape[1][1] = 1
	provider := gr.FiniteDiffProvider{
		Provider: EngineeredMetric{
			Environment: gr.MinkowskiProvider{},
			Drive: WarpShiftParams{
				Enabled:        true,
				BubbleRadiusM:  20,
				WallThicknessM: 5,
				MaxBeta:        1e-5,
				Direction:      mathx.Vec3{Z: 1},
				Authority:      1,
				Coherence:      1,
				Modes:          []OscillationMode{mode},
			},
		},
		StepM: 1000,
	}
	dg, err := provider.MetricDerivative(gr.Event{X: gr.Vec4{}}, 0)
	if err != nil {
		t.Fatal(err)
	}
	want := -mode.Amplitude * mode.OmegaRadPerSec / gr.C
	if math.Abs((dg[1][1]-want)/want) > 0.05 {
		t.Fatalf("d/dx0 scale mismatch got %.18g want %.18g", dg[1][1], want)
	}
}
