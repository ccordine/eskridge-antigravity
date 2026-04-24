# Scenario Matrix

Track each scenario's purpose and pass/fail intent.

## Current Set

- `free_fall`: baseline gravity behavior with coupler disabled.
- `hover_attempt`: control-loop stabilization target around fixed altitude.
- `climb`: positive ascent regime under constrained power.
- `lock_loss`: controlled failure and gravity return behavior.

## Additions Queue

- Thermal drift sweep with varying lock windows.
- Directional coupling stress tests under non-vertical targets.
- Energy exhaustion edge case battery.

## Linked Notes

- Telemetry contract: [[simulation/telemetry-contract]]
- Program sequencing: [[roadmap/research-program]]
