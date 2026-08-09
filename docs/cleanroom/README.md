# Clean-room Deck Agent Docs

This folder contains the clean-room rewrite plan for a local-first presentation generation system inspired by the useful product ideas in open-kimi-ppt, without depending on Kimi or Moonshot runtime behavior.

Start here:

- `SPEC.md`: product and architecture specification.
- `tasks/README.md`: execution order for Codex.
- `tasks/01-*.md` to `tasks/15-*.md`: small implementation tasks.

Recommended Codex instruction:

```text
Read docs/cleanroom/SPEC.md and docs/cleanroom/tasks/README.md first. Then execute the task files in order, starting from Task 01. Keep changes small, commit after each task, and do not introduce any dependency on Kimi, Moonshot, remote editor iframes, or runtime global installs.
```
