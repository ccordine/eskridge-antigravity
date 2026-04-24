package main

import (
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"

	"github.com/example/acs/internal/config"
	"github.com/example/acs/internal/logging"
)

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}

	switch os.Args[1] {
	case "run":
		if err := runCmd(os.Args[2:]); err != nil {
			fmt.Fprintln(os.Stderr, "error:", err)
			os.Exit(1)
		}
	case "serve":
		if err := serveCmd(os.Args[2:]); err != nil {
			fmt.Fprintln(os.Stderr, "error:", err)
			os.Exit(1)
		}
	case "viz":
		if err := vizCmd(os.Args[2:]); err != nil {
			fmt.Fprintln(os.Stderr, "error:", err)
			os.Exit(1)
		}
	case "ui":
		if err := uiCmd(os.Args[2:]); err != nil {
			if errors.Is(err, errCancelled) {
				return
			}
			fmt.Fprintln(os.Stderr, "error:", err)
			os.Exit(1)
		}
	case "version":
		fmt.Println(logging.BuildVersion())
	default:
		usage()
		os.Exit(2)
	}
}

func runCmd(args []string) error {
	fs := flag.NewFlagSet("run", flag.ContinueOnError)
	cfgPath := fs.String("config", "", "scenario config JSON path")
	outPath := fs.String("out", "", "CSV output path")
	metaPath := fs.String("meta", "", "replay metadata JSON output path")
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

	return runScenario(*cfgPath, cfg, *outPath, *metaPath, nil)
}

func trimExt(name string) string {
	ext := filepath.Ext(name)
	if ext == "" {
		return name
	}
	return name[:len(name)-len(ext)]
}

func usage() {
	fmt.Println("acs usage:")
	fmt.Println("  acs run -config scenarios/free_fall.json [-out out/free_fall.csv] [-meta out/free_fall.meta.json]")
	fmt.Println("  acs serve [-addr :8080] [-scenarios scenarios] [-web web]")
	fmt.Println("  acs viz -config scenarios/free_fall.json [-addr 127.0.0.1:8090] [-speed 1.0] [-hold]")
	fmt.Println("  acs ui [-scenarios scenarios] [-out out/custom.csv] [-meta out/custom.meta.json]")
	fmt.Println("  acs version")
}
