# Research Overview

This is the root note for the entire Eskridge Force research workspace.

Use this file as the big-picture map, then keep splitting each block into its own note file.
All links use `[[slug/path]]` so they can be traversed in the cascading notes hub.

## Core Threads

- Problem framing and assumptions: [[foundations/problem-frame]]
- Coupling claim and model constraints: [[foundations/coupling-claims]]
- Simulation scenario coverage: [[simulation/scenario-matrix]]
- Telemetry contract and data schema: [[simulation/telemetry-contract]]
- Falsification and experiment design: [[experiments/falsification-plan]]
- Program roadmap and milestones: [[roadmap/research-program]]
- Paper structure and narrative flow: [[writing/paper-outline]]
- Shared terminology and definitions: [[glossary/terms]]

## Recursion Workflow

1. Write a dense block here.
2. Pull it into a dedicated note file.
3. Replace the dense block with a `[[child/note]]` link.
4. Repeat until each note has one clear job.

## Current Open Questions

- What precise lock thresholds are physically meaningful versus purely control-tuning artifacts?
- Which telemetry metrics are required for claim-level falsification?
- What is the minimum scenario set required to make the paper coherent end to end?




Okay so we start with gravity
Gravity comes from mass
Gravity has effectively infinite range, but drops down in strength exponentially
EM fields also have effectively infinite range but also drowp down in strength exponentially
EM fields may be the inherent result of the liquid matter being charged to pull it closer but get so hot that they float back out, the core may be crystalizing in a way, which may explain what happened to Mars
Light effectively has infinite range but also drops down in strength exponentially like the others
Gravity, Light, and EM fields are all limited by the speed of light, if the sun were to disappear, we'd still feal the effects of it's gravity until it visually diappeared
There is indeed this thing where certain metals can be attracted over a long period of time which is negative energy ( I explained this terribly, revisit ) Casimir effect
Mass is a collective of atoms
Atoms can attract or repel from each other
atoms that attract to each other build up their pull, like a stacking magnets
desnsity is how tightly packed those atoms are together within a space
Crystals can be timed to a specific energy based on their size and the energy going into them
HOW DOES OSCILATION WORK?
we can use oscilation to counter-act the pull to cancel it out
coupling resonance  so the effect is huge for a small input
oscilation gives the knov to flip the sign on whether we are being pulled by gravity or repelled, by default we couple to the earth, from there we cacel it out or even invert it
high-Q resonator ( stores the oscillatory energy )
with phase lock keeps the drive aligned to the response
same logic as keeping a PLL locked
keeping a laser cavity coherent
keeping an inverted pendulum upright via a periodic drive
big LC resonator / coil + capacitor bank
arranged as a cavity/geometry that concentrates field energy
with adjustable frequency/tuning and adjustable phase/polarity
- find the resonance, sweep the frequency, look for a sharp response peak
- measure coupling drift, how quickly it collapses without drive
- phase-flip test, does the sign of the effect reverse at 180 shift?
- lock stability, does it hold under perturbations?

look for a drop in weight as C approaches 0
turn off oscillation C 1 weight returns

you add energy in phase every cycle so the amplitude builds up a lot once the right frequency has been found for oscilation, this is because energy is constantly rubberbanding in and out, so it's never at capacity
when you add energy into a system of 2 or more oscilating bodies, you are controlling energy density, which has a natural cap before you start losing it, which I assume may also relate to energy capacity within the other body and timing, eventually energy density would get so tight in on that frequency that there is a lack of a difference, and you begin losing energy, like a tire popping from too much air, but it will naturally stop losing air again if you stop putting in more energy
resonant pumping and energy storage limits
at high amplitudes you start hitting nonlinearities that either detune you or spill energy into other channels
we would require a ssytem that can
- maximize Q
- track resonance drift
- keep phase aligned
- avoid saturation/breakdwon

vibration patterns with sand on speakers
using audio for propulsion or assistance

Coating itself in orange plasma Ion wind /EHD thrust, MHD control
