import { mkdir, mkdtemp, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createProjectAssetResolver } from "../src/asset-resolver.js";

const temporaryDirectories: string[] = [];
let projectRoot: string;

async function createTemporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function removeTemporaryDirectory(directory: string): Promise<void> {
  const relative = path.relative(tmpdir(), directory);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`Refusing to remove non-temporary path: ${directory}`);
  }
  await rm(directory, { recursive: true, force: true });
}

beforeEach(async () => {
  projectRoot = await createTemporaryDirectory("deck-asset-project-");
  await writeFile(path.join(projectRoot, ".deck-project"), "", "utf8");
  await mkdir(path.join(projectRoot, "media"));
});

afterEach(async () => {
  const directories = temporaryDirectories.splice(0);
  await Promise.all(directories.map(removeTemporaryDirectory));
});

describe("createProjectAssetResolver", () => {
  it("resolves and reads a contained local asset", async () => {
    const imageBytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHnOcQAAAAABJRU5ErkJggg==",
      "base64",
    );
    await writeFile(path.join(projectRoot, "media", "hero.png"), imageBytes);
    const resolver = createProjectAssetResolver(projectRoot);

    const asset = await resolver.resolve("media/hero.png");

    expect(asset).toMatchObject({
      kind: "local",
      source: "media/hero.png",
      mimeType: "image/png",
    });
    if (asset.kind !== "local") {
      throw new Error("Expected a local asset");
    }
    expect(Array.from(await resolver.read(asset))).toEqual(Array.from(imageBytes));
    await expect(resolver.readImage(asset)).resolves.toMatchObject({
      asset,
      dimensions: { width: 1, height: 1 },
    });
  });

  it("preserves remote URLs without downloading them", async () => {
    const resolver = createProjectAssetResolver(projectRoot);

    await expect(
      resolver.resolve("https://assets.example.com/hero.jpg"),
    ).resolves.toEqual({
      kind: "remote",
      source: "https://assets.example.com/hero.jpg",
      mimeType: "image/jpeg",
    });
  });

  it("rejects local paths outside the project", async () => {
    const outsideRoot = await createTemporaryDirectory("deck-asset-outside-");
    const outsideImage = path.join(outsideRoot, "outside.png");
    await writeFile(outsideImage, "outside", "utf8");
    const resolver = createProjectAssetResolver(projectRoot);

    await expect(resolver.resolve(outsideImage)).rejects.toMatchObject({
      code: "ASSET_PATH_UNSAFE",
      source: outsideImage,
    });
  });

  it("revalidates containment after a safe asset is replaced by a symlink", async () => {
    const localImage = path.join(projectRoot, "media", "hero.png");
    await writeFile(localImage, "safe", "utf8");
    const outsideRoot = await createTemporaryDirectory(
      "deck-asset-symlink-outside-",
    );
    const outsideImage = path.join(outsideRoot, "outside.png");
    await writeFile(outsideImage, "outside", "utf8");
    const resolver = createProjectAssetResolver(projectRoot);
    const asset = await resolver.resolve("media/hero.png");
    if (asset.kind !== "local") {
      throw new Error("Expected a local asset");
    }

    await unlink(localImage);
    await symlink(outsideImage, localImage, "file");

    await expect(resolver.read(asset)).rejects.toMatchObject({
      code: "ASSET_PATH_UNSAFE",
      source: "media/hero.png",
    });
  });

  it("reports invalid image bytes with a typed error", async () => {
    await writeFile(path.join(projectRoot, "media", "broken.png"), "broken");
    const resolver = createProjectAssetResolver(projectRoot);
    const asset = await resolver.resolve("media/broken.png");
    if (asset.kind !== "local") {
      throw new Error("Expected a local asset");
    }

    await expect(resolver.readImage(asset)).rejects.toMatchObject({
      code: "ASSET_IMAGE_INVALID",
      source: "media/broken.png",
    });
  });
});
