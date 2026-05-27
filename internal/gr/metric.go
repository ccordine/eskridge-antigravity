package gr

type MinkowskiProvider struct{}

func (MinkowskiProvider) MetricAt(Event) (Metric, error) { return Minkowski(), nil }

type FiniteDiffProvider struct {
	Provider MetricProvider
	StepM    float64
}

func (p FiniteDiffProvider) MetricAt(e Event) (Metric, error) {
	return p.Provider.MetricAt(e)
}

func (p FiniteDiffProvider) MetricDerivative(e Event, coord int) (Metric, error) {
	h := p.StepM
	if h <= 0 {
		h = 0.1
	}
	ep, em := e, e
	ep.X[coord] += h
	em.X[coord] -= h
	gp, err := p.Provider.MetricAt(ep)
	if err != nil {
		return Metric{}, err
	}
	gm, err := p.Provider.MetricAt(em)
	if err != nil {
		return Metric{}, err
	}
	var d Metric
	for i := 0; i < 4; i++ {
		for j := 0; j < 4; j++ {
			d[i][j] = (gp[i][j] - gm[i][j]) / (2 * h)
		}
	}
	return d, nil
}
