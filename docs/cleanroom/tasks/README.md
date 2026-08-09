# Clean-room Deck Agent Tasks

Run these tasks in order. Each task should be implemented as a small commit. Do not skip validation. Do not introduce Kimi, Moonshot, remote editor iframes, private webpage protocols, runtime global installs, or arbitrary recursive deletion.

## Execution rule for Codex

Before starting, read:

```text
./docs/cleanroom/SPEC.md
./docs/cleanroom/tasks/README.md
```

Then execute the task files in this order:

1. `01-initialize-monorepo.md`
2. `02-deck-ir-schema.md`
3. `03-project-loader.md`
4. `04-workspace-safety.md`
5. `05-layout-resolver.md`
6. `06-basic-elements.md`
7. `07-pptx-renderer.md`
8. `08-built-in-layouts.md`
9. `09-cli-validate-render.md`
10. `10-golden-decks.md`
11. `11-pptx-verification.md`
12. `12-preview-renderer.md`
13. `13-preview-command.md`
14. `14-structural-qa.md`
15. `15-overview-generation.md`

## Definition of done for the first milestone

The first milestone is complete when these commands work locally:

```bash
pnpm test
pnpm deck validate examples/business-review
pnpm deck render examples/business-review --format pptx
pnpm deck preview examples/business-review
pnpm deck qa examples/business-review
```

Expected generated files:

```text
examples/business-review/output/deck.pptx
examples/business-review/preview/01.png
examples/business-review/preview/overview.jpg
examples/business-review/reports/qa.json
```
