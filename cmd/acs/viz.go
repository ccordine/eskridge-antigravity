package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/example/acs/internal/config"
	"github.com/example/acs/internal/sim"
)

func vizCmd(args []string) error {
	fs := flag.NewFlagSet("viz", flag.ContinueOnError)
	cfgPath := fs.String("config", "", "scenario config JSON path")
	addr := fs.String("addr", "127.0.0.1:8090", "visualizer HTTP listen address")
	outPath := fs.String("out", "", "CSV output path")
	metaPath := fs.String("meta", "", "replay metadata JSON output path")
	hold := fs.Bool("hold", false, "keep web server alive after run until Enter is pressed")
	speed := fs.Float64("speed", 1.0, "visual playback speed in simulated-seconds per wall-second; <=0 streams as fast as possible")
	maxHistory := fs.Int("max-history", 20000, "max sample events kept for reconnecting clients")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *cfgPath == "" {
		return errors.New("-config is required")
	}

	cfg, err := config.Load(*cfgPath)
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}

	hub := newStreamHub(*maxHistory)
	mux := http.NewServeMux()
	mux.HandleFunc("/", serveVizPage)
	mux.HandleFunc("/events", hub.serveEvents)

	listener, err := net.Listen("tcp", *addr)
	if err != nil {
		return fmt.Errorf("listen %s: %w", *addr, err)
	}

	httpErrCh := make(chan error, 1)
	srv := &http.Server{Handler: mux}
	go func() {
		err := srv.Serve(listener)
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			httpErrCh <- err
		}
		close(httpErrCh)
	}()

	url := "http://" + listener.Addr().String()
	fmt.Printf("visualizer running at %s\n", url)
	fmt.Println("open that URL in a browser to watch live charts")

	hub.Broadcast(vizStartEvent{
		Type:          "start",
		Scenario:      cfg.Name,
		Config:        *cfgPath,
		Dt:            cfg.Dt,
		Duration:      cfg.Duration,
		LogEvery:      cfg.LogEvery,
		PlaybackSpeed: *speed,
		StartTime:     time.Now().UTC().Format(time.RFC3339),
	})

	queue := newSampleQueue()
	streamDone := make(chan int, 1)
	go func() {
		streamDone <- streamSamples(queue, hub, *speed)
	}()

	hook := func(s sim.Sample) error {
		// One-way tap: sampled telemetry is queued for visualization only.
		queue.push(toVizSampleEvent(s))
		return nil
	}

	runErr := runScenarioWithHook(*cfgPath, cfg, *outPath, *metaPath, nil, hook)
	queue.close()
	streamedSamples := <-streamDone

	done := vizDoneEvent{
		Type:        "done",
		SampleCount: streamedSamples,
		FinishedAt:  time.Now().UTC().Format(time.RFC3339),
	}
	if runErr != nil {
		done.Error = runErr.Error()
	}
	hub.Broadcast(done)

	select {
	case err := <-httpErrCh:
		if err != nil {
			return err
		}
	default:
	}

	if *hold {
		fmt.Print("press Enter to exit: ")
		_, _ = bufio.NewReader(os.Stdin).ReadString('\n')
	} else {
		// Give the browser a brief chance to render the final event.
		time.Sleep(250 * time.Millisecond)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)

	for err := range httpErrCh {
		if err != nil {
			return err
		}
	}

	return runErr
}

type vizStartEvent struct {
	Type          string  `json:"type"`
	Scenario      string  `json:"scenario"`
	Config        string  `json:"config"`
	Dt            float64 `json:"dt"`
	Duration      float64 `json:"duration"`
	LogEvery      int     `json:"log_every"`
	PlaybackSpeed float64 `json:"playback_speed"`
	StartTime     string  `json:"start_time"`
}

type vizSampleEvent struct {
	Type         string  `json:"type"`
	Step         int     `json:"step"`
	Time         float64 `json:"time"`
	Altitude     float64 `json:"altitude"`
	VerticalVel  float64 `json:"vertical_vel"`
	CouplingC    float64 `json:"coupling_c"`
	CouplingK    float64 `json:"coupling_k"`
	LockQuality  float64 `json:"lock_quality"`
	Energy       float64 `json:"energy"`
	DrivePower   float64 `json:"drive_power"`
	RawGravity   float64 `json:"raw_gravity"`
	EffectiveG   float64 `json:"effective_g"`
	PhaseError   float64 `json:"phase_error"`
	PositionZ    float64 `json:"position_z"`
	VelocityZ    float64 `json:"velocity_z"`
	GravityPower float64 `json:"gravity_power"`
}

