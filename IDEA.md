Below is a planning doc you can hand to Codex to build a fully systemic sim in Go. The sim assumes our example-universe rule: a craft can modulate its gravitational coupling via a resonant/phase-locked “6th-dimension” actuator. No direct state overrides (no “set altitude,” no teleporting, no hidden clamps). Everything must happen through modeled forces/torques + actuator dynamics + energy bookkeeping.

⸻

Antigravity Coupling Simulator (ACS) — Go Planning Doc

0) Objective

Build a deterministic physics simulator that models:

* Classical N-body gravity (Newtonian) for celestial bodies.
* A rigid-body craft whose felt gravity is modified by a coupling subsystem driven by a resonant actuator (high-Q) with a PLL-like lock.
* Optional autopilot/control logic that uses only actuators (frequency, amplitude, phase) to achieve behaviors (hover, climb, “fall forward”), never by overriding physics state.
* Energy bookkeeping for the coupling subsystem so “magic lift” always has an explicit energy/power cost.

Deliverables:

* Go CLI executable acs
* JSON/YAML scenario config + CSV logs
* Deterministic replay
* A small suite of baseline scenarios and tests

Non-goals:

* Proving real-world antigravity. This is an internal-consistency sim for the example universe.
* Ultra-high fidelity atmosphere CFD.

⸻

1) Core modeling principles (no hacks rule)

Hard rule: the sim may only change motion via:

* forces (linear) and torques (angular)
* impulses/constraints (collisions, joints) applied physically
* actuator dynamics that produce forces/torques or modify coupling variables via explicit differential equations
* energy exchange accounted for (battery/reactor → actuator → field work/losses)

Forbidden shortcuts:

* setting position/velocity/orientation directly
* “if altitude < target then teleport up”
* clamping velocities to fake stability

⸻

2) World model

2.1 Entities

* CelestialBody
    * mass, radius, position, velocity (in inertial frame)
    * optional rotation (for Earth day, magnet axis if later used)
    * gravitational parameter μ = G*M
* Craft (RigidBody)
    * mass m, inertia tensor I_body
    * pose: position p, orientation quaternion q
    * velocity v, angular velocity ω
    * geometry for drag/cross-section (coarse)
    * coupling subsystem (resonator + PLL + actuator states)
* Environment
    * gravity constant G
    * optional atmosphere model: density vs altitude, wind
    * optional ground collision plane / spherical Earth surface contact

2.2 Gravity

Base gravitational acceleration at craft location:
\mathbf{g}(\mathbf{p}) = \sum_i -G M_i \frac{\mathbf{p}-\mathbf{p_i}}{||\mathbf{p}-\mathbf{p_i}||^3}

This is the “raw” gravitational field vector.

⸻

3) The “6th-dimension coupling” model (example universe)

We define a coupling transform that modifies how the craft experiences gravity:

3.1 Minimal scalar coupling (v1)

\mathbf{a}_g = C \cdot \mathbf{g}
where C can be negative (repulsive), zero (cancel), or positive (attractive).

But we don’t let control set C directly. C comes from a resonator/PLL state.

3.2 Phase-based coupling (recommended)

Let the coupling be parameterized by:

* amplitude k ∈ [0, k_max]
* phase φ ∈ [0, 2π)

Then:
C = k \cos(\phi)
so:

* φ = 0 gives maximum attraction
* φ = π/2 cancels
* φ = π gives repulsion

3.3 Directional coupling (v2, after v1 works)

Allow gravity coupling to depend on craft orientation, like a “field axis”:

\mathbf{a}_g = C_\parallel (\hat{u}\cdot \mathbf{g})\hat{u} + C_\perp (\mathbf{g} - (\hat{u}\cdot \mathbf{g})\hat{u})

where û is a craft body axis in world frame (û = q * u_body * q⁻¹).
This yields steering-like behavior without thrust.

Start with v1, then add v2 once stable.

⸻

