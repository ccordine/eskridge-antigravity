package coupler

import (
	"math"
	"testing"
)

func TestActiveCouplingMapping(t *testing.T) {
	if v := ActiveCoupling(1.0, 0); math.Abs(v-1.0) > 1e-12 {
		t.Fatalf("phi=0 should be max attraction, got %v", v)
	}
	if v := ActiveCoupling(1.0, math.Pi/2); math.Abs(v) > 1e-12 {
		t.Fatalf("phi=pi/2 should cancel, got %v", v)
	}
	if v := ActiveCoupling(1.0, math.Pi); math.Abs(v+1.0) > 1e-12 {
		t.Fatalf("phi=pi should repel, got %v", v)
	}
}

func TestResonatorPeakNearNaturalFrequency(t *testing.T) {
	base := Params{
		Omega0:           20,
		Q:                30,
		Beta:             1,
		Alpha:            1,
		KMax:             100,
		DefaultC:         1,
		PllKp:            0,
		PllKi:            0,
		PowerC1:          0,
		PowerC2:          0,
		EnergyInitial:    1,
		MinAmplitude:     0,
		MaxAmplitude:     10,
		AmpRate:          100,
		ThetaRate:        100,
		MinOmegaBase:     0,
		MaxOmegaBase:     100,
		OmegaBaseRate:    100,
		InitialAmplitude: 1,
	}

	on := New(base)
	on.SetCommand(Command{Amplitude: 1, OmegaBase: 20, ThetaTarget: 0})
	off := New(base)
	off.SetCommand(Command{Amplitude: 1, OmegaBase: 28, ThetaTarget: 0})

	dt := 0.001
	for i := 0; i < 20000; i++ {
		on.Update(dt)
		off.Update(dt)
	}
	if cmag(on.Z) <= cmag(off.Z)*1.5 {
		t.Fatalf("expected near-resonance amplitude peak, on=%f off=%f", cmag(on.Z), cmag(off.Z))
	}
}

func TestPLLLockReducesFrequencyError(t *testing.T) {
	p := Params{
		Omega0:           30,
		Q:                20,
		Beta:             1,
		Alpha:            1,
		KMax:             10,
		DefaultC:         1,
		PllKp:            10,
		PllKi:            5,
		LockOmegaWindow:  8,
		LockCollapse:     1,
		LockRecover:      3,
		PowerC1:          0,
		PowerC2:          0,
		EnergyInitial:    1,
		MinAmplitude:     0,
		MaxAmplitude:     10,
		AmpRate:          100,
		ThetaRate:        100,
		MinOmegaBase:     0,
		MaxOmegaBase:     60,
		OmegaBaseRate:    100,
		InitialAmplitude: 2,
		InitialOmegaBase: 25,
	}
	s := New(p)
	s.SetCommand(Command{Amplitude: 2, OmegaBase: 25, ThetaTarget: 0})

	initialErr := math.Abs(s.OmegaDrive - s.Params.Omega0)
	for i := 0; i < 30000; i++ {
		s.Update(0.0005)
	}
	finalErr := math.Abs(s.OmegaDrive - s.Params.Omega0)
	if finalErr >= initialErr {
		t.Fatalf("pll did not reduce frequency error: initial=%f final=%f", initialErr, finalErr)
	}
	if s.LockQuality < 0.2 {
		t.Fatalf("expected some lock quality recovery, got %f", s.LockQuality)
	}
}

func cmag(z complex128) float64 {
	return math.Hypot(real(z), imag(z))
}
