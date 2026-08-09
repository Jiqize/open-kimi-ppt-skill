# Task 15: Generate Overview Image

## Goal

Create a single overview image from all page previews for human and multimodal QA.

## Requirements

- Read page PNGs from `preview/`.
- Stitch them into a grid.
- Add page labels such as `P1`, `P2`, `P3`.
- Output `preview/overview.jpg`.
- Include mapping from page label to page source file in JSON output.

## Suggested behavior

```text
3 columns by default
consistent thumbnail width
neutral background
clear black page labels
```

## Acceptance criteria

```bash
pnpm deck preview examples/business-review
```

Generates:

```text
examples/business-review/preview/overview.jpg
```

`deck preview --json` includes the overview path and page-label mapping.
