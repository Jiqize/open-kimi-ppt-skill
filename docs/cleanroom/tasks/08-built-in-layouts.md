# Task 08: Add Built-in Layouts

## Goal

Add the first set of reusable layout primitives.

## Layouts to implement

```text
cover
title-body
split
metric-grid
full-image
```

## Requirements

- Each layout exposes named slots.
- Slots resolve into deterministic coordinates.
- Layouts respect page margin and theme spacing tokens.
- Layouts should produce business-safe information density.

## Acceptance criteria

- Snapshot tests cover all five layouts.
- A sample page can use each layout.
- Layout logic is centralized in `packages/deck-layout`.
