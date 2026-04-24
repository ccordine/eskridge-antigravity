package main

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"html/template"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/example/acs/internal/config"
	"github.com/example/acs/internal/logging"
	"github.com/example/acs/internal/sim"
)

var slugRe = regexp.MustCompile(`^[a-z0-9_-]+$`)

type paperServer struct {
	tmpl         *template.Template
	webDir       string
	paperDir     string
	assetsDir    string
	scenariosDir string
}

type pageData struct {
	InitialSection template.HTML
}

type scenarioInfo struct {
	Name     string  `json:"name"`
	Path     string  `json:"path"`
	Dt       float64 `json:"dt"`
	Duration float64 `json:"duration"`
	LogEvery int     `json:"log_every"`
}

func serveCmd(args []string) error {
	fs := flag.NewFlagSet("serve", flag.ContinueOnError)
	addr := fs.String("addr", ":8080", "HTTP listen address")
	scenariosDir := fs.String("scenarios", "scenarios", "scenario directory")
	webDir := fs.String("web", "web", "web assets/templates root directory")
	if err := fs.Parse(args); err != nil {
		return err
	}

	s, err := newPaperServer(*webDir, *scenariosDir)
	if err != nil {
		return err
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/", s.handleHome)
	mux.HandleFunc("/paper/", s.handlePaperSection)
	mux.HandleFunc("/api/scenarios", s.handleScenarios)
	mux.HandleFunc("/api/sim/stream", s.handleSimStream)
	mux.HandleFunc("/api/sim/export", s.handleSimExport)
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = w.Write([]byte("ok\n"))
	})
	mux.Handle("/assets/", http.StripPrefix("/assets/", http.FileServer(http.Dir(s.assetsDir))))

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/assets/") || strings.HasPrefix(r.URL.Path, "/api/") || strings.HasPrefix(r.URL.Path, "/paper/") || r.URL.Path == "/healthz" || r.URL.Path == "/" {
			mux.ServeHTTP(w, r)
			return
		}
		http.NotFound(w, r)
	})

	fmt.Printf("ACS paper server listening on %s\n", *addr)
	fmt.Printf("open http://127.0.0.1%s\n", normalizeAddrForLocal(*addr))
	return http.ListenAndServe(*addr, handler)
}

func newPaperServer(webDir, scenariosDir string) (*paperServer, error) {
	tplPath := filepath.Join(webDir, "templates", "index.html")
	tpl, err := template.ParseFiles(tplPath)
	if err != nil {
		return nil, fmt.Errorf("parse template %s: %w", tplPath, err)
	}

	s := &paperServer{
		tmpl:         tpl,
		webDir:       webDir,
		paperDir:     filepath.Join(webDir, "paper"),
		assetsDir:    filepath.Join(webDir, "static", "assets"),
		scenariosDir: scenariosDir,
	}

	if _, err := os.Stat(s.assetsDir); err != nil {
		return nil, fmt.Errorf("assets missing at %s; run npm run build first: %w", s.assetsDir, err)
	}
	if _, err := os.Stat(s.paperDir); err != nil {
		return nil, fmt.Errorf("paper sections directory missing at %s: %w", s.paperDir, err)
	}
	return s, nil
}

