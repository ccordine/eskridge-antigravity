# Falsification Plan

Every claim must map to a concrete test that can fail.

## Test Families

- Baseline separation test: coupler off versus on.
- Lock threshold test: collapse and recovery transitions.
- Power ceiling test: behavior at and beyond configured limits.
- Drift test: omega0 perturbation and stability degradation.

## Failure Criteria

- Claimed behavior does not emerge under required preconditions.
- Equivalent outcomes can be produced by non-coupling artifacts.
- Reported metrics cannot reproduce from run artifacts.

## Linked Notes

- Scenario coverage: [[simulation/scenario-matrix]]
- Claim definitions: [[foundations/coupling-claims]]
- Publication sequence: [[writing/paper-outline]]
