import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { cleanProjectPreviewArtifacts } from "../src/project-preview-artifacts.js";

const temporaryDirectories: string[] = [];
let projectRoot: string;

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

beforeEach(async () => {
  projectRoot = await temporaryDirectory("deck-preview-cleanup-");
  await writeFile(path.join(projectRoot, ".deck-project"), "", "utf8");
  await mkdir(path.join(projectRoot, "preview"));
});

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("cleanProjectPreviewArtifacts", () => {
  it("removes only stale generated page and overview files after page count shrinks", async () => {
    await Promise.all([
      writeFile(path.join(projectRoot, "preview/01.png"), "keep"),
      writeFile(path.join(projectRoot, "preview/02.png"), "keep"),
      writeFile(path.join(projectRoot, "preview/03.png"), "stale"),
      writeFile(path.join(projectRoot, "preview/overview.png"), "stale"),
      writeFile(path.join(projectRoot, "preview/notes.txt"), "user-owned"),
    ]);
    await mkdir(path.join(projectRoot, "preview/04.png"));

    const result = await cleanProjectPreviewArtifacts(projectRoot, {
      expectedPaths: ["preview/01.png", "preview/02.png"],
    });

    expect(result.removedPaths).toEqual([
      "preview/03.png",
      "preview/overview.png",
    ]);
    expect(await readFile(path.join(projectRoot, "preview/01.png"), "utf8")).toBe(
      "keep",
    );
    expect(await readFile(path.join(projectRoot, "preview/notes.txt"), "utf8")).toBe(
      "user-owned",
    );
  });

  it("removes every known generated file with force but preserves arbitrary files", async () => {
    await Promise.all([
      writeFile(path.join(projectRoot, "preview/01.png"), "generated"),
      writeFile(path.join(projectRoot, "preview/overview.jpg"), "generated"),
      writeFile(path.join(projectRoot, "preview/custom.png"), "user-owned"),
    ]);

    const result = await cleanProjectPreviewArtifacts(projectRoot, {
      expectedPaths: ["preview/01.png"],
      force: true,
    });

    expect(result.removedPaths).toEqual([
      "preview/01.png",
      "preview/overview.jpg",
    ]);
    expect(await readFile(path.join(projectRoot, "preview/custom.png"), "utf8")).toBe(
      "user-owned",
    );
  });

  it("rejects a matching artifact symlink that escapes the project", async () => {
    const outside = await temporaryDirectory("deck-preview-cleanup-outside-");
    const outsideFile = path.join(outside, "outside.png");
    await writeFile(outsideFile, "outside", "utf8");
    await symlink(outsideFile, path.join(projectRoot, "preview/03.png"));

    await expect(
      cleanProjectPreviewArtifacts(projectRoot, {
        expectedPaths: ["preview/01.png", "preview/02.png"],
      }),
    ).rejects.toMatchObject({ code: "SYMLINK_ESCAPE" });
    expect(await readFile(outsideFile, "utf8")).toBe("outside");
  });

  it("rejects unexpected cleanup targets before reading the directory", async () => {
    await expect(
      cleanProjectPreviewArtifacts(projectRoot, {
        expectedPaths: ["preview/../output/deck.pptx"],
      }),
    ).rejects.toMatchObject({ code: "PREVIEW_ARTIFACT_PATH_INVALID" });
  });
});
