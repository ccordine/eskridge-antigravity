package mathx

import "math"

// Vec3 is a deterministic 3D vector helper with value semantics.
type Vec3 struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	Z float64 `json:"z"`
}

func V3(x, y, z float64) Vec3 {
	return Vec3{X: x, Y: y, Z: z}
}

func (a Vec3) Add(b Vec3) Vec3 {
	return Vec3{X: a.X + b.X, Y: a.Y + b.Y, Z: a.Z + b.Z}
}

func (a Vec3) Sub(b Vec3) Vec3 {
	return Vec3{X: a.X - b.X, Y: a.Y - b.Y, Z: a.Z - b.Z}
}

func (a Vec3) Scale(s float64) Vec3 {
	return Vec3{X: a.X * s, Y: a.Y * s, Z: a.Z * s}
}

func (a Vec3) Dot(b Vec3) float64 {
	return a.X*b.X + a.Y*b.Y + a.Z*b.Z
}

func (a Vec3) Cross(b Vec3) Vec3 {
	return Vec3{
		X: a.Y*b.Z - a.Z*b.Y,
		Y: a.Z*b.X - a.X*b.Z,
		Z: a.X*b.Y - a.Y*b.X,
	}
}

func (a Vec3) Norm2() float64 {
	return a.Dot(a)
}

func (a Vec3) Norm() float64 {
	return math.Sqrt(a.Norm2())
}

func (a Vec3) Normalize() Vec3 {
	n := a.Norm()
	if n == 0 {
		return Vec3{}
	}
	return a.Scale(1.0 / n)
}

func (a Vec3) IsFinite() bool {
	return isFinite(a.X) && isFinite(a.Y) && isFinite(a.Z)
}

func isFinite(v float64) bool {
	return !math.IsNaN(v) && !math.IsInf(v, 0)
}
