# Task 04: Implement Workspace Safety

## Goal

Create a guard layer for all file writes and deletes.

## Requirements

- Block absolute path writes outside the project.
- Block `..` path traversal.
- Block symlink escape.
- Block writes to filesystem root, home directory, and project parent.
- Allow deletion only inside generated folders: `preview/`, `output/`, `reports/`, `.deck-cache/`.
- Require `.deck-project` marker before any destructive operation.

## Suggested API

```ts
resolveProjectPath(projectRoot: string, relativePath: string): string
assertSafeWrite(projectRoot: string, relativePath: string): void
assertSafeGeneratedDelete(projectRoot: string, relativePath: string): void
```

## Acceptance criteria

- Tests cover Unix absolute paths, Windows drive paths, `..`, symlinks, root deletion, home deletion, and allowed generated-folder deletion.
- No generic `rm -rf` style helper accepts arbitrary user paths.
