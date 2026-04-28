# Model Contract V1

This note defines the concrete simulation contract for ACS as a math-driven sim game.

Goal: one backend source of truth for dynamics, energy, constraints, and telemetry.

## 1) State-Space Core

Simulation state is evolved only by backend physics:

- `x_dot = f(x, u, p)`

Where:

- `x`: craft + environment + resonator + energy state
- `u`: pilot/control inputs (amp/phase/yaw/pitch, oscillator targets, plasma/throttle/EM targets)
- `p`: scenario + body constants + solver constants

Frontend must never compute authoritative physics outputs.

## 2) Force Contract

Net force each step:

- `F_total = F_gravity + F_coupler + F_drag + F_lift + F_thrust + F_em`

Required behavior:

1. `F_gravity`: inverse-square from celestial bodies.
2. `F_coupler`: anisotropic effective gravity from resonator/coupling state.
3. `F_drag/F_lift`: atmosphere-dependent only.
4. `F_em`: Lorentz-style force from configured field model.
5. `F_total` alone drives translational integration.

## 3) Resonator/PLL Contract

Resonator state is authoritative for coupling authority:

- lock quality
- phase error
- resonator magnitude
- coupling `C, k, phi`

Authority cannot bypass resonator state. Low lock / low Q / low beta / low amp must reduce coupling effect.

## 4) Energy Contract (High-Q Pool)

Single pool:

- `E_pool` (J)

All active subsystems request power each step:

- `P_req = {coupler, plasma, thrust, em}`

Shared allocator grants:

- `P_grant = Allocate(E_pool, dt, P_req)`

Pool update:

- `E_pool(t+dt) = E_pool(t) - dt * sum(P_grant)`

Curtailment:

- if requests exceed available energy, subsystem authority must be reduced by grant ratio.

No subsystem may silently consume energy outside allocator contract.

## 5) Constraint Contract

Constraints are not telemetry-only. They must influence physics authority:

1. Thermal (`skin_temp`, `heat_flux`) -> derate risk/warnings.
2. Structural (`dynamic_q`, fatigue) -> derate/failure risk.
3. Pilot (`g` axis loads, stress) -> derate/failure risk.

Current implementation: warning + partial derate path exists; hard failure model still simplified.

## 6) Mandatory Telemetry (Authoritative)

Must be produced by backend every frame/step:

1. Kinematics: `position`, `velocity`, `speed`, `altitude`, `vertical_vel`
2. Gravity: `g_raw`, `effective_g`, magnitudes
3. Coupler: `C`, `k`, `phi`, lock metrics, `drive_power`, resonator params
4. Force magnitudes: drag/lift/thrust/em
5. Power terms:
   - `drag_power`, `thrust_power`, `em_power`, `climb_power`, `required_power`
   - `power_req_*`, `power_grant_*`, `power_curtail_frac`, `energy_pool`
6. Constraint terms: `dynamic_pressure`, `heat_flux`, `skin_temp`, `pilot_stress`, `struct_fatigue`, warnings
7. Control targets and applied axes

Frontend may format values, but not substitute competing physics values.

## 7) Invariants (Regression)

Minimum invariant tests:

1. No atmosphere -> no drag/lift.
2. Zero EM charge -> zero EM force.
3. Mach rise increases effective drag coefficient.
4. Zero/insufficient energy grant -> curtailed authority in requested subsystems.
5. Monotonic time/step and finite state values.
6. Planet preset calibration within reference tolerances.

## 8) Current Compliance Matrix

Implemented now:

1. Unified force evaluation path in backend.
2. Resonator authority gating linked to lock/Q/beta/amp.
3. Shared allocator module (`internal/energy`) used by game + sim paths.
4. Requested/granted/curtail telemetry surfaced in API and HUD.
5. Layered atmosphere + drag/lift + EM + thermal/structural/pilot telemetry.
6. Calibration API + calibration tests.

Remaining simplifications (accepted for sim-game scope):

1. Coupler power grant effect is currently applied by authority scaling path (not a full internal coupler solver with explicit granted-power integration state equation).
2. Structural/thermal/pilot failure are reduced-order (derate/warn), not full FEM/ablation/physiology exposure models.
3. Plasma and EM are reduced-order control models, not full MHD/PIC solvers.
4. Relativity terms are audit telemetry, not fully integrated relativistic dynamics.

## 9) Recommendation: Do We Need Deeper Physics Right Now?

For a playable, concrete, math-driven sim: **No**, not immediately.

You already have the right level if:

1. all dynamics are backend-authoritative,
2. all energy use is allocator-governed and auditable,
3. all subsystem authority degrades under energy/constraint deficits,
4. invariant tests lock this behavior.

Go deeper only if your objective changes from sim-game fidelity to publishable physical prediction.

## Linked Notes

- Telemetry schema: [[simulation/telemetry-contract]]
- Scenario coverage: [[simulation/scenario-matrix]]
- Coupling claims: [[foundations/coupling-claims]]
- Program roadmap: [[roadmap/research-program]]
