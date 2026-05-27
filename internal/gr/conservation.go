package gr

import "math"

type StressEnergyConservationDiagnostics struct {
	Residual float64
	Valid    bool
}

func ConservedEnergyJ(massKG float64, g Metric, u Vec4) float64 {
	p0 := 0.0
	for nu := 0; nu < 4; nu++ {
		p0 += massKG * g[0][nu] * u[nu]
	}
	return -C * p0
}

func FlatKineticEnergyJ(massKG float64, velocity [3]float64) float64 {
	v2 := velocity[0]*velocity[0] + velocity[1]*velocity[1] + velocity[2]*velocity[2]
	b2 := v2 / (C * C)
	if b2 >= 1 {
		return math.Inf(1)
	}
	gamma := 1 / math.Sqrt(1-b2)
	return (gamma - 1) * massKG * C * C
}

func StressEnergyConservation(p DerivativeMetricProvider, e Event, stepM float64) (StressEnergyConservationDiagnostics, error) {
	h := stepM
	if h <= 0 {
		h = 0.1
	}
	baseMetric, err := p.MetricAt(e)
	if err != nil {
		return StressEnergyConservationDiagnostics{}, err
	}
	baseInv, err := Inverse(baseMetric)
	if err != nil {
		return StressEnergyConservationDiagnostics{}, err
	}
	sumSq := 0.0
	for nu := 0; nu < 4; nu++ {
		div := 0.0
		for mu := 0; mu < 4; mu++ {
			ep, em := e, e
			ep.X[mu] += h
			em.X[mu] -= h
			cp, err := Curvature(p, ep, Vec4{C, 0, 0, 0}, h)
			if err != nil {
				return StressEnergyConservationDiagnostics{}, err
			}
			cm, err := Curvature(p, em, Vec4{C, 0, 0, 0}, h)
			if err != nil {
				return StressEnergyConservationDiagnostics{}, err
			}
			tp := raiseFirst(baseInv, cp.StressEnergy, mu, nu)
			tm := raiseFirst(baseInv, cm.StressEnergy, mu, nu)
			div += (tp - tm) / (2 * h)
		}
		sumSq += div * div
	}
	residual := math.Sqrt(sumSq)
	return StressEnergyConservationDiagnostics{
		Residual: residual,
		Valid:    !math.IsNaN(residual) && !math.IsInf(residual, 0),
	}, nil
}

func raiseFirst(inv Metric, t StressEnergy, mu, nu int) float64 {
	sum := 0.0
	for a := 0; a < 4; a++ {
		sum += inv[mu][a] * t[a][nu]
	}
	return sum
}
