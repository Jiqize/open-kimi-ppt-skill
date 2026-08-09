import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { runCli, type CliCommandResult } from "../src/index.js";

const examplesRoot = fileURLToPath(new URL("../../../examples", import.meta.url));
const goldenDecks = ["minimal-report", "business-review", "product-launch"] as const;
const temporaryRoots: string[] = [];

async function invoke(args: readonly string[]): Promise<CliCommandResult> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCode = await runCli(args, {
    stdout: (value) => stdout.push(value),
    stderr: (value) => stderr.push(value),
  });
  expect(stderr).toEqual([]);
  expect(exitCode).toBe(0);
  return JSON.parse(stdout.join("\n")) as CliCommandResult;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("Task 10 canonical Golden Decks", () => {
  for (const deckName of goldenDecks) {
    it(`${deckName} validates and renders through the public CLI`, async () => {
      const temporaryRoot = await mkdtemp(path.join(tmpdir(), "deck-golden-"));
      temporaryRoots.push(temporaryRoot);
      const projectRoot = path.join(temporaryRoot, deckName);
      await cp(path.join(examplesRoot, deckName), projectRoot, { recursive: true });

      const validation = await invoke(["validate", projectRoot, "--json"]);
      const render = await invoke([
        "render",
        projectRoot,
        "--format",
        "pptx",
        "--json",
      ]);

      expect(validation).toMatchObject({ status: "ok", errors: [] });
      expect(render).toMatchObject({ status: "ok", errors: [] });
      expect(render.outputPaths[0]).toMatch(/output\/deck\.pptx$/u);
    });
  }
});
