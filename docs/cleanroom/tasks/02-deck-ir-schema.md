# Task 02: Define Deck IR Schema

## Goal

Create the first version of the Deck IR with strict runtime validation.

## Requirements

- Use Zod or an equivalent TypeScript runtime schema library.
- Define manifest, page, theme, and element schemas.
- Support V1 element types: `text`, `image`, `shape`, `line`.
- Support slide size in inches.
- Support semantic theme tokens.
- Export TypeScript types inferred from schemas.

## Files to create

```text
packages/deck-schema/src/index.ts
packages/deck-schema/src/deck.ts
packages/deck-schema/src/page.ts
packages/deck-schema/src/theme.ts
packages/deck-schema/src/elements.ts
packages/deck-schema/test/schema.test.ts
```

## Acceptance criteria

- Valid example manifests pass.
- Invalid element types fail.
- Invalid negative sizes fail.
- Missing required `pages` fails.
- Tests pass with `pnpm test`.
