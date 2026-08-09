import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createProjectReportWriter } from "../src/project-report.js";

const temporaryDirectories: string[] = [];
let projectRoot: string;

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(tmpdir(), "deck-report-writer-"));
  temporaryDirectories.push(projectRoot);
  await writeFile(path.join(projectRoot, ".deck-project"), "", "utf8");
});

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("createProjectReportWriter", () => {
  it("writes QA bytes only inside reports/", async () => {
    const data = new TextEncoder().encode('{"ok":true}\n');
    const result = await createProjectReportWriter(projectRoot).write(
      "reports/qa.json",
      data,
    );

    expect(result.relativePath).toBe("reports/qa.json");
    expect(await readFile(result.absolutePath)).toEqual(Buffer.from(data));
  });

  it("rejects paths outside reports/", async () => {
    await expect(
      createProjectReportWriter(projectRoot).write(
        "output/qa.json",
        new Uint8Array(),
      ),
    ).rejects.toMatchObject({ code: "REPORT_PATH_INVALID" });
  });

  it("rejects a reports directory symlink escape", async () => {
    const outside = await mkdtemp(path.join(tmpdir(), "deck-report-outside-"));
    temporaryDirectories.push(outside);
    await mkdir(outside, { recursive: true });
    await symlink(outside, path.join(projectRoot, "reports"), "dir");

    await expect(
      createProjectReportWriter(projectRoot).write(
        "reports/qa.json",
        new Uint8Array(),
      ),
    ).rejects.toMatchObject({ code: "SYMLINK_ESCAPE" });
  });
});
