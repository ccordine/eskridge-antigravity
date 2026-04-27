package main

import (
	"math"
	"path/filepath"
	"testing"

	"github.com/example/acs/internal/config"
	"github.com/example/acs/internal/mathx"
)

func TestWarpAxisWorldFromYawPitchCenteredAlignsLocalUp(t *testing.T) {
	position := mathx.Vec3{Z: 6_372_000}
	primary := mathx.Vec3{}

	axis := warpAxisWorldFromYawPitch(position, primary, 1.2, 0)
	want := mathx.Vec3{Z: 1}

	if got := axis.Sub(want).Norm(); got > 1e-9 {
		t.Fatalf("centered warp should align with local up: diff=%.6g axis=%+v", got, axis)
	}
}

func TestGameSessionWarpTiltProducesTangentialMotion(t *testing.T) {
	scenarioPath := filepath.Join("..", "..", "scenarios", "free_play.json")
	cfg, err := config.Load(scenarioPath)
	if err != nil {
		t.Fatalf("load scenario: %v", err)
	}

	session, err := newGameSession("test-session", scenarioPath, cfg, false, "saucer", "standard", "earth", 1)
	if err != nil {
		t.Fatalf("new session: %v", err)
	}

	session.controls.LockAssist = false
	session.controls.AmpTarget = 9
	session.controls.ThetaTarget = 2.4
	session.controls.AxisYaw = 0
	session.controls.AxisPitch = 0.9
	session.syncWarpAxisLocked()

	initial := session.craft.Position
	for i := 0; i < 1500; i++ {
		if _, err := session.Step(1, gameControlInput{}); err != nil {
			t.Fatalf("step %d: %v", i, err)
		}
	}

	final := session.craft.Position
	delta := final.Sub(initial)
	lateral := math.Hypot(delta.X, delta.Y)
	if lateral < 20 {
		t.Fatalf("expected meaningful lateral motion from warp tilt, got lateral displacement %.3f m (delta=%+v)", lateral, delta)
	}
	if math.Abs(final.Z-initial.Z) < 1 {
		t.Fatalf("expected warp tilt test to evolve position, got negligible vertical change %.6f m", final.Z-initial.Z)
	}
}

func TestGameSessionOrientationTracksWarpAxis(t *testing.T) {
	scenarioPath := filepath.Join("..", "..", "scenarios", "free_play.json")
	cfg, err := config.Load(scenarioPath)
	if err != nil {
		t.Fatalf("load scenario: %v", err)
	}

	session, err := newGameSession("test-session-orientation", scenarioPath, cfg, false, "saucer", "standard", "earth", 1)
	if err != nil {
		t.Fatalf("new session: %v", err)
	}

	session.controls.LockAssist = false
	session.controls.AxisYaw = 0.4
	session.controls.AxisPitch = 0.8
	session.syncWarpAxisLocked()
	for i := 0; i < 120; i++ {
		if _, err := session.Step(1, gameControlInput{}); err != nil {
			t.Fatalf("step %d: %v", i, err)
		}
	}

	warpAxis := session.warpAxisWorldLocked()
	bodyUp := session.craft.Orientation.Rotate(mathx.Vec3{Z: 1})
	alignment := warpAxis.Dot(bodyUp)
	if alignment < 0.995 {
		t.Fatalf("expected craft orientation to track warp axis, alignment=%.6f warp=%+v up=%+v", alignment, warpAxis, bodyUp)
	}
}
