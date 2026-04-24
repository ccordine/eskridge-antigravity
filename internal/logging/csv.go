package logging

import (
	"encoding/csv"
	"fmt"
	"io"
	"strconv"

	"github.com/example/acs/internal/sim"
)

type CSVLogger struct {
	w *csv.Writer
}

func NewCSVLogger(out io.Writer) (*CSVLogger, error) {
	w := csv.NewWriter(out)
	l := &CSVLogger{w: w}
	header := []string{
		"step", "time",
		"pos_x", "pos_y", "pos_z",
		"vel_x", "vel_y", "vel_z",
		"altitude", "vertical_vel",
		"g_raw_x", "g_raw_y", "g_raw_z", "g_raw_mag",
		"g_eff_x", "g_eff_y", "g_eff_z", "g_eff_mag",
		"c", "k", "phi",
		"phase_error", "lock_quality",
		"omega_drive", "omega_0",
		"drive_power", "energy",
		"grav_power",
	}
	if err := w.Write(header); err != nil {
		return nil, err
	}
	return l, nil
}

func (l *CSVLogger) Sample(s sim.Sample) error {
	record := []string{
		itoa(s.Step), f64(s.Time),
		f64(s.Position.X), f64(s.Position.Y), f64(s.Position.Z),
		f64(s.Velocity.X), f64(s.Velocity.Y), f64(s.Velocity.Z),
		f64(s.Altitude), f64(s.VerticalVel),
		f64(s.GRaw.X), f64(s.GRaw.Y), f64(s.GRaw.Z), f64(s.GRawMag),
		f64(s.EffectiveG.X), f64(s.EffectiveG.Y), f64(s.EffectiveG.Z), f64(s.EffectiveGMag),
		f64(s.CouplingC), f64(s.CouplingK), f64(s.CouplingPhi),
		f64(s.PhaseError), f64(s.LockQuality),
		f64(s.OmegaDrive), f64(s.Omega0),
		f64(s.DrivePower), f64(s.Energy),
		f64(s.GravPower),
	}
	return l.w.Write(record)
}

func (l *CSVLogger) Flush() error {
	l.w.Flush()
	if err := l.w.Error(); err != nil {
		return fmt.Errorf("csv flush failed: %w", err)
	}
	return nil
}

func f64(v float64) string {
	return strconv.FormatFloat(v, 'g', 16, 64)
}

func itoa(v int) string {
	return strconv.Itoa(v)
}
