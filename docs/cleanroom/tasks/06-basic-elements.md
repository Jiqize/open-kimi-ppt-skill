# Task 06: Implement Basic Elements

## Goal

Implement resolved models and renderer contracts for the first four element types.

## Element types

```text
text
image
shape
line
```

## Requirements

Text supports value, style token, font size, color, bold, alignment, and basic wrapping metadata.

Image supports local source, fit `cover` or `contain`, optional crop, and alt text.

Shape supports rectangle, ellipse, fill, stroke, radius.

Line supports start, end, stroke, width, and optional arrow.

## Acceptance criteria

- Schema validation covers every basic element type.
- Layout resolver emits resolved elements for every type.
- Missing local image path is reported as a warning or error by QA later, not silently ignored.
