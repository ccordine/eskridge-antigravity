# Metric Engineering Claims

This note holds the current model claims so language stays consistent across simulation and writing.

## Primary Assumptions

- General relativity is the rulebook.
- Gravity is modeled through spacetime geometry, not a reversible force.
- The speculative Eskridge Drive capability is local control of a metric perturbation `h_mu_nu`.
- Drive phase, resonance, and authority modify metric parameters such as ADM shift, lapse, and bubble shape.
- Oscillating modes are modeled as `h_mu_nu(x,t) = sum_k mode_k(x) amplitude_k cos(omega_k t + phi_k)`.
- Phase can redistribute curvature/stress-energy, reduce cockpit tidal diagnostics, or confine stress toward a bubble wall.
- Phase does not globally cancel required stress-energy, bypass Einstein's equation, or directly touch craft velocity.
- Engineered metric perturbations must be paid for through the drive power ledger, clamped, failed, or reported as unfunded energy debt.
- Stationary drive-off metrics should conserve `E = -c p_0`; dynamic engineered metrics must report craft energy exchange and approximate conservation error.
- Power source, resonator substrate, exotic stress source, conversion efficiency, metric engine, GR solver, and energy ledger are separate modules.
- Moscovium is a candidate resonator/stabilizer substrate, not a hardcoded answer and not an unaccounted power source.
- Craft motion follows geodesics through the total metric.

## Runtime Equation Chain

```text
controller/resonator -> metric parameters -> g_mu_nu -> Gamma^mu_ab -> geodesic -> worldline
```

The obsolete `a_g = C * g` coupling model is retained only as historical context, not as active runtime behavior.

## Required Diagnostics

- Metric determinant and Lorentzian signature validity.
- Four-velocity invariant error.
- Christoffel and curvature magnitudes.
- Einstein tensor and stress-energy estimate.
- Negative-energy and null-energy-condition diagnostics where practical.

## Linked Notes

- Telemetry schema: [[simulation/telemetry-contract]]
- Scenario behavior checks: [[simulation/scenario-matrix]]
- Falsification tests: [[experiments/falsification-plan]]
