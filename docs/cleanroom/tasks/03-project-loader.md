# Task 03: Implement Deck Project Loader

## Goal

Load a Deck Project from disk into typed objects.

## Requirements

- Read `.deck-project` marker.
- Read `deck.yaml`.
- Load page files listed in `deck.yaml`.
- Resolve theme file when present.
- Preserve stable page order.
- Return clear JSON-friendly errors.

## Suggested API

```ts
loadDeckProject(projectPath: string): Promise<DeckProject>
```

## Acceptance criteria

- Missing `.deck-project` fails.
- Missing `deck.yaml` fails.
- Missing page file fails with page path.
- Valid example project loads successfully.
- Loader never writes to disk.
