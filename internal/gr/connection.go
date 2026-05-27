package gr

func Connection(p DerivativeMetricProvider, e Event) (Christoffel, Metric, Metric, error) {
	g, err := p.MetricAt(e)
	if err != nil {
		return Christoffel{}, Metric{}, Metric{}, err
	}
	inv, err := Inverse(g)
	if err != nil {
		return Christoffel{}, Metric{}, Metric{}, err
	}
	var dg [4]Metric
	for a := 0; a < 4; a++ {
		dg[a], err = p.MetricDerivative(e, a)
		if err != nil {
			return Christoffel{}, Metric{}, Metric{}, err
		}
	}
	var gamma Christoffel
	for mu := 0; mu < 4; mu++ {
		for a := 0; a < 4; a++ {
			for b := 0; b < 4; b++ {
				sum := 0.0
				for sig := 0; sig < 4; sig++ {
					sum += inv[mu][sig] * (dg[a][b][sig] + dg[b][a][sig] - dg[sig][a][b])
				}
				gamma[mu][a][b] = 0.5 * sum
			}
		}
	}
	return gamma, g, inv, nil
}
