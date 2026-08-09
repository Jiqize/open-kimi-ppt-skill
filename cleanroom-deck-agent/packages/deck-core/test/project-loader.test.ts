import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { stringify as stringifyYaml } from "yaml";

import {
  DeckProjectLoadError,
  loadDeckProject,
} from "../src/project-loader.js";

const temporaryProjects: string[] = [];

async function createTemporaryProject(): Promise<string> {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "deck-project-loader-"));
  temporaryProjects.push(projectRoot);
  return projectRoot;
}

async function writeYaml(
  projectRoot: string,
  relativePath: string,
  value: unknown,
): Promise<void> {
  const filePath = path.join(projectRoot, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, stringifyYaml(value), "utf8");
}

async function createValidProject(): Promise<string> {
  const projectRoot = await createTemporaryProject();
  await writeFile(path.join(projectRoot, ".deck-project"), "", "utf8");
  await writeYaml(projectRoot, "deck.yaml", {
    version: 1,
    id: "ordered-deck",
    title: "Ordered Deck",
    size: { width: 13.333, height: 7.5 },
    theme: "themes/executive-light.yaml",
    pages: ["pages/02-second.yaml", "pages/01-first.yaml"],
  });
  await writeYaml(projectRoot, "pages/02-second.yaml", {
    id: "page-02",
    type: "insight",
    layout: { type: "title-body" },
    elements: [],
  });
  await writeYaml(projectRoot, "pages/01-first.yaml", {
    id: "page-01",
    type: "cover",
    layout: { type: "cover" },
    elements: [],
  });
  await writeYaml(projectRoot, "themes/executive-light.yaml", {
    name: "executive-light",
    colors: { background: "#F7F7F5", foreground: "#161616" },
    fonts: {
      heading: { family: "Arial", weight: 700 },
      body: { family: "Arial", weight: 400 },
    },
    spacing: { pageMargin: 0.7, grid: 0.1 },
    radius: { card: 0.12 },
  });
  return projectRoot;
}

async function snapshotFiles(root: string): Promise<Record<string, string>> {
  const snapshot: Record<string, string> = {};

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else {
        snapshot[path.relative(root, absolutePath)] = await readFile(
          absolutePath,
          "utf8",
        );
      }
    }
  }

  await visit(root);
  return snapshot;
}

