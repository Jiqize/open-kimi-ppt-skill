import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { runCli, type CliCommandResult } from "../src/index.js";

const fixture = fileURLToPath(
  new URL("../../../examples/golden-task-07", import.meta.url),
);
const temporaryRoots: string[] = [];

async function copyFixture(): Promise<string> {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "deck-cli-task-09-"));
  temporaryRoots.push(temporaryRoot);
  const projectRoot = path.join(temporaryRoot, "project");
  await cp(fixture, projectRoot, { recursive: true });
  return projectRoot;
}

async function invoke(args: readonly string[]): Promise<{
  readonly exitCode: number;
  readonly stdout: readonly string[];
  readonly stderr: readonly string[];
}> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCode = await runCli(args, {
    stdout: (value) => stdout.push(value),
    stderr: (value) => stderr.push(value),
  });
  return { exitCode, stdout, stderr };
}

function jsonResult(stdout: readonly string[]): CliCommandResult {
  return JSON.parse(stdout.join("\n")) as CliCommandResult;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("Task 09 CLI validate and render", () => {
  it("validates a Deck Project and emits the stable JSON envelope", async () => {
    const projectRoot = await copyFixture();
    const invocation = await invoke(["validate", projectRoot, "--json"]);
    const result = jsonResult(invocation.stdout);

    expect(invocation.exitCode).toBe(0);
    expect(invocation.stderr).toEqual([]);
    expect(result).toMatchObject({
      command: "validate",
      status: "ok",
      warnings: [],
      errors: [],
      outputPaths: [],
      details: { pageCount: 1, elementCount: 5 },
    });
  });

  it("renders an editable PPTX and returns its guarded output path", async () => {
    const projectRoot = await copyFixture();
    const invocation = await invoke([
      "render",
      projectRoot,
      "--format",
      "pptx",
      "--json",
    ]);
    const result = jsonResult(invocation.stdout);

    expect(invocation.exitCode).toBe(0);
    expect(result.status).toBe("ok");
    expect(result.outputPaths).toEqual([
      path.join(await realpath(projectRoot), "output/deck.pptx"),
    ]);
    expect(result.details.verification).toMatchObject({
      status: "verified",
      zip: { valid: true, crcValid: true },
      slides: { expected: 1, actual: 1 },
      media: { pictures: 1 },
      relationships: { presentation: 1, slideFiles: 1 },
    });
  });

  it("returns a machine-readable project error", async () => {
    const temporaryRoot = await mkdtemp(path.join(tmpdir(), "deck-cli-missing-"));
    temporaryRoots.push(temporaryRoot);
    const invocation = await invoke(["validate", temporaryRoot, "--json"]);
    const result = jsonResult(invocation.stdout);

    expect(invocation.exitCode).toBe(1);
    expect(result.status).toBe("error");
    expect(result.errors[0]?.code).toBe("PROJECT_MARKER_MISSING");
  });

  it("rejects unsupported formats with a typed usage error", async () => {
    const projectRoot = await copyFixture();
    const invocation = await invoke([
      "render",
      projectRoot,
      "--format",
      "pdf",
      "--json",
    ]);
    const result = jsonResult(invocation.stdout);

    expect(invocation.exitCode).toBe(1);
    expect(result.errors[0]?.code).toBe("FORMAT_UNSUPPORTED");
  });

  it("keeps human output concise and sends failures to stderr", async () => {
    const projectRoot = await copyFixture();
    const success = await invoke(["validate", projectRoot]);
    const failure = await invoke(["render", projectRoot]);

    expect(success.stdout[0]).toMatch(/^OK validate:/u);
    expect(failure.exitCode).toBe(1);
    expect(failure.stdout).toEqual([]);
    expect(failure.stderr[0]).toContain("CLI_FORMAT_REQUIRED");
  });

  it("previews every page and safely removes only stale generated artifacts", async () => {
    const projectRoot = await copyFixture();
    const previewDirectory = path.join(projectRoot, "preview");
    await writeFile(path.join(projectRoot, ".deck-project"), "", "utf8");
    await mkdir(previewDirectory, { recursive: true });
    await writeFile(path.join(previewDirectory, "02.png"), "stale");
    await writeFile(path.join(previewDirectory, "notes.txt"), "user-owned");

    const invocation = await invoke(["preview", projectRoot, "--json"]);
    const result = jsonResult(invocation.stdout);

    expect(invocation.exitCode).toBe(0);
    expect(result).toMatchObject({
      command: "preview",
      status: "ok",
      errors: [],
      details: {
        pageCount: 1,
        removedStaleArtifacts: ["preview/02.png"],
      },
    });
    expect(result.outputPaths[0]).toMatch(/preview\/01\.png$/u);
    expect(await readFile(path.join(previewDirectory, "notes.txt"), "utf8")).toBe(
      "user-owned",
    );
    await expect(access(path.join(previewDirectory, "02.png"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  }, 30_000);

  it("accepts --force only for preview and reports regenerated artifacts", async () => {
    const projectRoot = await copyFixture();
    const first = await invoke(["preview", projectRoot, "--json"]);
    expect(first.exitCode).toBe(0);
    const forced = await invoke(["preview", projectRoot, "--force", "--json"]);
    const result = jsonResult(forced.stdout);

    expect(forced.exitCode).toBe(0);
    expect(result.details).toMatchObject({
      force: true,
      removedStaleArtifacts: ["preview/01.png"],
    });

    const invalid = await invoke(["validate", projectRoot, "--force", "--json"]);
    expect(jsonResult(invalid.stdout).errors[0]?.code).toBe("CLI_ARGUMENT_INVALID");
  }, 30_000);

  it("writes a machine-readable Structural QA report and does not block warnings", async () => {
    const projectRoot = await copyFixture();
    const invocation = await invoke(["qa", projectRoot, "--json"]);
    const result = jsonResult(invocation.stdout);

    expect(invocation.exitCode).toBe(0);
    expect(["ok", "warning"]).toContain(result.status);
    expect(result.errors).toEqual([]);
    expect(result.outputPaths).toEqual([
      path.join(await realpath(projectRoot), "reports/qa.json"),
    ]);
    const report = JSON.parse(
      await readFile(path.join(projectRoot, "reports/qa.json"), "utf8"),
    ) as { readonly version: number; readonly ok: boolean };
    expect(report).toMatchObject({ version: 1, ok: true });
  });

  it("returns nonzero for QA errors after safely writing reports/qa.json", async () => {
    const projectRoot = await copyFixture();
    await rm(path.join(projectRoot, "media/hero.svg"));

    const invocation = await invoke(["qa", projectRoot, "--json"]);
    const result = jsonResult(invocation.stdout);

    expect(invocation.exitCode).toBe(1);
    expect(result.status).toBe("error");
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "MISSING_ASSET" }),
      ]),
    );
    expect(
      JSON.parse(
        await readFile(path.join(projectRoot, "reports/qa.json"), "utf8"),
      ),
    ).toMatchObject({ ok: false, summary: { error: 1 } });
  });
});