func (s *paperServer) handleHome(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	section, err := s.readSection("overview")
	if err != nil {
		http.Error(w, "failed to load section", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := s.tmpl.Execute(w, pageData{InitialSection: template.HTML(section)}); err != nil {
		http.Error(w, "failed to render", http.StatusInternalServerError)
	}
}

func (s *paperServer) handlePaperSection(w http.ResponseWriter, r *http.Request) {
	slug := strings.TrimPrefix(r.URL.Path, "/paper/")
	slug = strings.TrimSpace(slug)
	if slug == "" {
		slug = "overview"
	}

	section, err := s.readSection(slug)
	if err != nil {
		http.NotFound(w, r)
		return
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = io.WriteString(w, section)
}

func (s *paperServer) readSection(slug string) (string, error) {
	if !slugRe.MatchString(slug) {
		return "", errors.New("invalid slug")
	}
	path := filepath.Join(s.paperDir, slug+".html")
	b, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func (s *paperServer) handleScenarios(w http.ResponseWriter, _ *http.Request) {
	choices, err := discoverScenarios(s.scenariosDir)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	infos := make([]scenarioInfo, 0, len(choices))
	for _, choice := range choices {
		cfg, err := config.Load(choice.Path)
		if err != nil {
			continue
		}
		infos = append(infos, scenarioInfo{
			Name:     choice.Name,
			Path:     choice.Path,
			Dt:       cfg.Dt,
			Duration: cfg.Duration,
			LogEvery: cfg.LogEvery,
		})
	}

	sort.Slice(infos, func(i, j int) bool { return infos[i].Name < infos[j].Name })
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(infos)
}

func (s *paperServer) handleSimStream(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	scenarioArg := r.URL.Query().Get("scenario")
	cfgPath, cfg, err := s.resolveScenario(scenarioArg)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	speed := 1.0
	if raw := strings.TrimSpace(r.URL.Query().Get("speed")); raw != "" {
		if v, err := strconv.ParseFloat(raw, 64); err == nil {
			speed = v
		}
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	writePayload := func(v any) error {
		b, err := json.Marshal(v)
		if err != nil {
			return err
		}
		if _, err := io.WriteString(w, "data: "); err != nil {
			return err
		}
		if _, err := w.Write(b); err != nil {
			return err
		}
		if _, err := io.WriteString(w, "\n\n"); err != nil {
			return err
		}
		flusher.Flush()
		return nil
	}

	ctx := r.Context()
	start := map[string]any{
		"type":           "start",
		"scenario":       cfg.Name,
		"config":         cfgPath,
		"dt":             cfg.Dt,
		"duration":       cfg.Duration,
		"log_every":      cfg.LogEvery,
		"playback_speed": speed,
	}
	if err := writePayload(start); err != nil {
		return
	}

	sampleCount := 0
	hasClockBase := false
	baseWall := time.Time{}
	baseSim := 0.0

	sink := func(sample sim.Sample) error {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		if speed > 0 {
			if !hasClockBase {
				hasClockBase = true
				baseWall = time.Now()
				baseSim = sample.Time
			}
			targetOffset := time.Duration(((sample.Time - baseSim) / speed) * float64(time.Second))
			sleepFor := baseWall.Add(targetOffset).Sub(time.Now())
			if sleepFor > 0 {
				timer := time.NewTimer(sleepFor)
				select {
				case <-ctx.Done():
					timer.Stop()
					return ctx.Err()
				case <-timer.C:
				}
			}
		}

		sampleCount++
		payload := map[string]any{
			"type":         "sample",
			"step":         sample.Step,
			"time":         sample.Time,
			"altitude":     sample.Altitude,
			"vertical_vel": sample.VerticalVel,
			"coupling_c":   sample.CouplingC,
			"coupling_k":   sample.CouplingK,
			"lock_quality": sample.LockQuality,
			"energy":       sample.Energy,
			"drive_power":  sample.DrivePower,
		}
		return writePayload(payload)
	}

	runErr := runSimOnly(cfg, sink)
	done := map[string]any{
		"type":         "done",
		"sample_count": sampleCount,
	}
	if runErr != nil && !errors.Is(runErr, contextCanceledError(ctx)) {
		done["error"] = runErr.Error()
	}
	_ = writePayload(done)
}

func (s *paperServer) handleSimExport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	scenarioArg := r.URL.Query().Get("scenario")
	cfgPath, cfg, err := s.resolveScenario(scenarioArg)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	format := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("format")))
	if format == "" {
		format = "zip"
	}

	csvData, metaData, err := runScenarioArtifacts(cfgPath, cfg)
	if err != nil {
		http.Error(w, "failed to generate export", http.StatusInternalServerError)
		return
	}

	baseName := sanitizeDownloadName(cfg.Name)
	timestamp := time.Now().UTC().Format("20060102-150405")

	w.Header().Set("Cache-Control", "no-store")
	switch format {
	case "csv":
		filename := fmt.Sprintf("%s-%s.csv", baseName, timestamp)
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
		_, _ = w.Write(csvData)
	case "meta", "json":
		filename := fmt.Sprintf("%s-%s.meta.json", baseName, timestamp)
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
		_, _ = w.Write(metaData)
	case "zip":
		zipData, err := zipScenarioArtifacts(baseName, csvData, metaData)
		if err != nil {
			http.Error(w, "failed to package export", http.StatusInternalServerError)
			return
		}
		filename := fmt.Sprintf("%s-%s-export.zip", baseName, timestamp)
		w.Header().Set("Content-Type", "application/zip")
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
		_, _ = w.Write(zipData)
	default:
		http.Error(w, "invalid format (expected zip, csv, or meta)", http.StatusBadRequest)
	}
}

func runSimOnly(cfg config.Scenario, sink func(sim.Sample) error) error {
	_, err := sim.Run(cfg, sink)
	return err
}

func runScenarioArtifacts(cfgPath string, cfg config.Scenario) ([]byte, []byte, error) {
	var csvBuffer bytes.Buffer
	logger, err := logging.NewCSVLogger(&csvBuffer)
	if err != nil {
		return nil, nil, err
	}

	result, err := sim.Run(cfg, func(sample sim.Sample) error {
		return logger.Sample(sample)
	})
	if err != nil {
		return nil, nil, err
	}
	if err := logger.Flush(); err != nil {
		return nil, nil, err
	}

	cfgHash, err := logging.ConfigSHA256(cfgPath)
	if err != nil {
		return nil, nil, err
	}

	meta := logging.ReplayMeta{
		GeneratedAt:  time.Now().UTC().Format(time.RFC3339),
		Scenario:     cfg.Name,
		Seed:         cfg.Seed,
		Dt:           cfg.Dt,
		Duration:     cfg.Duration,
		Steps:        result.Steps,
		Version:      logging.BuildVersion(),
		ConfigSHA256: cfgHash,
	}
	metaData, err := json.MarshalIndent(meta, "", "  ")
	if err != nil {
		return nil, nil, err
	}
	metaData = append(metaData, '\n')

	return csvBuffer.Bytes(), metaData, nil
}

func zipScenarioArtifacts(baseName string, csvData, metaData []byte) ([]byte, error) {
	var output bytes.Buffer
	archive := zip.NewWriter(&output)

	csvFile, err := archive.Create(baseName + ".csv")
	if err != nil {
		return nil, err
	}
	if _, err := csvFile.Write(csvData); err != nil {
		return nil, err
	}

	metaFile, err := archive.Create(baseName + ".meta.json")
	if err != nil {
		return nil, err
	}
	if _, err := metaFile.Write(metaData); err != nil {
		return nil, err
	}

	if err := archive.Close(); err != nil {
		return nil, err
	}
	return output.Bytes(), nil
}

func sanitizeDownloadName(name string) string {
	raw := strings.TrimSpace(strings.ToLower(name))
	if raw == "" {
		return "scenario"
	}

	var b strings.Builder
	lastDash := false
	for _, r := range raw {
		isAlphaNum := (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9')
		if isAlphaNum {
			b.WriteRune(r)
			lastDash = false
			continue
		}

		if !lastDash {
			b.WriteByte('-')
			lastDash = true
		}
	}

	clean := strings.Trim(b.String(), "-")
	if clean == "" {
		return "scenario"
	}
	return clean
}

func (s *paperServer) resolveScenario(arg string) (string, config.Scenario, error) {
	choices, err := discoverScenarios(s.scenariosDir)
	if err != nil {
		return "", config.Scenario{}, err
	}
	if len(choices) == 0 {
		return "", config.Scenario{}, errors.New("no scenarios available")
	}

	preferred := strings.TrimSpace(arg)
	if preferred == "" {
		for _, c := range choices {
			if c.Name == "free_fall" {
				cfg, err := config.Load(c.Path)
				return c.Path, cfg, err
			}
		}
		cfg, err := config.Load(choices[0].Path)
		return choices[0].Path, cfg, err
	}

	for _, c := range choices {
		base := trimExt(filepath.Base(c.Path))
		if preferred == c.Name || preferred == base || preferred == c.Path || preferred == filepath.Base(c.Path) {
			cfg, err := config.Load(c.Path)
			return c.Path, cfg, err
		}
	}
	return "", config.Scenario{}, fmt.Errorf("unknown scenario %q", preferred)
}

func normalizeAddrForLocal(addr string) string {
	if strings.HasPrefix(addr, ":") {
		return "127.0.0.1" + addr
	}
	if strings.HasPrefix(addr, "0.0.0.0:") {
		return "127.0.0.1:" + strings.TrimPrefix(addr, "0.0.0.0:")
	}
	if strings.HasPrefix(addr, "localhost:") || strings.HasPrefix(addr, "127.0.0.1:") {
		return addr
	}
	return addr
}

func contextCanceledError(ctx context.Context) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
		return nil
	}
}
