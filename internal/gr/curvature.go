package gr

import "math"

type CurvatureDiagnostics struct {
	Ricci                 Ricci
	Einstein              Einstein
	StressEnergy          StressEnergy
	RicciScalar           float64
	EinsteinTensorNorm    float64
	StressEnergyDensity   float64
	NegativeEnergyFlag    bool
	NECViolationFlag      bool
	MaxCurvatureMagnitude float64
	MetricDeterminant     float64
	SignatureValid        bool
}

func Curvature(p DerivativeMetricProvider, e Event, observer Vec4, stepM float64) (CurvatureDiagnostics, error) {
	gamma, g, inv, err := Connection(p, e)
	if err != nil {
		return CurvatureDiagnostics{}, err
	}
	h := stepM
	if h <= 0 {
		h = 0.1
	}
	var dGamma [4]Christoffel
	for coord := 0; coord < 4; coord++ {
		ep, em := e, e
		ep.X[coord] += h
		em.X[coord] -= h
		gp, _, _, err := Connection(p, ep)
		if err != nil {
			return CurvatureDiagnostics{}, err
		}
		gm, _, _, err := Connection(p, em)
		if err != nil {
			return CurvatureDiagnostics{}, err
		}
		for mu := 0; mu < 4; mu++ {
			for a := 0; a < 4; a++ {
				for b := 0; b < 4; b++ {
					dGamma[coord][mu][a][b] = (gp[mu][a][b] - gm[mu][a][b]) / (2 * h)
				}
			}
		}
	}
	var ric Ricci
	for m := 0; m < 4; m++ {
		for n := 0; n < 4; n++ {
			sum := 0.0
			for a := 0; a < 4; a++ {
				sum += dGamma[a][a][m][n] - dGamma[n][a][m][a]
				for b := 0; b < 4; b++ {
					sum += gamma[a][a][b]*gamma[b][m][n] - gamma[a][n][b]*gamma[b][m][a]
				}
			}
			ric[m][n] = sum
		}
	}
	R := 0.0
	for m := 0; m < 4; m++ {
		for n := 0; n < 4; n++ {
			R += inv[m][n] * ric[m][n]
		}
	}
	var ein Einstein
	var t StressEnergy
	scale := math.Pow(C, 4) / (8 * math.Pi * G)
	maxCurv := math.Abs(R)
	for m := 0; m < 4; m++ {
		for n := 0; n < 4; n++ {
			ein[m][n] = ric[m][n] - 0.5*g[m][n]*R
			t[m][n] = scale * ein[m][n]
			maxCurv = math.Max(maxCurv, math.Abs(ric[m][n]))
		}
	}
	rho := 0.0
	for m := 0; m < 4; m++ {
		for n := 0; n < 4; n++ {
			rho += t[m][n] * observer[m] * observer[n] / (C * C)
		}
	}
	null := Vec4{1, 1, 0, 0}
	nec := 0.0
	for m := 0; m < 4; m++ {
		for n := 0; n < 4; n++ {
			nec += t[m][n] * null[m] * null[n]
		}
	}
	return CurvatureDiagnostics{
		Ricci: ric, Einstein: ein, StressEnergy: t, RicciScalar: R,
		EinsteinTensorNorm: Norm(ein), StressEnergyDensity: rho,
		NegativeEnergyFlag: rho < 0, NECViolationFlag: nec < 0,
		MaxCurvatureMagnitude: maxCurv, MetricDeterminant: Determinant(g),
		SignatureValid: LorentzianSignatureValid(g),
	}, nil
}