4) Resonator + PLL subsystem (the “knob” mechanism)

The whole point: you don’t dial k and φ by hand. You drive a resonator, it locks, and the coupling emerges.

4.1 State variables

* Drive signal: amplitude A_d, angular frequency ω_d, drive phase θ_d
* Resonator: complex amplitude Z = x + i y (or magnitude/phase A_r, θ_r)
* PLL: phase error integrator e_int, frequency correction Δω
* Output coupling: k, φ derived from resonator state
* Power supply: battery/reactor energy E_store and instantaneous P_limit

4.2 Resonator dynamics (high-Q oscillator)

Use a standard driven damped oscillator in complex form (easy for phase):
\dot{Z} = (i\omega_0 - \gamma)Z + \beta A_d e^{i\theta_d}
where:

* ω0 natural frequency (can drift with temperature)
* γ = ω0/(2Q) damping
* β coupling gain
* A_d e^{iθ_d} drive input

This creates a real resonance peak and phase lag vs frequency.

4.3 PLL (phase lock)

Compute phase error:
e = \mathrm{wrap}(\theta_r - \theta_d - \theta_{target})
Then adjust drive frequency:
\Delta\omega = K_p e + K_i \int e\,dt
\omega_d \leftarrow \omega_{base} + \Delta\omega

Also model a lock window:

* if |ω_d - ω0| too large, lock fails, phase error grows, coupling output collapses toward default.

4.4 Mapping resonator → coupling (critical)

Define:

* k = clamp(α * |Z|, 0, k_max)
* φ = wrap(θ_r + φ_bias)

φ_bias is a “polarity knob” that can be adjusted slowly by control surfaces in the subsystem (or set by configuration).

This ensures coupling is a consequence of resonator behavior.

⸻

5) Energy and “no free lunch” bookkeeping

Even in the example universe, the coupling needs a power path.

5.1 Power usage

Driving power can be modeled as:
P_{drive} = c_1 A_d^2 + c_2 |Z|^2
plus inefficiencies and thermal losses.

Enforce:

* P_drive <= P_limit
* E_store -= P_drive * dt

If E_store hits zero, actuator collapses and coupling returns to default.

5.2 Field work consistency (optional v2)

If you want tighter accounting: the modified gravity does work on the craft:
P_{grav} = m\,\mathbf{a}_g \cdot \mathbf{v}
This can be logged and compared to drive power to avoid “perpetual motion” inside the sim. You don’t have to perfectly conserve, but you should make the flow explicit.

⸻

6) Craft dynamics

6.1 Translational

\dot{\mathbf{v}} = \mathbf{a}_g + \mathbf{a}_{drag} + \mathbf{a}_{other}
\dot{\mathbf{p}} = \mathbf{v}

6.2 Rotational rigid body

Use quaternion integration:

* torque contributions could come from “directional coupling” gradients, aerodynamic moments, or explicit control torques.

Integrate:
\dot{\omega} = I^{-1}(\tau - \omega \times (I\omega))
\dot{q} = \frac{1}{2} q \otimes [0,\omega]

6.3 Atmosphere (simple, optional v1)

Drag:
\mathbf{F}_d = -\tfrac{1}{2}\rho(h) C_d A |\mathbf{v}_{rel}| \mathbf{v}_{rel}
Keep it simple at first.

⸻

7) Integrator strategy (deterministic, stable)

Use a fixed timestep dt (e.g., 1–5 ms for control stability; 10–20 ms for coarse runs).

Recommended:

* semi-implicit (symplectic) Euler for translation/rotation for stability in long runs
* RK4 as optional mode for validation

Determinism requirements:

* fixed dt
* seeded RNG only if needed (noise models)
* avoid map iteration nondeterminism for entity lists (use slices)

⸻

8) Simulation loop

Pseudocode:

