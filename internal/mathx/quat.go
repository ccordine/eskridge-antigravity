package mathx

import "math"

// Quat is a Hamilton quaternion used for orientation integration.
type Quat struct {
	W float64 `json:"w"`
	X float64 `json:"x"`
	Y float64 `json:"y"`
	Z float64 `json:"z"`
}

func IdentityQuat() Quat {
	return Quat{W: 1}
}

func (q Quat) Normalize() Quat {
	n := math.Sqrt(q.W*q.W + q.X*q.X + q.Y*q.Y + q.Z*q.Z)
	if n == 0 {
		return IdentityQuat()
	}
	return Quat{W: q.W / n, X: q.X / n, Y: q.Y / n, Z: q.Z / n}
}

func (a Quat) Mul(b Quat) Quat {
	return Quat{
		W: a.W*b.W - a.X*b.X - a.Y*b.Y - a.Z*b.Z,
		X: a.W*b.X + a.X*b.W + a.Y*b.Z - a.Z*b.Y,
		Y: a.W*b.Y - a.X*b.Z + a.Y*b.W + a.Z*b.X,
		Z: a.W*b.Z + a.X*b.Y - a.Y*b.X + a.Z*b.W,
	}
}

func (q Quat) Conj() Quat {
	return Quat{W: q.W, X: -q.X, Y: -q.Y, Z: -q.Z}
}

func (q Quat) Rotate(v Vec3) Vec3 {
	p := Quat{X: v.X, Y: v.Y, Z: v.Z}
	r := q.Mul(p).Mul(q.Conj())
	return Vec3{X: r.X, Y: r.Y, Z: r.Z}
}

func IntegrateAngularVelocity(q Quat, omega Vec3, dt float64) Quat {
	wq := Quat{X: omega.X, Y: omega.Y, Z: omega.Z}
	qdot := q.Mul(wq)
	qdot.W *= 0.5
	qdot.X *= 0.5
	qdot.Y *= 0.5
	qdot.Z *= 0.5
	q.W += qdot.W * dt
	q.X += qdot.X * dt
	q.Y += qdot.Y * dt
	q.Z += qdot.Z * dt
	return q.Normalize()
}
