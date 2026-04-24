package logging

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"runtime/debug"
	"time"
)

type ReplayMeta struct {
	GeneratedAt  string  `json:"generated_at"`
	Scenario     string  `json:"scenario"`
	Seed         int64   `json:"seed"`
	Dt           float64 `json:"dt"`
	Duration     float64 `json:"duration"`
	Steps        int     `json:"steps"`
	Version      string  `json:"version"`
	ConfigSHA256 string  `json:"config_sha256"`
}

func BuildVersion() string {
	bi, ok := debug.ReadBuildInfo()
	if !ok {
		return "dev"
	}
	for _, s := range bi.Settings {
		if s.Key == "vcs.revision" && s.Value != "" {
			return s.Value
		}
	}
	return bi.Main.Version
}

func ConfigSHA256(path string) (string, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:]), nil
}

func WriteReplayMeta(path string, meta ReplayMeta) error {
	meta.GeneratedAt = time.Now().UTC().Format(time.RFC3339)
	b, err := json.MarshalIndent(meta, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0o644)
}
