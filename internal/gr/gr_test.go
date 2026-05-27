package gr

import (
	"math"
	"testing"

	"github.com/example/acs/internal/mathx"
)

func TestMinkowskiMetricConnectionAndGeodesic(t *testing.T) {
	p := FiniteDiffProvider{Provider: MinkowskiProvider{}, StepM: 0.1}
	g, err := p.MetricAt(Event{})
	if err != nil {
		t.Fatal(err)
	}
	if g != Minkowski() {
		t.Fatalf("unexpected Minkowski metric: %+v", g)
	}
	inv, err := Inverse(g)
	if err != nil {
		t.Fatal(err)
	}
	if inv != g {
		t.Fatalf("Minkowski inverse should equal itself")
	}
	gamma, _, _, err := Connection(p, Event{})
	if err != nil {
		t.Fatal(err)
	}
	if ChristoffelNorm(gamma) != 0 {
		t.Fatalf("Minkowski Christoffel should be zero")
	}
	u, err := FourVelocityFromCoordinateVelocity(p, Vec4{}, [3]float64{10, 0, 0})
	if err != nil {
		t.Fatal(err)
	}
	wl, diag, err := AdvanceCoordinateTime(p, Worldline{X: Vec4{}, U: u}, 1, IntegratorConfig{ProperTimeSubstepS: 0.01, MaxSubstepsPerTick: 200})
	if err != nil {
		t.Fatal(err)
	}
	if math.Abs(wl.X[1]-10) > 1e-6 {
		t.Fatalf("expected straight inertial motion, x=%g", wl.X[1])
	}
	if math.Abs(diag.InvariantError) > 100 {
		t.Fatalf("invariant drift too large: %g", diag.InvariantError)
	}
}

func TestSchwarzschildWeakFieldAcceleration(t *testing.T) {
	earth := SchwarzschildIsotropic{Mass: 5.972e24, GConst: G, Center: mathx.Vec3{}}
	p := FiniteDiffProvider{Provider: earth, StepM: 1}
	x := Vec4{0, 0, 0, 6372000}
	u, err := FourVelocityFromCoordinateVelocity(p, x, [3]float64{})
	if err != nil {
		t.Fatal(err)
	}
	_, diag, err := AdvanceCoordinateTime(p, Worldline{X: x, U: u}, 0.01, IntegratorConfig{ProperTimeSubstepS: 0.001, MaxSubstepsPerTick: 100})
	if err != nil {
		t.Fatal(err)
	}
	expected := -G * earth.Mass / (6372000 * 6372000)
	if math.Abs((diag.CoordinateAccel[2]-expected)/expected) > 0.6 {
		t.Fatalf("weak-field accel got %.6f want about %.6f", diag.CoordinateAccel[2], expected)
	}
}

func TestMetricInverseForImplementedMetrics(t *testing.T) {
	schwarzschild, err := SchwarzschildIsotropic{Mass: 5.972e24, GConst: G}.MetricAt(Event{X: Vec4{0, 0, 0, 6372000}})
	if err != nil {
		t.Fatal(err)
	}
	adm, err := ADMMetric(1, [3]float64{1e-4, 0, 0}, [3][3]float64{{1, 0, 0}, {0, 1, 0}, {0, 0, 1}})
	if err != nil {
		t.Fatal(err)
	}
	metrics := []Metric{
		Minkowski(),
		schwarzschild,
		adm,
	}
	for _, g := range metrics {
		inv, err := Inverse(g)
		if err != nil {
			t.Fatal(err)
		}
		for i := 0; i < 4; i++ {
			for j := 0; j < 4; j++ {
				got := 0.0
				for k := 0; k < 4; k++ {
					got += g[i][k] * inv[k][j]
				}
				want := 0.0
				if i == j {
					want = 1
				}
				if math.Abs(got-want) > 1e-9 {
					t.Fatalf("inverse product[%d,%d]=%g", i, j, got)
				}
			}
		}
	}
}

func TestInvalidADMRejected(t *testing.T) {
	if _, err := ADMMetric(0, [3]float64{}, [3][3]float64{}); err == nil {
		t.Fatalf("expected invalid lapse rejection")
	}
}
