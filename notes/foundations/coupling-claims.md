# Coupling Claims

This note holds the exact model claims so language stays consistent across simulation and writing.

## Primary Equations

- Effective gravitational acceleration: `a_g = C * g`
- Hover regime target: `C ~= 0`
- Repulsive regime hypothesis: `C < 0`

## Control Constraints

- Lock quality and phase error determine stability windows.
- Coupling ramps must be rate-limited.
- Energy and power ceilings are explicit state variables.

## Linked Notes

- Telemetry schema: [[simulation/telemetry-contract]]
- Scenario behavior checks: [[simulation/scenario-matrix]]
- Falsification tests: [[experiments/falsification-plan]]
