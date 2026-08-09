# Task 10: Add Golden Deck Fixtures

## Goal

Create stable example decks used for tests and regression checks.

## Fixtures to create

```text
examples/minimal-report
examples/business-review
examples/product-launch
```

## Requirements

Each fixture must include:

```text
.deck-project
deck.yaml
pages/
media/ if needed
```

The fixtures should exercise different layouts and element types.

## Acceptance criteria

- All fixtures pass `deck validate`.
- All fixtures render to PPTX.
- Fixtures are small enough to keep in Git.
- Element IDs are stable and human-readable.
