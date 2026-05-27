package gr

import (
	"fmt"
	"math"
)

const (
	C = 299792458.0
	G = 6.67430e-11
)

type Vec4 [4]float64
type Mat4 [4][4]float64
type Metric = Mat4
type Christoffel [4][4][4]float64
type Ricci = Mat4
type Einstein = Mat4
type StressEnergy = Mat4

type Event struct {
	X Vec4
}

type MetricProvider interface {
	MetricAt(event Event) (Metric, error)
}

type DerivativeMetricProvider interface {
	MetricProvider
	MetricDerivative(event Event, coord int) (Metric, error)
}

func Minkowski() Metric {
	return Metric{{-1, 0, 0, 0}, {0, 1, 0, 0}, {0, 0, 1, 0}, {0, 0, 0, 1}}
}

func Identity() Mat4 {
	return Mat4{{1, 0, 0, 0}, {0, 1, 0, 0}, {0, 0, 1, 0}, {0, 0, 0, 1}}
}

func Contract(g Metric, u, v Vec4) float64 {
	sum := 0.0
	for a := 0; a < 4; a++ {
		for b := 0; b < 4; b++ {
			sum += g[a][b] * u[a] * v[b]
		}
	}
	return sum
}

func Norm(m Mat4) float64 {
	sum := 0.0
	for i := 0; i < 4; i++ {
		for j := 0; j < 4; j++ {
			sum += m[i][j] * m[i][j]
		}
	}
	return math.Sqrt(sum)
}

func ChristoffelNorm(gamma Christoffel) float64 {
	sum := 0.0
	for mu := 0; mu < 4; mu++ {
		for a := 0; a < 4; a++ {
			for b := 0; b < 4; b++ {
				sum += gamma[mu][a][b] * gamma[mu][a][b]
			}
		}
	}
	return math.Sqrt(sum)
}

func Determinant(a Mat4) float64 {
	m := a
	det := 1.0
	sign := 1.0
	for i := 0; i < 4; i++ {
		pivot := i
		maxAbs := math.Abs(m[i][i])
		for r := i + 1; r < 4; r++ {
			if v := math.Abs(m[r][i]); v > maxAbs {
				maxAbs = v
				pivot = r
			}
		}
		if maxAbs < 1e-30 {
			return 0
		}
		if pivot != i {
			m[i], m[pivot] = m[pivot], m[i]
			sign *= -1
		}
		p := m[i][i]
		det *= p
		for r := i + 1; r < 4; r++ {
			f := m[r][i] / p
			for c := i; c < 4; c++ {
				m[r][c] -= f * m[i][c]
			}
		}
	}
	return sign * det
}

func Inverse(a Mat4) (Mat4, error) {
	m := a
	inv := Identity()
	for i := 0; i < 4; i++ {
		pivot := i
		maxAbs := math.Abs(m[i][i])
		for r := i + 1; r < 4; r++ {
			if v := math.Abs(m[r][i]); v > maxAbs {
				maxAbs = v
				pivot = r
			}
		}
		if maxAbs < 1e-30 || math.IsNaN(maxAbs) || math.IsInf(maxAbs, 0) {
			return Mat4{}, fmt.Errorf("singular metric")
		}
		if pivot != i {
			m[i], m[pivot] = m[pivot], m[i]
			inv[i], inv[pivot] = inv[pivot], inv[i]
		}
		p := m[i][i]
		for c := 0; c < 4; c++ {
			m[i][c] /= p
			inv[i][c] /= p
		}
		for r := 0; r < 4; r++ {
			if r == i {
				continue
			}
			f := m[r][i]
			for c := 0; c < 4; c++ {
				m[r][c] -= f * m[i][c]
				inv[r][c] -= f * inv[i][c]
			}
		}
	}
	return inv, nil
}

func LorentzianSignatureValid(g Metric) bool {
	if Determinant(g) >= 0 {
		return false
	}
	if g[0][0] >= 0 {
		return false
	}
	for i := 1; i < 4; i++ {
		if g[i][i] <= 0 {
			return false
		}
	}
	return true
}
