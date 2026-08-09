# Task 09: Add CLI Validate and Render

## Goal

Expose the first usable command-line workflow.

## Commands

```bash
deck validate <project>
deck render <project> --format pptx
```

## Requirements

- CLI lives in `apps/cli`.
- Commands return readable text by default.
- Add `--json` for machine-readable output.
- `validate` runs schema validation, project loading, and basic project checks.
- `render` validates before rendering.

## Acceptance criteria

```bash
pnpm deck validate examples/minimal-report
pnpm deck render examples/minimal-report --format pptx
```

Both commands work. JSON mode emits structured status, warnings, errors, and output paths.
