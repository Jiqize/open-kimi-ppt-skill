# Clean-room Presentation Agent Spec

## 1. Objective

Build a local-first presentation generation system for AI coding agents. The system should create, edit, preview, validate, visually QA, and export editable PowerPoint decks from a structured project format.

The goal is to keep the strongest product ideas from the existing fork, especially an agent-friendly intermediate format, a persistent editable project folder, local preview, visual QA, and PPTX export. The implementation must be clean-room and must not depend on Kimi, Moonshot, private webpage protocols, remote editor iframes, or reverse-engineered browser behavior.

The first version is macOS-first, Codex-first, single-project, and optimized for 8 to 12 page business presentation decks.

## 2. Non-goals for V1

V1 does not attempt to support multiplayer editing, cloud storage, PowerPoint add-ins, Google Slides, Keynote, video decks, complex animation, VBA, OLE, SmartArt parity, 100 percent PPTX import fidelity, mobile editing, template marketplace, or full Kimi PPTD compatibility.

Existing PPTX files can be used as visual references in V1 by rendering screenshots and rebuilding a new Deck Project. Lossless import can be handled later through adapters.

## 3. Core principles

Deck IR is the source of truth. PPTX is an export artifact.

All core generation, preview, QA, and PPTX export must work locally for decks with local assets. Network-dependent research or asset search may be added later as optional providers.

Renderer implementations must be replaceable. The V1 renderer can use PptxGenJS, but the system must expose a renderer interface so that another OOXML renderer or external exporter can replace it later.

Preview and PPTX rendering must consume the same resolved layout model. The preview renderer and PPTX renderer must not independently calculate positions.

Third-party compatibility must live in adapters. Any Kimi or PPTD compatibility code must be optional, isolated, and disabled by default.

The tool must never install global dependencies at runtime, never delete arbitrary user paths, and never load unpinned remote JavaScript into the core editor or renderer.

## 4. Target workflow

```text
User request
  -> Agent creates or edits Deck Project
  -> deck validate
  -> deck preview
  -> structural QA
  -> visual QA from overview images
  -> Agent patches affected pages only
  -> deck render --format pptx
  -> deliver project folder and PPTX
```

Local project output:

```text
my-deck/
  .deck-project
  deck.yaml
  pages/
    01-cover.yaml
    02-context.yaml
  media/
  preview/
    01.png
    02.png
    overview.jpg
  output/
    deck.pptx
  reports/
    qa.json
```

## 5. Repository layout

Recommended monorepo structure:

```text
deck-agent/
  apps/
    cli/
    editor/
  packages/
    deck-schema/
    deck-core/
    deck-layout/
    deck-theme/
    renderer-pptx/
    renderer-preview/
    deck-qa/
    deck-assets/
    agent-runtime/
    adapter-kimi/
  skills/
    presentation/
  examples/
  tests/
  docs/
```

Dependency direction:

```text
Agent Skill
  -> Agent Runtime
  -> Deck Core
  -> Deck Schema
  -> Layout Resolver
  -> Resolved Deck
       -> Preview Renderer
       -> PPTX Renderer
       -> QA
```

## 6. Deck Project format

A Deck Project is a folder with a marker file and structured source files. The marker prevents unsafe destructive operations on arbitrary folders.

```text
project/
  .deck-project
  deck.yaml
  pages/
  media/
  preview/
  output/
  reports/
```

`deck.yaml` example:

```yaml
version: 1
id: ai-fashion-review
title: AI Fashion Trend Review
size:
  width: 13.333
  height: 7.5
theme: themes/executive-light.yaml
pages:
  - pages/01-cover.yaml
  - pages/02-context.yaml
```

Page example:

```yaml
id: page-02
type: insight
layout:
  type: split
  ratio: 0.58
background:
  color: background
elements:
  - id: title
    type: text
    slot: left.title
    text:
      value: AI fashion is shifting from image generation to workflow infrastructure
      style: heading-1
  - id: hero
    type: image
    slot: right.hero
    source: ../media/hero.jpg
    fit: cover
```

V1 element types:

```text
text
image
shape
line
icon
group
table
chart
```

Implement only text, image, shape, and line in Phase 1. Add table and chart later.

## 7. Theme system

Theme files define semantic tokens. Agents should use semantic tokens instead of repeatedly choosing raw hex values and typography rules.

```yaml
name: executive-light
colors:
  background: '#F7F7F5'
  foreground: '#161616'
  muted: '#686868'
  accent: '#3157F6'
fonts:
  heading:
    family: Arial
    weight: 700
  body:
    family: Arial
    weight: 400
spacing:
  pageMargin: 0.7
  grid: 0.1
radius:
  card: 0.12
```

## 8. Layout system

The system supports two layout modes.

Free coordinate mode allows explicit `x`, `y`, `w`, and `h` values. Use it for covers, editorial layouts, and special pages.

Layout primitive mode lets the Agent choose a page layout and assign elements to semantic slots. The layout resolver calculates positions.

Built-in V1 layouts:

```text
cover
title-body
split
two-column
three-column
hero
quote
metric-grid
comparison
timeline
chart-left
chart-right
full-image
section
closing
```

