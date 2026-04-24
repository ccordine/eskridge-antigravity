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
./acs serve -addr :8080 -scenarios ./scenarios -web ./web
```

Then open `http://127.0.0.1:8080`.

Highlights:

- Tailwind CSS-driven interactive paper layout
- RecyclrJS fragment navigation (`/paper/*` sections)
- Live simulation charting through read-only SSE telemetry (`/api/sim/stream`)
- Scenario metadata endpoint (`/api/scenarios`)
- Landing paper copy aligned to \"The Coupling Hypothesis (Eskridge Force)\" narrative

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
- Coupling affects motion only through modeled acceleration (`C * g` or directional variant).
- Energy draw is explicit and logged.
- Deterministic replay metadata includes config SHA-256 and build version.

## Scenario set

- `scenarios/free_fall.json`
- `scenarios/hover_attempt.json`
- `scenarios/climb.json`
- `scenarios/lock_loss.json`

## CSV columns

`step,time,pos_*,vel_*,altitude,vertical_vel,g_raw_*,g_eff_*,c,k,phi,phase_error,lock_quality,omega_drive,omega_0,drive_power,energy,grav_power`
