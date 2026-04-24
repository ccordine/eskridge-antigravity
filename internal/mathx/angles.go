package mathx

import "math"

const TwoPi = 2 * math.Pi

func WrapAngle(theta float64) float64 {
	for theta <= -math.Pi {
		theta += TwoPi
	}
	for theta > math.Pi {
		theta -= TwoPi
	}
	return theta
}

func WrapPositive(theta float64) float64 {
	for theta < 0 {
		theta += TwoPi
	}
	for theta >= TwoPi {
		theta -= TwoPi
	}
	return theta
}

func Clamp(x, lo, hi float64) float64 {
	if x < lo {
		return lo
	}
	if x > hi {
		return hi
	}
	return x
}

func MoveToward(curr, target, maxDelta float64) float64 {
	d := target - curr
	if d > maxDelta {
		return curr + maxDelta
	}
	if d < -maxDelta {
		return curr - maxDelta
	}
	return target
}

func MoveTowardAngle(curr, target, maxDelta float64) float64 {
	d := WrapAngle(target - curr)
	if d > maxDelta {
		return WrapAngle(curr + maxDelta)
	}
	if d < -maxDelta {
		return WrapAngle(curr - maxDelta)
	}
	return WrapAngle(target)
}
