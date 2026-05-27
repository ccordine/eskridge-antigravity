package gr

import "fmt"

func ADMMetric(alpha float64, beta [3]float64, gamma [3][3]float64) (Metric, error) {
	if alpha <= 0 {
		return Metric{}, fmt.Errorf("adm lapse must be positive")
	}
	var g Metric
	g[0][0] = -alpha * alpha
	for i := 0; i < 3; i++ {
		for j := 0; j < 3; j++ {
			g[i+1][j+1] = gamma[i][j]
			g[0][i+1] += gamma[i][j] * beta[j]
		}
		g[i+1][0] = g[0][i+1]
		g[0][0] += beta[i] * g[0][i+1]
	}
	if !LorentzianSignatureValid(g) {
		return Metric{}, fmt.Errorf("adm metric is not Lorentzian")
	}
	return g, nil
}
