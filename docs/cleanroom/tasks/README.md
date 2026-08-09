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

## Implementation status

The filename number in this directory is the canonical task number. The status
table below prevents implementation history from changing that numbering.

| Task | Status | Current implementation |
| --- | --- | --- |
| 01 | Complete | TypeScript/pnpm workspace (`9479ecb`) |
| 02 | Complete | Deck IR schema (`9888616`) |
| 03 | Complete | Deck Project loader (`af57c00`) |
| 04 | Complete | Workspace safety plus read-path hardening (`04c3897`, `47c1293`) |
| 05 | Complete | Deterministic Layout Resolver and Resolved Deck (`ae81b96`) |
| 06 | Complete | Basic elements plus renderer-ready shared contracts (`74e5438`, `5732490`) |
| 07 | Complete | Editable PptxGenJS renderer (`00aa1ba`) |
| 08 | Complete | Built-in layout library (`abef58d`) |
| 09 | Complete | `deck validate` and `deck render` CLI (`4b9ebc8`) |
| 10 | Complete | Three canonical decks under `examples/` (`8d70697`) |
| 11 | Complete | Post-write PPTX ZIP/CRC verification (`b729952`) |
| 12 | Complete | ResolvedDeck-only page Preview Renderer (`7a23636`, aligned by `74007eb`) |
| 13 | Complete | Safe `deck preview` command and stale-artifact cleanup (`6e6ffa4`) |
| 14 | Complete | Structural QA baseline and CLI/report completion (`9c2f65a`, `800462d`) |
| 15 | Complete | Labeled `preview/overview.jpg` and CLI page mapping (Task 15 commit) |

### Task-number compatibility map

Two earlier commits used the then-current development sequence rather than the
canonical filenames in this directory:

- Commit `7a23636` is named “Task 09: implement Preview Renderer”; its
  implementation belongs to canonical Task 12. Commit `74007eb` completes the
  canonical Task 12 page-only contract and shared shape stroke width.
- Commit `9c2f65a` is named “Task 10: implement Structural QA”; its
  implementation belongs to canonical Task 14. Commit `800462d` completes the
  canonical Task 14 command, report writer, contrast/title rules, and font
  provider.

Canonical Tasks 09–15 reuse those foundations: CLI orchestration does not
reimplement layout, image geometry, asset reads, preview rendering, Structural
QA, or PPTX package inspection.

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