type vizDoneEvent struct {
	Type        string `json:"type"`
	SampleCount int    `json:"sample_count"`
	FinishedAt  string `json:"finished_at"`
	Error       string `json:"error,omitempty"`
}

func toVizSampleEvent(s sim.Sample) vizSampleEvent {
	return vizSampleEvent{
		Type:         "sample",
		Step:         s.Step,
		Time:         s.Time,
		Altitude:     s.Altitude,
		VerticalVel:  s.VerticalVel,
		CouplingC:    s.CouplingC,
		CouplingK:    s.CouplingK,
		LockQuality:  s.LockQuality,
		Energy:       s.Energy,
		DrivePower:   s.DrivePower,
		RawGravity:   s.GRawMag,
		EffectiveG:   s.EffectiveGMag,
		PhaseError:   s.PhaseError,
		PositionZ:    s.Position.Z,
		VelocityZ:    s.Velocity.Z,
		GravityPower: s.GravPower,
	}
}

func streamSamples(queue *sampleQueue, hub *streamHub, speed float64) int {
	count := 0
	hasClockBase := false
	baseWall := time.Time{}
	baseSim := 0.0
	for {
		ev, ok := queue.pop()
		if !ok {
			return count
		}

		if speed > 0 {
			if !hasClockBase {
				hasClockBase = true
				baseWall = time.Now()
				baseSim = ev.Time
			}
			target := time.Duration(((ev.Time - baseSim) / speed) * float64(time.Second))
			sleepFor := baseWall.Add(target).Sub(time.Now())
			if sleepFor > 0 {
				time.Sleep(sleepFor)
			}
		}

		hub.Broadcast(ev)
		count++
	}
}

type sampleQueue struct {
	mu     sync.Mutex
	cond   *sync.Cond
	closed bool
	items  []vizSampleEvent
}

func newSampleQueue() *sampleQueue {
	q := &sampleQueue{
		items: make([]vizSampleEvent, 0, 2048),
	}
	q.cond = sync.NewCond(&q.mu)
	return q
}

func (q *sampleQueue) push(s vizSampleEvent) {
	q.mu.Lock()
	if !q.closed {
		q.items = append(q.items, s)
		q.cond.Signal()
	}
	q.mu.Unlock()
}

func (q *sampleQueue) close() {
	q.mu.Lock()
	q.closed = true
	q.cond.Broadcast()
	q.mu.Unlock()
}

func (q *sampleQueue) pop() (vizSampleEvent, bool) {
	q.mu.Lock()
	defer q.mu.Unlock()
	for len(q.items) == 0 && !q.closed {
		q.cond.Wait()
	}
	if len(q.items) == 0 && q.closed {
		return vizSampleEvent{}, false
	}
	item := q.items[0]
	q.items[0] = vizSampleEvent{}
	q.items = q.items[1:]
	return item, true
}

type streamHub struct {
	mu         sync.Mutex
	clients    map[chan []byte]struct{}
	history    [][]byte
	maxHistory int
}

func newStreamHub(maxHistory int) *streamHub {
	if maxHistory < 1 {
		maxHistory = 1
	}
	return &streamHub{
		clients:    make(map[chan []byte]struct{}),
		history:    make([][]byte, 0, maxHistory),
		maxHistory: maxHistory,
	}
}

func (h *streamHub) Broadcast(v any) {
	b, err := json.Marshal(v)
	if err != nil {
		return
	}

	h.mu.Lock()
	if len(h.history) == h.maxHistory {
		copy(h.history, h.history[1:])
		h.history[h.maxHistory-1] = b
	} else {
		h.history = append(h.history, b)
	}
	clients := make([]chan []byte, 0, len(h.clients))
	for c := range h.clients {
		clients = append(clients, c)
	}
	h.mu.Unlock()

	for _, c := range clients {
		select {
		case c <- b:
		default:
			// Non-blocking: visualization must never stall simulation.
		}
	}
}