Phase 1 implements cover, title-body, split, metric-grid, and full-image.

## 9. Resolved Deck

Deck IR should resolve into a renderer-neutral model before any output happens.

```ts
interface ResolvedElement {
  id: string
  type: string
  x: number
  y: number
  w: number
  h: number
  style: Record<string, unknown>
  content: Record<string, unknown>
}

interface ResolvedDeck {
  size: { width: number; height: number }
  theme: ResolvedTheme
  pages: ResolvedPage[]
}
```

Preview renderer and PPTX renderer both consume `ResolvedDeck`.

## 10. PPTX renderer

V1 should use PptxGenJS for speed and editability.

Renderer interface:

```ts
interface PresentationRenderer {
  render(project: DeckProject, options?: RenderOptions): Promise<RenderResult>
}
```

PPTX output must preserve editable text, editable shapes, editable lines, and replaceable images. Charts may initially render as SVG if native chart editing is too costly.

After export, validate the PPTX ZIP, slide count, relationships, media files, and representative text presence.

## 11. Preview renderer

V1 preview should render `ResolvedDeck` to SVG or HTML and capture PNGs with Playwright.

Outputs:

```text
preview/01.png
preview/02.png
preview/overview.jpg
```

The preview should be visually close enough to the PPTX output to support QA. Exact PowerPoint fidelity is a later goal.

## 12. QA engine

Structural QA is deterministic and runs before visual QA.

Rules:

```text
SCHEMA_INVALID
PATH_ESCAPE
MISSING_ASSET
ELEMENT_OUT_OF_BOUNDS
ELEMENT_OVERLAP
TEXT_OVERFLOW_RISK
LOW_CONTRAST
MISSING_TITLE
EMPTY_PAGE
UNRESOLVED_THEME_TOKEN
FONT_UNAVAILABLE
```

Visual QA uses preview images and, when available, a multimodal model. The QA loop must patch only affected pages and stop after three rounds by default.

## 13. CLI

V1 CLI commands:

```bash
deck validate <project>
deck render <project> --format pptx
deck preview <project>
deck qa <project>
deck doctor
deck serve <project>
```

`deck doctor` checks dependencies and prints exact setup commands. It must not install global dependencies. A separate `deck setup` may install project-local dependencies after explicit user action.

Every command should support JSON output for Agent consumption.

## 14. Local editor

The editor is not PowerPoint. V1 only needs slide navigation, canvas preview, text editing, image replacement, drag, resize, inspector properties, save, preview, and export.

Recommended stack:

```text
React
Vite
SVG canvas
File System Access API
localhost dev server
```

Do not use Electron in V1 unless there is a clear need.

## 15. Safety rules

Workspace guard must block absolute path writes, `..`, symlink escapes, filesystem root, home directory, and project parent directory mutation.

Delete operations are allowed only inside known generated directories:

```text
preview/
output/
reports/
.deck-cache/
```

Recursive deletion must require `.deck-project` marker verification.

## 16. Dependency policy

Use pinned versions, lockfiles, project-local installs, and explicit licenses.

Forbidden in core runtime:

```text
npm install -g at runtime
pip install --user at runtime
remote script latest URLs
remote editor iframes
reverse-engineered private APIs
```

## 17. Agent Skill

The Skill should be thin. It routes presentation work into the CLI and references separate docs for schema, layouts, typography, charts, and QA.

Trigger scope:

```text
presentation
PowerPoint
slide deck
pitch deck
report deck
presentation redesign
```

Do not trigger for ordinary image generation, posters, webpages, or video.

## 18. Testing strategy

Testing layers:

```text
Unit tests: schema, path guard, layout, geometry, color, typography.
Snapshot tests: Deck IR to Resolved Deck.
Visual regression: golden decks to preview PNGs.
PPTX integration: ZIP, slides, relationships, media, text.
Agent workflow tests: modify one page and verify minimal patch.
```

Golden decks:

```text
01 Minimal Report
02 Strategy Deck
03 Business Review
04 Product Launch
05 Data-heavy Report
06 Editorial Fashion
07 Investment Memo
08 Market Research
09 Training Deck
10 Image-heavy Deck
```

## 19. V1 success criteria

V1 is acceptable when:

```text
20 consecutive decks export with at least 95 percent success.
Programmatic out-of-bounds rate is below 1 percent.
Text, shapes, and images are editable in PowerPoint.
A simple local deck can preview and export without network.
A user request to modify page 6 changes only page 6 source files unless dependency changes are necessary.
```

## 20. Implementation phases

Phase 1: TypeScript monorepo, schema, project loader, path safety, layout resolver, text/image/shape/line elements, PPTX renderer, basic CLI, golden decks.

Phase 2: preview renderer, page PNGs, overview image, visual regression tests.

Phase 3: structural QA and optional multimodal visual QA loop.

Phase 4: local editor.

Phase 5: theme library, layout library, style references, brand kit.

Phase 6: import adapters for PPTX screenshot reference, partial PPTX import, PDF import, and PPTD compatibility.
