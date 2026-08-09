# Task 11: Add PPTX Verification

## Goal

Verify generated PPTX files before reporting success.

## Requirements

After rendering, inspect the PPTX as a ZIP package and verify:

```text
[Content_Types].xml exists
ppt/presentation.xml exists
slide count matches deck page count
slide relationship files exist
referenced media files exist
ZIP CRC check passes
representative text appears in slide XML
```

## Suggested API

```ts
verifyPptx(path: string, expected: { slideCount: number }): Promise<PptxVerificationReport>
```

## Acceptance criteria

- Valid generated files pass.
- Corrupted ZIP fails.
- Slide count mismatch fails.
- `deck render --json` includes verification summary.
