# ACS (Eskridge Metric Engineering Simulator)

Deterministic Go simulator for a GR-first version of the Eskridge Drive premise.

The simulator assumes general relativity is correct: gravity is not a force, and the craft does not cancel or reverse gravitational acceleration. The speculative assumption is that the drive can generate and control a local metric perturbation `h_mu_nu`. Controls change metric parameters; craft motion is computed by integrating geodesics through the resulting spacetime metric.

Runtime pipeline:

```text
controller/resonator -> metric parameters -> g_mu_nu -> Gamma^mu_ab -> geodesic -> worldline
```

The drive outputs metric parameters, not acceleration.

## Conservation And Power

The simulator does not allow antigravity or warp behavior for free. In GR mode, the craft moves by geodesic integration through the current metric. If the metric is fixed, geodesic motion requires no thrust. If the Eskridge Drive engineers a local metric perturbation, the simulator estimates the implied stress-energy tensor and charges that cost to the drive energy ledger, clamps authority, fails the scenario, or reports explicit unfunded energy debt according to `metric_model.drive_power`.

For stationary metrics, telemetry reports the conserved Killing-energy diagnostic:

```text
p_mu = m g_mu_nu U^nu
E = -c p_0
```

Phase and resonance may optimize or redistribute stress-energy, but they do not create free energy or bypass local conservation laws.

## Source Stack

The drive energy model is modular:

- `raw_power_source` supplies joules and watts: fission, fusion, antimatter, beamed power, capacitor discharge, black-hole/Hawking, vacuum/Casimir, dark-matter, moscovium storage, or `debug_infinite`.
- `resonator_substrate` controls coherence, phase stability, coupling efficiency, and safe metric authority.
- `exotic_stress_source` represents negative-energy/vacuum-state/stress-shaping capacity; it is not a simple battery.
- `conversion_efficiency` converts source output into usable metric-engineering authority with explicit losses.

Moscovium is modeled as a candidate resonator/stabilizer substrate, optionally as a hypothetical actively stabilized metastable/island-of-stability material. It may improve coherence, phase stability, confinement, or coupling efficiency. It does not provide free antigravity, free energy, direct acceleration, or any bypass around the Einstein tensor/stress-energy accounting.

## Phase And Resonance

The Eskridge Drive uses phase-locked oscillating metric perturbations to shape local spacetime geometry:

```text
h_mu_nu(x,t) = sum_k mode_k(x) amplitude_k cos(omega_k t + phi_k)
```

The coordinate convention is still `x^0 = ct`, so time derivatives in Christoffel and curvature calculations are derivatives with respect to meters: `d/dx^0 = (1/c) d/dt`.

Phase and resonance can create constructive or destructive interference in selected regions. The simulator can use this to reduce cockpit tidal stress, improve geodesic targeting, time-average oscillating diagnostics, or confine curvature into a bubble wall. This does not remove the stress-energy requirement and does not bypass Einstein's equation. Phase changes `h_mu_nu`; it never directly changes craft velocity.

## Build

```bash
go build -o acs ./cmd/acs
```

## Run

```bash
./acs run -config scenarios/gr_minkowski_inertial.json
./acs run -config scenarios/gr_schwarzschild_fall.json
./acs run -config scenarios/gr_metric_hover.json
./acs run -config scenarios/gr_warp_shift_climb.json
```

CSV and replay metadata are written to `out/` unless overridden with `-out` and `-meta`.

## Metric Models

Scenarios use `metric_model`, not `gravity_model`.

- `minkowski`: flat spacetime validation model.
- `schwarzschild_isotropic`: single spherical primary body in isotropic Cartesian coordinates.
- `engineered_metric`: Schwarzschild or Minkowski environment plus an ADM-style local warp-shift ansatz.

The ADM drive metric uses signature `(-,+,+,+)` and coordinates `x^0 = ct`, `x^1..x^3` in meters. Four-velocity is normalized with `g_mu_nu U^mu U^nu = -c^2`.

## Diagnostics

Telemetry includes metric determinant/signature checks, Christoffel norm, invariant error, coordinate/proper time, ADM shift `beta`, lapse, drive phase/frequency/coherence, mode count, bubble parameters, Ricci scalar, Einstein tensor norm, instantaneous and cycle-averaged stress-energy density estimates, cockpit and bubble-wall curvature/tidal diagnostics, phase cancellation/confinement scores, energy ledger fields, unfunded energy debt, conservation error, local stress-energy conservation residual, negative-energy flags, NEC violation flags, and geodesic acceleration diagnostics.

Stress-energy is estimated from:

```text
T_mu_nu = c^4 / (8 pi G) G_mu_nu
```

This exposes the source tensor implied by the selected engineered metric, including exotic-energy and energy-condition diagnostics when present.

## Notes

Legacy Newtonian antigravity mechanisms are obsolete as runtime behavior. `C*g`, Yukawa repulsion, negative-mass signed-charge models, and effective-gravity coupling are not active metric models.

The old resonator/coupler concept may only act as a phase/authority controller for metric parameters.
