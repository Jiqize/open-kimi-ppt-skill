# Task 07: Implement PPTX Renderer

## Goal

Generate an editable PPTX from `ResolvedDeck` locally.

## Requirements

- Use PptxGenJS for V1.
- Render editable text boxes.
- Render editable shapes and lines.
- Render local images with predictable fit behavior.
- Use slide size from the deck manifest.
- Write output to `output/deck.pptx`.
- Never call Kimi, Moonshot, a remote iframe, or browser automation.

## Suggested API

```ts
renderPptx(project: DeckProject, options: { outputPath?: string }): Promise<RenderResult>
```

## Acceptance criteria

- A one-slide deck exports to PPTX.
- PowerPoint can open the file.
- Text remains editable.
- Generated output path is inside `output/` and protected by Workspace Safety.
