# ACS (Antigravity Coupling Simulator)

Deterministic, fixed-step physics simulator in Go for an example universe where a craft modulates effective gravity through a resonant/PLL coupling subsystem.

## Build

```bash
go build -o acs ./cmd/acs
```

## Frontend Build (Tailwind + RecyclrJS)

```bash
npm install
npm run build
```

## Run

```bash
./acs run -config scenarios/free_fall.json -out out/free_fall.csv -meta out/free_fall.meta.json
./acs run -config scenarios/hover_attempt.json -out out/hover.csv
```

## Web App (Interactive Paper)

```bash
./acs serve -addr :8080 -scenarios ./scenarios -web ./web -notes ./notes
```

Then open `http://127.0.0.1:8080`.

Highlights:

- Tailwind CSS-driven interactive paper layout
- RecyclrJS fragment navigation (`/paper/*` sections)
- Interactive Flight Lab game loop with fixed-step backend sessions (`/api/game/start`, `/api/game/step`, `/api/game/stop`)
- Dual-canvas visualization (top-down + profile) with live HUD telemetry
- Scenario metadata endpoint (`/api/scenarios`)
- Scenario export endpoint (`/api/sim/export`)
- Cascading file-based notes hub at `/notes` (Markdown docs from `notes/`)
- Landing paper copy aligned to \"The Coupling Hypothesis (Eskridge Force)\" narrative

## Cascading Notes Hub (No Database)

The notes workspace is fully file-based and Git-tracked.

- Edit docs directly in `notes/**/*.md` using Vim (or any editor).
- Open `http://127.0.0.1:8080/notes` to browse the note tree and follow note links.
- Use `[[slug/path]]` links inside notes to create cascading drill-down docs.
- No database is used for notes; content is read directly from repository files at request time.

## Interactive CLI UI

```bash
./acs ui
```

This opens a terminal UI flow where you:

- Select a scenario from `scenarios/*.json`
- Confirm or override CSV/meta output paths
- Run the simulation with live progress output

## Live Chart Viz (Read-Only)

```bash
./acs viz -config scenarios/hover_attempt.json -addr 127.0.0.1:8090 -speed 1.0
```

Then open `http://127.0.0.1:8090` to watch live charts.

- The charts are interpreted from emitted sim samples.
- Visualization is strictly read-only telemetry and does not drive or mutate sim state.
- `-speed 1.0` replays samples in simulated real-time; use `-speed 5.0` for 5x faster playback.
- CSV and replay metadata are still written the same way as `acs run`.

## Docker

Build and run via compose:

```bash
PORT=9008 docker compose up --build -d
```

The web app is exposed on `127.0.0.1:${PORT:-9008}` through Nginx.
The Go app is internal-only on the compose network (`acs-app:8080`), with no host port binding.

If you previously had a conflicting container name from older config:

```bash
docker rm -f acs-web 2>/dev/null || true
```

## Core guarantees

- No direct state overrides for motion control.
- Gravity is applied only through modeled acceleration (`a_grav`) from the selected gravity model.
- Coupling model affects motion only through modeled acceleration (`C * g` or directional variant).
- Energy draw is explicit and logged.
- Deterministic replay metadata includes config SHA-256 and build version.

## Gravity Models

`gravity_model.type` selects the field model used for craft acceleration:

- `coupling`: baseline Newtonian field with coupler modulation (`C * g_raw`).
- `yukawa`: Newtonian field with Yukawa correction (`alpha`, `lambda`).
- `negmass`: signed gravitational charge model (`qg_craft`, per-body `qg_overrides`, `C1|C2` convention).

Example:

```json
"gravity_model": {
  "type": "negmass",
  "negmass": {
    "convention": "C2",
    "qg_craft": -1.0,
    "qg_overrides": { "earth": 1.0 },
    "runaway_accel_limit": 5.0
  }
}
```

## Scenario set

- `scenarios/free_fall.json`
- `scenarios/hover_attempt.json`
- `scenarios/climb.json`
- `scenarios/lock_loss.json`
- `scenarios/yukawa_repulsion.json`
- `scenarios/negmass_c1_repel.json`
- `scenarios/negmass_c2_runaway.json`

## CSV columns

`step,time,pos_*,vel_*,altitude,vertical_vel,g_raw_*,g_eff_*,gravity_model,c,k,phi,phase_error,lock_quality,omega_drive,omega_0,drive_power,energy,yukawa_*,negmass_*,runaway_*,grav_power`

## Flight Lab Controls

In `/paper/lab`:

- `A / D`: decrease/increase drive amplitude target
- `W / S`: increase/decrease phase target
- `Q / E`: rotate directional coupling axis yaw
- `Space`: toggle lock assist (PLL gains on/off)
- `R`: reset active session

The lab uses fixed dt stepping server-side and applies player input only through coupler/control targets.
