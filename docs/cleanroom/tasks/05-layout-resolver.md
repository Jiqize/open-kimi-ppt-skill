# Task 05: Implement Layout Resolver

## Goal

Resolve Deck IR into a renderer-neutral `ResolvedDeck`.

## Requirements

- Convert theme tokens into concrete values.
- Convert layout slots into `x`, `y`, `w`, `h` coordinates.
- Keep slide size in inches.
- Preserve stable element IDs.
- Support free coordinate mode and layout primitive mode.

## Suggested types

```ts
interface ResolvedElement {
  id: string
  type: string
  x: number
  y: number
  w: number
  h: number
  content: unknown
  style: unknown
}
```

## Acceptance criteria

- A free-coordinate page resolves unchanged.
- A `split` layout assigns left and right slots correctly.
- Missing theme token fails clearly.
- Snapshot tests cover resolved coordinates.
