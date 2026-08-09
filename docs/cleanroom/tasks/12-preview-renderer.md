# Task 12: Implement Preview Renderer

## Goal

Render `ResolvedDeck` into local preview images.

## Requirements

- Use SVG or HTML as the intermediate preview surface.
- Use Playwright to capture PNG screenshots.
- Render one PNG per page.
- Use the same `ResolvedDeck` consumed by the PPTX renderer.
- Do not call PowerPoint, Kimi, Moonshot, or remote editor pages.

## Output

```text
preview/01.png
preview/02.png
```

## Acceptance criteria

- Minimal deck previews successfully.
- Preview output is deterministic enough for visual regression.
- Existing preview directory is cleaned only through Workspace Safety.
