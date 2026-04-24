package main

import (
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"time"

	"github.com/example/acs/internal/config"
	"github.com/example/acs/internal/logging"
	"github.com/example/acs/internal/sim"
)

type sampleHook func(sim.Sample) error

func runScenario(cfgPath string, cfg config.Scenario, outPath, metaPath string, progress io.Writer) error {
	return runScenarioWithHook(cfgPath, cfg, outPath, metaPath, progress, nil)
}

func runScenarioWithHook(cfgPath string, cfg config.Scenario, outPath, metaPath string, progress io.Writer, hook sampleHook) error {
	outPath, metaPath = resolveOutputPaths(cfg, outPath, metaPath)

	if err := os.MkdirAll(filepath.Dir(outPath), 0o755); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(metaPath), 0o755); err != nil {
		return err
	}

	f, err := os.Create(outPath)
	if err != nil {
		return err
	}
	defer f.Close()

	logger, err := logging.NewCSVLogger(f)
	if err != nil {
		return err
	}

	totalSteps := int(math.Round(cfg.Duration / cfg.Dt))
	if totalSteps < 1 {
		totalSteps = 1
	}
	lastPrint := time.Time{}
	printProgress := func(s sim.Sample) {
		if progress == nil {
			return
		}
		stepDisplay := s.Step + cfg.LogEvery
		if stepDisplay > totalSteps {
			stepDisplay = totalSteps
		}
		isFinalSample := stepDisplay >= totalSteps
		now := time.Now()
		if !lastPrint.IsZero() && now.Sub(lastPrint) < 150*time.Millisecond && !isFinalSample {
			return
		}
		lastPrint = now
		pct := 100.0 * float64(stepDisplay) / float64(totalSteps)
		fmt.Fprintf(progress,
			"\rstep %d/%d (%.1f%%) t=%.2fs alt=%.1fm vz=%.2fm/s C=%.3f lock=%.3f E=%.0fW*s",
			stepDisplay,
			totalSteps,
			pct,
			s.Time,
			s.Altitude,
			s.VerticalVel,
			s.CouplingC,
			s.LockQuality,
			s.Energy,
		)
	}

	sink := func(s sim.Sample) error {
		if err := logger.Sample(s); err != nil {
			return err
		}
		if hook != nil {
			if err := hook(s); err != nil {
				return err
			}
		}
		printProgress(s)
		return nil
	}

	res, err := sim.Run(cfg, sink)
	if err != nil {
		if progress != nil {
			fmt.Fprintln(progress)
		}
		return err
	}
	if err := logger.Flush(); err != nil {
		if progress != nil {
			fmt.Fprintln(progress)
		}
		return err
	}
	if progress != nil {
		fmt.Fprintln(progress)
	}

	cfgHash, err := logging.ConfigSHA256(cfgPath)
	if err != nil {
		return err
	}
	meta := logging.ReplayMeta{
		Scenario:     cfg.Name,
		Seed:         cfg.Seed,
		Dt:           cfg.Dt,
		Duration:     cfg.Duration,
		Steps:        res.Steps,
		Version:      logging.BuildVersion(),
		ConfigSHA256: cfgHash,
	}
	if err := logging.WriteReplayMeta(metaPath, meta); err != nil {
		return err
	}

	fmt.Printf("wrote %s and %s\n", outPath, metaPath)
	return nil
}

func resolveOutputPaths(cfg config.Scenario, outPath, metaPath string) (string, string) {
	if outPath == "" {
		name := cfg.Name
		if name == "" {
			name = "run"
		}
		outPath = filepath.Join("out", name+".csv")
	}
	if metaPath == "" {
		metaPath = filepath.Join(filepath.Dir(outPath), trimExt(filepath.Base(outPath))+".meta.json")
	}
	return outPath, metaPath
}
