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

WHAT IS PLL?
Phase locked loop
a control system that makes one scillator match/lock onto another oscillator's phase and frequency
PLLs keep the oscillators sync'd
The basic pieces
- reference signal
- VCO/NCO a controllable oscillator you can speed up or slow down
- phase detector, measures phase difference between reference and your oscillator
- loop filter, smooths that error so you dont jitter
- feedback, adjust the oscillator until the phase error goes to a stable small value

same as...
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


Knobs required:
Frequency
target the right frequency for oscilation, the natural frequency of the target

Phase
adding or subtracting energy to maintain oscilation

Amplitude ( drive power )
More power ramps the stored energy faster until you hit limits

Q / losses
High Q means the energy stays in the oscillation longer so it can build bigger
How do we control that?
So that's can be influenced by springs mechanically

we can use a plasma sheath as a boundary layer to control drag and stability
if we ionize the air right near the surface, we can use electric/magnetic fields to push that ionized layer around a bit
that can
- keep airflow attached longer
- reduce forms of turbulence
- improve control authority at high speeds/angles
- potentially reduce drag in certain regimes

It can also help with shockwave shaping to at very high speeds where most drag and heat comes from

MHD flow control
- accelerate/decelerate the flow locally
- act like a field-based control surface
- potentially reduce sonic boom signatures in some concepts

plasma can also mess with radars/ tracking/ returns

Limits ( nonlinearities/breakdown )
at high energy the system detunes saturates heats arcs or breaks

Step 0 — Idle safe state

* Coupler off
* C \approx 1 (normal gravity)
* system monitoring only

Practical Switch flip
Step 1 - Spin-up (find resonance and lock)

* Start low drive amplitude
* Sweep/track until the resonator response peaks
* Engage PLL; confirm stable lock (phase error small, stable amplitude)

Step 2 - Build coupling authority (raise k)

* Increase drive amplitude gradually (rate-limited)
* Watch for detuning, heating, nonlinearities
* Confirm k rises predictably without phase slips

Step 3 - Transition to cancel (move φ toward π/2)

* Adjust phase bias toward “cancel”
* You’re watching the real outcome: the craft’s effective weight dropping
* Controller trims so you don’t “bounce” or overshoot

Step 4 - Hover and control

* Maintain lock continuously
* Use small adjustments to φ (and/or k) to regulate altitude like a throttle
* Use geometry controls (if available) to translate laterally / steer

Step 5 - Land / disengage

* Move φ back toward 0 and/or reduce k
* Return C \to 1 gradually (soft re-coupling)
* Coupler off

How do we orient ourselves towards the earth properly if we have decoupled from the earth?
I would imagine we'd use a combination of spinning for a gyroscopic effect, I've thought about this a lot ever since I was a child, and you would essentially have the outside spin but a pod in the center that stays static, like a giant gyroscope
You would also use the earth's EM field for orientation, knowing where north is, where south is
Note that how this works is that you would generate a gravity field, and then you would arrange it in such a way that one side is falling, and that is how you get the movement, because it is falling but moving the source of gravity with it, like how a satelite works, but scaled to the extremes
You could have some EM detector that would tell you which way to orient and then make your adjustments, you'd probably use the plasma field to change the shape of the body and resistance which will change the orientation, like wings that you can materialize, smart bodies capable of dynamic flight and movement

Apparently because of this anti-gravity system, we may be able to also counteract our experience of the pressures of the earth, which makes a lot of sense, since we're using powered decoupling to counter gravities effects on us  or isolate us from the effects of gravity. That also leads me to wonder about this system and the capacity to phase through mass, as well as it's effect on time, I would expect that you would experience time differently since you are now decoupled from earth's gravity, which would explain the link to me of P47s and P52s that she seemed to allude to. Admittedly I've been thinking a LOT about Stone Ocean now

How would we do interstellar travel?
Well it would kind of be the opposite wouldn't it? What you would do is now find some other celestial body to sync to? Not really, while gravity and EM fields are effectively infinite, so you could go to whatever it is you see, and maybe you could use the the visual signal as something more complex than simply just looking at it, maybe it could be used in tandem with someway to isolate the EM and gravity fields? Not sure, but essentially what you would do to fly this thing would be playing around with the lean and the influence to earth's gravity, you could effectively play with physics in such a way that you slingshot yourself out into space by adjusting the antigravity system in just the right way, even coupling back to earth to use gravity to speed you up before decoupling and launching faster than before and using plasma and etc to remove wind resistance

Conceptually, if you've seen how resonnace works on a metal surface, like a speaker and such, and you put sand on a metal plate, and you strike atuning fokr and affix it to the plate, the sand will form specific patterns. I hypothesize that if you were to fluctuate with those at the right frequency, you can use that to displace air around the surface to cut through wind resistance, essentially you'd keep cycling through a series of patterns at extreme speeds to where the air is gradually being removed and unable to return, if this is happening above the craft, it can also help with lift, but again if we're messing with anti-gravity shields around it, it really might not matter as much the shape in terms of air resistance, but I guess not, it does still have physical properties and still can crash into things, so this suggests that it would actually want to go and use such a system, now is it more or less power efficient than plasma and effectiveness too is important

Though ofcourse once you can break from one body, you can break from another, and you can also use the body's gravity to slingshot you, and I think yeah this is a warp drive right?

1) A geodesic drive (engineered free-fall)

You’re not "pushing" the craft. You’re shaping the local field so the craft is always in free fall along a path you choose.

- Inside feels like weightless "falling"
- Outside sees you accelerate/curve because the path is curved

In our example, you do that by shaping the coupling field: one side of the craft is effectively “more coupled” than the other, so the craft "falls" in that direction.

2) An inertialess / internal-gravity drive (your ship "makes a gravity gradient")

Same idea, framed as: you generate a local gravity-like gradient and ride it. It’s like continuously creating a downhill slope and letting yourself slide.

That’s why "falling forward" is the right intuition.

How it differs from Alcubierre-style warp

Alcubierre warp: move spacetime (contract in front, expand behind).
Geodesic/gravity drive: keep spacetime mostly "normal", but create a local curvature/gradient so your natural free-fall path goes where you want.

So really this gives us access to warp drives for interstellar travel. Shout out to PBS Spacetime, who I will be watching all night about this now

Perfect resonant energy vault:
So I had this idea, I was only thinking before about crystals sloshing around between 2 of them, but then I had an idea. What if you had this geometry of them linked together, so that it's all perfectly aligned and timed so that the capacity gets insane and the loss is extremely low, and then you'd a shit ton of energy into it to make it as dense as possible, ideally this geometry would make the density much more possible, and the timing much more reaonable

If I had to take a wild guess it's something related to a 3, 6, or 9, or that trio of numbers, as some sort of guide for scaling and laying out these proportions

My exact phrasing was a singularity of peizo electric energy, this would be the High Q system

Now power? How does that work? Bob Lazar talks about this element that can be made with hydron colliders, but is unstable, did you know that oscilation and resonnance can make things stabilize? Built in compact nuclear power

I found a video today on from Bob Lazar on the power, this isn't important to the simulation itself exactly, but it's interesting
element 115 is bombarded with a proton and then it turns into element 116
immediately decays
irradiates antimater release in a vaccuum into a tune tube
matter and antimater collide to cancel out and convert into energy
it then interacts with the gassiest matter target at the end of the tune tube
nearly 100% efficient heat to energy reactor

element 115 is musocovium

moscovium can be created with a hydron collider but it comes out unstable however we can identify the frequency it resonates at we can stablize it as long as we can pump energy into it to sustain it

