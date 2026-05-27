package gr

import (
	"fmt"
	"math"
)

type Worldline struct {
	X Vec4
	U Vec4
}

type IntegratorConfig struct {
	ProperTimeSubstepS float64
	MaxSubstepsPerTick int
}

type StepDiagnostics struct {
	ProperTimeAdvancedS float64
	Substeps            int
	InvariantError      float64
	Renormalization     float64
	ChristoffelNorm     float64
	CoordinateAccel     [3]float64
}

func FourVelocityFromCoordinateVelocity(p MetricProvider, x Vec4, v [3]float64) (Vec4, error) {
	g, err := p.MetricAt(Event{X: x})
	if err != nil {
		return Vec4{}, err
	}
	w := Vec4{1, v[0] / C, v[1] / C, v[2] / C}
	q := Contract(g, w, w)
	if q >= 0 {
		return Vec4{}, fmt.Errorf("coordinate velocity is not timelike")
	}
	scale := C / math.Sqrt(-q)
	return Vec4{scale * w[0], scale * w[1], scale * w[2], scale * w[3]}, nil
}

func CoordinateVelocity(u Vec4) [3]float64 {
	if u[0] == 0 {
		return [3]float64{}
	}
	return [3]float64{C * u[1] / u[0], C * u[2] / u[0], C * u[3] / u[0]}
}

func AdvanceCoordinateTime(p DerivativeMetricProvider, wl Worldline, dt float64, cfg IntegratorConfig) (Worldline, StepDiagnostics, error) {
	h := cfg.ProperTimeSubstepS
	if h <= 0 {
		h = 5e-4
	}
	maxSteps := cfg.MaxSubstepsPerTick
	if maxSteps <= 0 {
		maxSteps = 1000
	}
	targetX0 := wl.X[0] + C*dt
	var diag StepDiagnostics
	if d0, _, err := deriv(p, wl); err == nil {
		diag.CoordinateAccel = coordinateAcceleration(wl.U, d0.U)
	}
	for diag.Substeps < maxSteps && wl.X[0] < targetX0 {
		remainTau := (targetX0 - wl.X[0]) / math.Max(wl.U[0], 1e-9)
		step := math.Min(h, remainTau)
		var cn float64
		var err error
		wl, cn, err = rk4(p, wl, step)
		if err != nil {
			return wl, diag, err
		}
		corr, err := NormalizeFourVelocity(p, &wl)
		if err != nil {
			return wl, diag, err
		}
		diag.Renormalization = math.Max(diag.Renormalization, corr)
		diag.ChristoffelNorm = math.Max(diag.ChristoffelNorm, cn)
		diag.ProperTimeAdvancedS += step
		diag.Substeps++
	}
	if wl.X[0] < targetX0 {
		return wl, diag, fmt.Errorf("geodesic integrator exceeded max substeps before coordinate dt completed")
	}
	g, err := p.MetricAt(Event{X: wl.X})
	if err != nil {
		return wl, diag, err
	}
	diag.InvariantError = Contract(g, wl.U, wl.U) + C*C
	return wl, diag, nil
}

func coordinateAcceleration(u, du Vec4) [3]float64 {
	if u[0] == 0 {
		return [3]float64{}
	}
	den := u[0] * u[0] * u[0]
	return [3]float64{
		C * C * (du[1]*u[0] - u[1]*du[0]) / den,
		C * C * (du[2]*u[0] - u[2]*du[0]) / den,
		C * C * (du[3]*u[0] - u[3]*du[0]) / den,
	}
}

func rk4(p DerivativeMetricProvider, y Worldline, h float64) (Worldline, float64, error) {
	k1, n1, err := deriv(p, y)
	if err != nil {
		return y, 0, err
	}
	k2, n2, err := deriv(p, addScaled(y, k1, h*0.5))
	if err != nil {
		return y, 0, err
	}
	k3, n3, err := deriv(p, addScaled(y, k2, h*0.5))
	if err != nil {
		return y, 0, err
	}
	k4, n4, err := deriv(p, addScaled(y, k3, h))
	if err != nil {
		return y, 0, err
	}
	out := y
	for i := 0; i < 4; i++ {
		out.X[i] += h * (k1.X[i] + 2*k2.X[i] + 2*k3.X[i] + k4.X[i]) / 6
		out.U[i] += h * (k1.U[i] + 2*k2.U[i] + 2*k3.U[i] + k4.U[i]) / 6
	}
	return out, math.Max(math.Max(n1, n2), math.Max(n3, n4)), nil
}

func deriv(p DerivativeMetricProvider, y Worldline) (Worldline, float64, error) {
	gamma, _, _, err := Connection(p, Event{X: y.X})
	if err != nil {
		return Worldline{}, 0, err
	}
	var d Worldline
	d.X = y.U
	for mu := 0; mu < 4; mu++ {
		sum := 0.0
		for a := 0; a < 4; a++ {
			for b := 0; b < 4; b++ {
				sum += gamma[mu][a][b] * y.U[a] * y.U[b]
			}
		}
		d.U[mu] = -sum
	}
	return d, ChristoffelNorm(gamma), nil
}

func addScaled(y, k Worldline, h float64) Worldline {
	out := y
	for i := 0; i < 4; i++ {
		out.X[i] += h * k.X[i]
		out.U[i] += h * k.U[i]
	}
	return out
}

func NormalizeFourVelocity(p MetricProvider, wl *Worldline) (float64, error) {
	g, err := p.MetricAt(Event{X: wl.X})
	if err != nil {
		return 0, err
	}
	old := wl.U[0]
	a := g[0][0]
	b := 2 * (g[0][1]*wl.U[1] + g[0][2]*wl.U[2] + g[0][3]*wl.U[3])
	c := C * C
	for i := 1; i < 4; i++ {
		for j := 1; j < 4; j++ {
			c += g[i][j] * wl.U[i] * wl.U[j]
		}
	}
	disc := b*b - 4*a*c
	if disc < 0 || a == 0 {
		return 0, fmt.Errorf("cannot normalize non-timelike four-velocity")
	}
	root := math.Sqrt(disc)
	u0a := (-b + root) / (2 * a)
	u0b := (-b - root) / (2 * a)
	if u0a > 0 {
		wl.U[0] = u0a
	} else {
		wl.U[0] = u0b
	}
	if wl.U[0] <= 0 {
		return 0, fmt.Errorf("normalized four-velocity points backward in coordinate time")
	}
	return math.Abs(wl.U[0]-old) / math.Max(math.Abs(old), 1), nil
}
