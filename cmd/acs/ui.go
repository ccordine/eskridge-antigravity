package main

import (
	"bufio"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/example/acs/internal/config"
)

var errCancelled = errors.New("cancelled")

type scenarioChoice struct {
	Path  string
	Name  string
	Label string
}

func uiCmd(args []string) error {
	fs := flag.NewFlagSet("ui", flag.ContinueOnError)
	scenarioDir := fs.String("scenarios", "scenarios", "directory containing scenario JSON files")
	outPathFlag := fs.String("out", "", "csv output path override")
	metaPathFlag := fs.String("meta", "", "metadata output path override")
	if err := fs.Parse(args); err != nil {
		return err
	}

	choices, err := discoverScenarios(*scenarioDir)
	if err != nil {
		return err
	}
	if len(choices) == 0 {
		return fmt.Errorf("no scenario JSON files found in %s", *scenarioDir)
	}

	reader := bufio.NewReader(os.Stdin)
	selected, err := promptScenarioSelection(reader, os.Stdout, choices)
	if err != nil {
		return err
	}

	cfg, err := config.Load(selected.Path)
	if err != nil {
		return fmt.Errorf("load selected config: %w", err)
	}

	defaultOut, defaultMeta := resolveOutputPaths(cfg, "", "")
	outPath := *outPathFlag
	metaPath := *metaPathFlag

	if outPath == "" {
		outPath, err = promptWithDefault(reader, os.Stdout, "CSV output path", defaultOut)
		if err != nil {
			return err
		}
	}
	if metaPath == "" {
		metaPath, err = promptWithDefault(reader, os.Stdout, "Replay metadata path", defaultMeta)
		if err != nil {
			return err
		}
	}

	confirm, err := promptWithDefault(reader, os.Stdout, "Run now? [Y/n]", "y")
	if err != nil {
		return err
	}
	confirm = strings.TrimSpace(strings.ToLower(confirm))
	if confirm == "n" || confirm == "no" {
		fmt.Println("cancelled")
		return errCancelled
	}

	fmt.Printf("running %s\n", selected.Path)
	return runScenario(selected.Path, cfg, outPath, metaPath, os.Stdout)
}

func discoverScenarios(dir string) ([]scenarioChoice, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	choices := make([]scenarioChoice, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		path := filepath.Join(dir, e.Name())
		cfg, err := config.Load(path)
		if err != nil {
			continue
		}
		name := cfg.Name
		if name == "" {
			name = trimExt(e.Name())
		}
		choices = append(choices, scenarioChoice{
			Path:  path,
			Name:  name,
			Label: fmt.Sprintf("%s (%s)", name, e.Name()),
		})
	}
	sort.Slice(choices, func(i, j int) bool {
		return choices[i].Label < choices[j].Label
	})
	return choices, nil
}

func promptScenarioSelection(reader *bufio.Reader, out io.Writer, choices []scenarioChoice) (scenarioChoice, error) {
	fmt.Fprintln(out, "Available scenarios:")
	for i, s := range choices {
		fmt.Fprintf(out, "  %d) %s\n", i+1, s.Label)
	}
	for {
		fmt.Fprintf(out, "Select scenario [1-%d, q to quit]: ", len(choices))
		line, err := readLine(reader)
		if err != nil {
			return scenarioChoice{}, err
		}
		line = strings.TrimSpace(line)
		if strings.EqualFold(line, "q") {
			return scenarioChoice{}, errCancelled
		}
		idx, err := strconv.Atoi(line)
		if err != nil || idx < 1 || idx > len(choices) {
			fmt.Fprintln(out, "Invalid selection.")
			continue
		}
		return choices[idx-1], nil
	}
}

func promptWithDefault(reader *bufio.Reader, out io.Writer, label, def string) (string, error) {
	fmt.Fprintf(out, "%s [%s]: ", label, def)
	line, err := readLine(reader)
	if err != nil {
		return "", err
	}
	line = strings.TrimSpace(line)
	if line == "" {
		return def, nil
	}
	return line, nil
}

func readLine(reader *bufio.Reader) (string, error) {
	line, err := reader.ReadString('\n')
	if err != nil && !errors.Is(err, io.EOF) {
		return "", err
	}
	return strings.TrimRight(line, "\r\n"), nil
}
