package drive

import "math"

type EnergyEstimate struct {
	PositiveEnergyJ      float64
	NegativeEnergyJ      float64
	NetEnergyJ           float64
	AbsoluteEnergyJ      float64
	PeakEnergyDensity    float64
	AverageEnergyDensity float64
}

type PowerBudget struct {
	Enabled              bool
	EnergyAvailableJ     float64
	MaxPowerW            float64
	Efficiency           float64
	AllowUnfundedMetrics bool
	UnfundedBehavior     string
}

type PowerResult struct {
	RequestedPowerW     float64
	ActualPowerW        float64
	EnergySpentJ        float64
	UnfundedEnergyDebtJ float64
	ActualAuthority     float64
	PowerClamped        bool
	MetricUnfunded      bool
}

func ApplyPowerBudget(b PowerBudget, requestedAuthority, costJ, dt float64) PowerResult {
	if b.Efficiency <= 0 {
		b.Efficiency = 1
	}
	if dt <= 0 {
		dt = 1
	}
	requestedPower := costJ / (dt * b.Efficiency)
	out := PowerResult{
		RequestedPowerW: requestedPower,
		ActualPowerW:    requestedPower,
		EnergySpentJ:    costJ / b.Efficiency,
		ActualAuthority: requestedAuthority,
	}
	if !b.Enabled || requestedAuthority <= 0 || costJ <= 0 {
		return out
	}
	limitW := b.MaxPowerW
	if limitW <= 0 || limitW > b.EnergyAvailableJ/dt {
		limitW = b.EnergyAvailableJ / dt
	}
	if requestedPower <= limitW {
		return out
	}
	out.MetricUnfunded = true
	switch b.UnfundedBehavior {
	case "clamp":
		scale := math.Sqrt(math.Max(0, limitW/requestedPower))
		out.ActualAuthority = requestedAuthority * scale
		out.ActualPowerW = limitW
		out.EnergySpentJ = limitW * dt
		out.PowerClamped = true
	case "diagnostic_only":
		out.UnfundedEnergyDebtJ = (requestedPower - limitW) * dt
	default:
		out.UnfundedEnergyDebtJ = (requestedPower - limitW) * dt
	}
	return out
}
