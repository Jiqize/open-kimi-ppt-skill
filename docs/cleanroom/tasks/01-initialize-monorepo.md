# Task 01: Initialize TypeScript Monorepo

## Goal

Create the clean-room project scaffold without changing existing open-kimi-ppt runtime code.

## Requirements

- Use `pnpm` and TypeScript.
- Create a new clean-room workspace under `cleanroom-deck-agent/`.
- Add package folders but keep implementation minimal.
- Do not add Kimi, Moonshot, remote iframe, browser automation, or global install behavior.

## Target structure

```text
cleanroom-deck-agent/
  package.json
  pnpm-workspace.yaml
  tsconfig.base.json
  apps/
    cli/
  packages/
    deck-schema/
    deck-core/
    deck-layout/
    renderer-pptx/
    renderer-preview/
    deck-qa/
  examples/
```

## Acceptance criteria

```bash
cd cleanroom-deck-agent
pnpm install
pnpm test
pnpm build
```

Both commands should pass, even if most packages are stubs.
