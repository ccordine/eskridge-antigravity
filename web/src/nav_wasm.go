//go:build js && wasm

package main

import (
  "math"
  "syscall/js"
)

func clamp(v, lo, hi float64) float64 {
  if v < lo {
    return lo
  }
  if v > hi {
    return hi
  }
  return v
}

func navCompute(this js.Value, args []js.Value) any {
  if len(args) < 3 {
    return map[string]any{"x": 0.0, "y": 0.0, "demand": 0.0}
  }
  errX := args[0].Float()
  errY := args[1].Float()
  scale := args[2].Float()
  if !isFinite(scale) || scale <= 1e-9 {
    scale = 1500
  }
  nx := clamp(errX/scale, -1, 1)
  ny := clamp(errY/scale, -1, 1)
  demand := math.Hypot(nx, ny)
  return map[string]any{"x": nx, "y": ny, "demand": demand}
}

func isFinite(v float64) bool {
  return !math.IsNaN(v) && !math.IsInf(v, 0)
}

func main() {
  js.Global().Set("navComputeWasm", js.FuncOf(navCompute))
  select {}
}
