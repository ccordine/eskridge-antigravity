# Telemetry Contract

This note defines which metrics are mandatory for every run artifact.

## Mandatory Fields

- Time and step indexing
- Position and velocity vectors
- Raw and effective gravity vectors
- Coupling state (`C`, `k`, phase)
- Lock metrics (phase error, lock quality)
- Energy and drive power

## Artifact Rules

- CSV is the raw run ledger.
- Meta JSON contains run identity and reproducibility metadata.
- Zip export bundles both for archival handoff.

## Linked Notes

- Claims alignment: [[foundations/coupling-claims]]
- Falsification requirements: [[experiments/falsification-plan]]