func (h *streamHub) subscribe() (chan []byte, [][]byte) {
	ch := make(chan []byte, 512)
	h.mu.Lock()
	h.clients[ch] = struct{}{}
	backlog := make([][]byte, len(h.history))
	copy(backlog, h.history)
	h.mu.Unlock()
	return ch, backlog
}

func (h *streamHub) unsubscribe(ch chan []byte) {
	h.mu.Lock()
	delete(h.clients, ch)
	h.mu.Unlock()
	close(ch)
}

func (h *streamHub) serveEvents(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	ch, backlog := h.subscribe()
	defer h.unsubscribe(ch)

	for _, b := range backlog {
		if err := writeSSE(w, b); err != nil {
			return
		}
		flusher.Flush()
	}

	ping := time.NewTicker(10 * time.Second)
	defer ping.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case b := <-ch:
			if err := writeSSE(w, b); err != nil {
				return
			}
			flusher.Flush()
		case <-ping.C:
			if _, err := io.WriteString(w, ": ping\n\n"); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

func writeSSE(w io.Writer, payload []byte) error {
	if _, err := io.WriteString(w, "data: "); err != nil {
		return err
	}
	if _, err := w.Write(payload); err != nil {
		return err
	}
	_, err := io.WriteString(w, "\n\n")
	return err
}

func serveVizPage(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = io.WriteString(w, vizHTML)
}

const vizHTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>ACS Live Viz</title>
<style>
:root {
  color-scheme: light;
  --bg: #f4f7fb;
  --panel: #ffffff;
  --ink: #10243f;
  --muted: #5f728a;
  --line: #d8e1ec;
  --good: #1f7a65;
  --warn: #b35a2b;
}
body {
  margin: 0;
  background: radial-gradient(circle at top left, #eaf0ff, var(--bg) 45%);
  color: var(--ink);
  font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
}
main {
  max-width: 1260px;
  margin: 0 auto;
  padding: 16px;
}
header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
}
.status {
  font-size: 0.95rem;
  color: var(--muted);
}
.grid {
  margin-top: 12px;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 12px;
}
.card {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 10px;
  box-shadow: 0 6px 24px rgba(12, 31, 58, 0.08);
}
.card h3 {
  margin: 0 0 6px;
  font-size: 0.95rem;
}
canvas {
  width: 100%;
  height: 180px;
  display: block;
}
.stats {
  margin-top: 12px;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 8px;
}
.stat {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 8px;
}
.stat .k { color: var(--muted); font-size: 0.8rem; }
.stat .v { font-size: 1.1rem; font-weight: 700; }
.note {
  margin-top: 10px;
  color: var(--muted);
  font-size: 0.84rem;
}
</style>
</head>
<body>
<main>
  <header>
    <h1>ACS Live Charts</h1>
    <div id="status" class="status">connecting...</div>
  </header>

  <div class="stats">
    <div class="stat"><div class="k">Time</div><div class="v" id="stat-time">-</div></div>
    <div class="stat"><div class="k">Altitude</div><div class="v" id="stat-alt">-</div></div>
    <div class="stat"><div class="k">Vertical Velocity</div><div class="v" id="stat-vz">-</div></div>
    <div class="stat"><div class="k">Coupling C</div><div class="v" id="stat-c">-</div></div>
    <div class="stat"><div class="k">Lock Quality</div><div class="v" id="stat-lock">-</div></div>
    <div class="stat"><div class="k">Energy</div><div class="v" id="stat-energy">-</div></div>
  </div>

  <section class="grid">
    <article class="card"><h3>Altitude (m)</h3><canvas id="alt"></canvas></article>
    <article class="card"><h3>Vertical Velocity (m/s)</h3><canvas id="vz"></canvas></article>
    <article class="card"><h3>Coupling C</h3><canvas id="c"></canvas></article>
    <article class="card"><h3>Lock Quality</h3><canvas id="lock"></canvas></article>
    <article class="card"><h3>Drive Power (W)</h3><canvas id="power"></canvas></article>
    <article class="card"><h3>Energy Remaining (W*s)</h3><canvas id="energy"></canvas></article>
  </section>

  <p class="note">Visualization is read-only telemetry interpreted from sim samples. It never drives sim state.</p>
</main>

<script>
class LineChart {
  constructor(canvas, color) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.color = color;
    this.points = [];
    this.maxPoints = 5000;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }
  resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.canvas.width = Math.max(10, Math.floor(w * dpr));
    this.canvas.height = Math.max(10, Math.floor(h * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  push(t, v) {
    this.points.push({t, v});
    if (this.points.length > this.maxPoints) {
      this.points.shift();
    }
  }
  draw() {
    const ctx = this.ctx;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);

    ctx.strokeStyle = '#d8e1ec';
    ctx.lineWidth = 1;
    for (let i = 1; i <= 3; i++) {
      const y = (h / 4) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    if (this.points.length < 2) {
      return;
    }

    let minV = Infinity;
    let maxV = -Infinity;
    for (const p of this.points) {
      if (p.v < minV) minV = p.v;
      if (p.v > maxV) maxV = p.v;
    }
    if (minV === maxV) {
      minV -= 1;
      maxV += 1;
    }
    const t0 = this.points[0].t;
    const t1 = this.points[this.points.length - 1].t;
    const dt = Math.max(1e-6, t1 - t0);

    ctx.strokeStyle = this.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < this.points.length; i++) {
      const p = this.points[i];
      const x = ((p.t - t0) / dt) * w;
      const y = h - ((p.v - minV) / (maxV - minV)) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.fillStyle = '#5f728a';
    ctx.font = '12px IBM Plex Sans, Segoe UI, sans-serif';
    ctx.fillText(maxV.toFixed(2), 6, 14);
    ctx.fillText(minV.toFixed(2), 6, h - 6);
  }
}

const charts = {
  alt: new LineChart(document.getElementById('alt'), '#1f7a65'),
  vz: new LineChart(document.getElementById('vz'), '#b35a2b'),
  c: new LineChart(document.getElementById('c'), '#205493'),
  lock: new LineChart(document.getElementById('lock'), '#7a4ca0'),
  power: new LineChart(document.getElementById('power'), '#4f7f20'),
  energy: new LineChart(document.getElementById('energy'), '#1f5f8b')
};

const statusEl = document.getElementById('status');
const statTime = document.getElementById('stat-time');
const statAlt = document.getElementById('stat-alt');
const statVz = document.getElementById('stat-vz');
const statC = document.getElementById('stat-c');
const statLock = document.getElementById('stat-lock');
const statEnergy = document.getElementById('stat-energy');

let scenario = 'unknown';
let latest = null;

function setStatus(msg) {
  statusEl.textContent = msg;
}

function fmt(v, d = 3) {
  if (!Number.isFinite(v)) return '-';
  return v.toFixed(d);
}

function handleEvent(msg) {
  if (msg.type === 'start') {
    scenario = msg.scenario || 'unnamed';
    setStatus('running ' + scenario + ' | dt=' + msg.dt + 's duration=' + msg.duration + 's playback=' + msg.playback_speed + 'x');
    return;
  }
  if (msg.type === 'sample') {
    latest = msg;
    charts.alt.push(msg.time, msg.altitude);
    charts.vz.push(msg.time, msg.vertical_vel);
    charts.c.push(msg.time, msg.coupling_c);
    charts.lock.push(msg.time, msg.lock_quality);
    charts.power.push(msg.time, msg.drive_power);
    charts.energy.push(msg.time, msg.energy);

    statTime.textContent = fmt(msg.time, 2) + ' s';
    statAlt.textContent = fmt(msg.altitude, 1) + ' m';
    statVz.textContent = fmt(msg.vertical_vel, 2) + ' m/s';
    statC.textContent = fmt(msg.coupling_c, 4);
    statLock.textContent = fmt(msg.lock_quality, 4);
    statEnergy.textContent = fmt(msg.energy, 0) + ' W*s';
    return;
  }
  if (msg.type === 'done') {
    if (msg.error) {
      setStatus('finished with error: ' + msg.error);
    } else {
      setStatus('finished ' + scenario + ' | samples=' + msg.sample_count);
    }
  }
}

function connect() {
  const es = new EventSource('/events');
  es.onmessage = (ev) => {
    try {
      handleEvent(JSON.parse(ev.data));
    } catch (_) {
      // ignore malformed payloads
    }
  };
  es.onerror = () => {
    setStatus('connection lost, retrying...');
  };
}

function renderLoop() {
  for (const c of Object.values(charts)) {
    c.draw();
  }
  requestAnimationFrame(renderLoop);
}

connect();
renderLoop();
</script>
</body>
</html>`
