# Task 13: Add CLI Preview Command

## Goal

Expose preview generation through the CLI.

## Command

```bash
deck preview <project>
```

## Requirements

- Validate project before preview.
- Render all pages to `preview/`.
- Support `--force` only for generated preview artifacts.
- Support `--json` output.
- Return paths to generated page images.

## Acceptance criteria

```bash
pnpm deck preview examples/business-review
```

Generates page PNG files under `examples/business-review/preview/`.

JSON mode includes page count, output directory, and image paths.
