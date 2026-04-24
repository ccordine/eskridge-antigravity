package physics

import "github.com/example/acs/internal/mathx"

func (c *Craft) IntegrateSemiImplicit(dt float64, force, torque mathx.Vec3) {
	if c.Mass > 0 {
		acc := force.Scale(1.0 / c.Mass)
		c.Velocity = c.Velocity.Add(acc.Scale(dt))
		c.Position = c.Position.Add(c.Velocity.Scale(dt))
	}

	ix := c.InertiaDiagonal.X
	iy := c.InertiaDiagonal.Y
	iz := c.InertiaDiagonal.Z
	if ix <= 0 || iy <= 0 || iz <= 0 {
		c.Orientation = mathx.IntegrateAngularVelocity(c.Orientation, c.AngularVelocity, dt)
		return
	}
	iw := mathx.Vec3{X: ix * c.AngularVelocity.X, Y: iy * c.AngularVelocity.Y, Z: iz * c.AngularVelocity.Z}
	gyro := c.AngularVelocity.Cross(iw)
	net := torque.Sub(gyro)
	alpha := mathx.Vec3{X: net.X / ix, Y: net.Y / iy, Z: net.Z / iz}
	c.AngularVelocity = c.AngularVelocity.Add(alpha.Scale(dt))
	c.Orientation = mathx.IntegrateAngularVelocity(c.Orientation, c.AngularVelocity, dt)
}