afterEach(async () => {
  const roots = temporaryProjects.splice(0);
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("loadDeckProject", () => {
  it("fails when the .deck-project marker is missing", async () => {
    const projectRoot = await createTemporaryProject();

    await expect(loadDeckProject(projectRoot)).rejects.toMatchObject({
      code: "PROJECT_MARKER_MISSING",
      filePath: ".deck-project",
    });
  });

  it("fails when deck.yaml is missing", async () => {
    const projectRoot = await createTemporaryProject();
    await writeFile(path.join(projectRoot, ".deck-project"), "", "utf8");

    await expect(loadDeckProject(projectRoot)).rejects.toMatchObject({
      code: "MANIFEST_MISSING",
      filePath: "deck.yaml",
    });
  });

  it("reports the missing page path in a JSON-friendly error", async () => {
    const projectRoot = await createTemporaryProject();
    await writeFile(path.join(projectRoot, ".deck-project"), "", "utf8");
    await writeYaml(projectRoot, "deck.yaml", {
      version: 1,
      id: "missing-page",
      title: "Missing Page",
      size: { width: 13.333, height: 7.5 },
      pages: ["pages/missing.yaml"],
    });

    let thrown: unknown;
    try {
      await loadDeckProject(projectRoot);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(DeckProjectLoadError);
    expect(JSON.parse(JSON.stringify(thrown))).toEqual({
      name: "DeckProjectLoadError",
      code: "PAGE_MISSING",
      message: "Required file is missing: pages/missing.yaml",
      path: "pages/missing.yaml",
    });
  });

  it("loads pages in manifest order and resolves the optional theme", async () => {
    const projectRoot = await createValidProject();

    const project = await loadDeckProject(projectRoot);

    expect(project.root).toBe(path.resolve(projectRoot));
    expect(project.pages.map((page) => page.id)).toEqual([
      "page-02",
      "page-01",
    ]);
    expect(project.theme?.name).toBe("executive-light");
  });

  it("does not modify the project while loading", async () => {
    const projectRoot = await createValidProject();
    const before = await snapshotFiles(projectRoot);

    await loadDeckProject(projectRoot);

    expect(await snapshotFiles(projectRoot)).toEqual(before);
  });

  it("blocks page paths that escape the project root", async () => {
    const projectRoot = await createTemporaryProject();
    const outsideRoot = await createTemporaryProject();
    const outsidePage = path.join(outsideRoot, "outside-page.yaml");
    await writeFile(path.join(projectRoot, ".deck-project"), "", "utf8");
    await writeYaml(outsideRoot, "outside-page.yaml", {
      id: "outside-page",
      type: "cover",
      layout: { type: "cover" },
      elements: [],
    });
    await writeYaml(projectRoot, "deck.yaml", {
      version: 1,
      id: "unsafe-page",
      title: "Unsafe Page",
      size: { width: 13.333, height: 7.5 },
      pages: [path.relative(projectRoot, outsidePage)],
    });

    await expect(loadDeckProject(projectRoot)).rejects.toMatchObject({
      code: "PAGE_PATH_UNSAFE",
      filePath: path.relative(projectRoot, outsidePage),
    });
  });

  it("blocks a theme path that escapes through a symlink", async () => {
    const projectRoot = await createValidProject();
    const outsideRoot = await createTemporaryProject();
    const outsideTheme = path.join(outsideRoot, "theme.yaml");
    const projectTheme = path.join(
      projectRoot,
      "themes",
      "executive-light.yaml",
    );
    await writeYaml(outsideRoot, "theme.yaml", {
      name: "outside",
      colors: {},
      fonts: {},
      spacing: {},
      radius: {},
    });
    await unlink(projectTheme);
    await symlink(outsideTheme, projectTheme, "file");

    await expect(loadDeckProject(projectRoot)).rejects.toMatchObject({
      code: "THEME_PATH_UNSAFE",
      filePath: "themes/executive-light.yaml",
    });
  });

  it("blocks local media traversal and symlink escapes", async () => {
    const projectRoot = await createValidProject();
    const outsideRoot = await createTemporaryProject();
    const outsideMedia = path.join(outsideRoot, "hero.jpg");
    await writeFile(outsideMedia, "outside", "utf8");
    await writeYaml(projectRoot, "pages/02-second.yaml", {
      id: "page-02",
      type: "insight",
      layout: { type: "title-body" },
      elements: [
        {
          id: "hero",
          type: "image",
          source: path.relative(path.join(projectRoot, "pages"), outsideMedia),
        },
      ],
    });

    await expect(loadDeckProject(projectRoot)).rejects.toMatchObject({
      code: "MEDIA_PATH_UNSAFE",
      filePath: path.relative(path.join(projectRoot, "pages"), outsideMedia),
    });

    await mkdir(path.join(projectRoot, "media"));
    await symlink(
      outsideRoot,
      path.join(projectRoot, "media", "outside-link"),
      "dir",
    );
    await writeYaml(projectRoot, "pages/02-second.yaml", {
      id: "page-02",
      type: "insight",
      layout: { type: "title-body" },
      elements: [
        {
          id: "hero",
          type: "image",
          source: "../media/outside-link/hero.jpg",
        },
      ],
    });

    await expect(loadDeckProject(projectRoot)).rejects.toMatchObject({
      code: "MEDIA_PATH_UNSAFE",
      filePath: "../media/outside-link/hero.jpg",
    });
  });

  it("allows contained page-relative media and leaves remote URLs to providers", async () => {
    const projectRoot = await createValidProject();
    await mkdir(path.join(projectRoot, "media"));
    await writeFile(path.join(projectRoot, "media", "hero.jpg"), "image", "utf8");
    await writeYaml(projectRoot, "pages/02-second.yaml", {
      id: "page-02",
      type: "insight",
      layout: { type: "title-body" },
      elements: [
        {
          id: "local-hero",
          type: "image",
          source: "../media/hero.jpg",
        },
        {
          id: "remote-hero",
          type: "image",
          source: "https://assets.example.com/hero.jpg",
        },
      ],
    });

    const project = await loadDeckProject(projectRoot);

    expect(project.pages[0]?.elements).toHaveLength(2);
  });
});