for step := 0; step < steps; step++ {
    // 1) Compute world gravity g(p) at craft
    g := GravityAt(craft.pos, bodies)
    // 2) Update resonator + PLL (depends on craft state + environment)
    craft.coupler.Update(dt, g, craft, env)
    // 3) Compute effective gravity acceleration
    aG := craft.coupler.EffectiveGravityAccel(g, craft.orientation)
    // 4) Compute other forces (drag, ground contact, etc.)
    F := craft.mass * aG + DragForce(...) + OtherForces(...)
    // 5) Integrate rigid body
    craft.Integrate(dt, F, torque)
    // 6) Handle constraints/collisions
    ResolveGroundContact(&craft, env)
    // 7) Log
    logger.Sample(step, craft, coupler, g)
}

No shortcuts. If you want hover, the controller must adjust drive parameters and the coupler must respond.

⸻

9) Control layer (optional, but useful)

Implement autopilot as a module that only sets:

* A_d (drive amplitude)
* θ_target (phase target / bias)
* optional ω_base target

Inputs:

* altitude error
* vertical velocity
* lock quality indicators (phase error, |Z|)

Outputs:

* drive parameter commands, passed through actuator rate limits and saturations

Rate limits are important so control remains systemic:

* dA/dt max
* dθ_target/dt max

⸻

10) Configuration & scenarios

Use JSON or YAML to define:

* bodies (Earth only initially)
* craft mass/inertia/drag params
* coupler params (ω0, Q, β, k_max, power limits)
* initial conditions
* controller on/off and gains

Baseline scenarios:

1. Free fall with coupler off (sanity)
2. Hover attempt: coupler on, controller targets a≈0
3. Climb: command slight negative C or tuned phase offset
4. Lock loss: perturb ω0 (simulate heating) and see drop
5. Directional coupling (later): tip craft and see lateral acceleration

⸻

11) Output & tooling

* CSV logs: time, position, velocity, g_raw magnitude, C, k, φ, phase error, drive power, energy remaining
* Optional: simple 2D plot tool (separate) or dump to a format a notebook can plot
* Deterministic replay: record config + seed + version hash

⸻

12) Testing plan

Unit tests:

* gravity field for known cases (single body, two body symmetry)
* integrator sanity: energy drift bounds in a simple orbit (with coupler off)
* resonator response: amplitude peak near ω0, phase shift behavior
* PLL lock: lock range and recovery
* coupler mapping: k,φ -> C correctness

Simulation “golden” tests:

* scenario run produces stable hover within tolerance given fixed seed and dt
* lock loss causes predictable descent, no NaNs, no explosion

⸻

13) Milestones (recommended build order)

M1: Core math + rigid body + gravity, craft falls, logs look sane
M2: Resonator model produces stable Z and realistic phase behavior
M3: Coupler maps resonator → C and modifies gravity; no controller yet
M4: Simple controller holds hover (in 1D first) with actuator limits
M5: Energy bookkeeping and lock-loss behavior
M6: Directional coupling v2 + basic attitude dynamics
M7: Scenario pack + replay + regression tests

⸻

14) Known risks / gotchas

* High-Q + tight PLL can cause numerical stiffness. Keep dt small and rate limit control.
* If you let C swing too quickly, you’ll get violent accelerations. That’s fine if it’s a real outcome; just ensure it’s caused by modeled dynamics, not integrator blowup.
* Vacuum vs atmosphere: if later you add airflow coupling, keep it clearly separated from “6th-dimension coupling” so you don’t accidentally build an ion-wind sim and call it warp.

⸻

15) Acceptance criteria (“fully systemic” checklist)

* No direct state overrides for craft pose/velocity.
* Hover emerges only from coupler dynamics + controller, with power draw.
* Turning power off drops the craft.
* Logs show coherent phase-lock behavior when stable.
* Runs are deterministic given same config + seed.

⸻

If you want, I can also provide a Go package skeleton (folders, interfaces, key structs) that Codex can paste directly into a repo and start filling in.
