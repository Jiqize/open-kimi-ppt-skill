import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  assertSafeGeneratedDelete,
  assertSafeWrite,
  resolveProjectPath,
} from "../src/workspace-safety.js";

const temporaryDirectories: string[] = [];
let projectRoot: string;

async function createKnownTemporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function removeKnownTemporaryDirectory(directory: string): Promise<void> {
  const relativeToTemp = path.relative(tmpdir(), directory);
  if (
    relativeToTemp === "" ||
    relativeToTemp === ".." ||
    relativeToTemp.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToTemp)
  ) {
    throw new Error(`Refusing to remove non-temporary path: ${directory}`);
  }

  await rm(directory, { recursive: true, force: true });
}

beforeEach(async () => {
  projectRoot = await createKnownTemporaryDirectory("deck-safety-project-");
  await writeFile(path.join(projectRoot, ".deck-project"), "", "utf8");
});

afterEach(async () => {
  const directories = temporaryDirectories.splice(0);
  await Promise.all(directories.map(removeKnownTemporaryDirectory));
});

describe("resolveProjectPath", () => {
  it("resolves relative and in-project absolute paths", async () => {
    const logicalPath = path.join(projectRoot, "pages", "01-cover.yaml");
    const expected = path.join(
      await realpath(projectRoot),
      "pages",
      "01-cover.yaml",
    );

    expect(resolveProjectPath(projectRoot, "pages/01-cover.yaml")).toBe(
      expected,
    );
    expect(resolveProjectPath(projectRoot, logicalPath)).toBe(expected);
  });

  it("blocks Unix absolute paths outside the project", () => {
    const outsidePath = path.join(tmpdir(), "outside-deck", "file.yaml");

    expect(() => resolveProjectPath(projectRoot, outsidePath)).toThrowError(
      expect.objectContaining({ code: "ABSOLUTE_PATH_OUTSIDE_PROJECT" }),
    );
  });

  it("blocks Windows drive and UNC paths on non-Windows hosts", () => {
    for (const unsafePath of [
      String.raw`C:\Users\someone\deck.yaml`,
      String.raw`\\server\share\deck.yaml`,
    ]) {
      expect(() => resolveProjectPath(projectRoot, unsafePath)).toThrowError(
        expect.objectContaining({ code: "ABSOLUTE_PATH_OUTSIDE_PROJECT" }),
      );
    }
  });

  it("blocks parent traversal with Unix or Windows separators", () => {
    for (const unsafePath of [
      "pages/../deck.yaml",
      String.raw`pages\..\deck.yaml`,
    ]) {
      expect(() => resolveProjectPath(projectRoot, unsafePath)).toThrowError(
        expect.objectContaining({ code: "PATH_TRAVERSAL" }),
      );
    }
  });

  it("blocks symlink escapes for existing and not-yet-created targets", async () => {
    const outsideRoot = await createKnownTemporaryDirectory(
      "deck-safety-outside-",
    );
    await symlink(outsideRoot, path.join(projectRoot, "outside-link"), "dir");

    expect(() =>
      resolveProjectPath(projectRoot, "outside-link/new-file.yaml"),
    ).toThrowError(expect.objectContaining({ code: "SYMLINK_ESCAPE" }));
  });

  it("allows a symlink that resolves to a directory inside the project", async () => {
    const mediaPath = path.join(projectRoot, "media");
    await mkdir(mediaPath);
    await symlink(mediaPath, path.join(projectRoot, "media-link"), "dir");

    expect(() =>
      assertSafeWrite(projectRoot, "media-link/image.png"),
    ).not.toThrow();
  });
});

describe("assertSafeWrite", () => {
  it("requires a regular .deck-project marker", async () => {
    await unlink(path.join(projectRoot, ".deck-project"));

    expect(() => assertSafeWrite(projectRoot, "pages/01.yaml")).toThrowError(
      expect.objectContaining({ code: "PROJECT_MARKER_MISSING" }),
    );
  });

  it("blocks filesystem root, home, project parent, and project root targets", () => {
    const filesystemRoot = path.parse(projectRoot).root;
    const projectParent = path.dirname(projectRoot);

    for (const unsafePath of [
      filesystemRoot,
      homedir(),
      projectParent,
      projectRoot,
    ]) {
      expect(() => assertSafeWrite(projectRoot, unsafePath)).toThrow();
    }
  });

  it("allows writes to ordinary paths inside a marked project", () => {
    expect(() => assertSafeWrite(projectRoot, "pages/01-cover.yaml")).not.toThrow();
  });
});

describe("assertSafeGeneratedDelete", () => {
  it("allows only generated directory roots and their descendants", () => {
    for (const safePath of [
      "preview",
      "preview/01.png",
      "output/deck.pptx",
      "reports/qa.json",
      ".deck-cache/layout.json",
    ]) {
      expect(() =>
        assertSafeGeneratedDelete(projectRoot, safePath),
      ).not.toThrow();
    }

    expect(() =>
      assertSafeGeneratedDelete(projectRoot, "pages/01-cover.yaml"),
    ).toThrowError(
      expect.objectContaining({
        code: "DELETE_OUTSIDE_GENERATED_DIRECTORIES",
      }),
    );
  });

  it("requires the project marker before deletion", async () => {
    await unlink(path.join(projectRoot, ".deck-project"));

    expect(() =>
      assertSafeGeneratedDelete(projectRoot, "output/deck.pptx"),
    ).toThrowError(expect.objectContaining({ code: "PROJECT_MARKER_MISSING" }));
  });

  it("blocks root, home, project parent, and project root deletion", () => {
    const filesystemRoot = path.parse(projectRoot).root;
    const projectParent = path.dirname(projectRoot);

    for (const unsafePath of [
      filesystemRoot,
      homedir(),
      projectParent,
      projectRoot,
    ]) {
      expect(() =>
        assertSafeGeneratedDelete(projectRoot, unsafePath),
      ).toThrow();
    }
  });

  it("blocks deletion through a generated-folder symlink escape", async () => {
    const outsideRoot = await createKnownTemporaryDirectory(
      "deck-safety-delete-outside-",
    );
    await mkdir(path.join(projectRoot, "output"));
    await symlink(
      outsideRoot,
      path.join(projectRoot, "output", "outside-link"),
      "dir",
    );

    expect(() =>
      assertSafeGeneratedDelete(
        projectRoot,
        "output/outside-link/asset.png",
      ),
    ).toThrowError(expect.objectContaining({ code: "SYMLINK_ESCAPE" }));
  });
});
