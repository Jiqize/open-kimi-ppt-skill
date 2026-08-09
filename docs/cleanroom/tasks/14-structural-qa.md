# Task 14: Implement Structural QA

## Goal

Add deterministic QA before visual review.

## Rules

Implement at least:

```text
SCHEMA_INVALID
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

## Command

```bash
deck qa <project>
```

## Output

Write report to:

```text
reports/qa.json
```

## Acceptance criteria

- QA detects missing images.
- QA detects obvious out-of-bounds elements.
- QA detects empty pages.
- QA produces JSON with severity, rule, page, element, and message.
