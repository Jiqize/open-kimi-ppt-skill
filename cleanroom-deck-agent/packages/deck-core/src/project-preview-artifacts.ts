import { readdir, unlink } from "node:fs/promises";
import path from "node:path";

import {
  assertSafeGeneratedDelete,
  resolveProjectPath,
} from "./workspace-safety.js";

const GENERATED_PREVIEW_ARTIFACT = /^(?:[0-9]{2,}\.png|overview\.(?:png|jpg))$/u;

export class ProjectPreviewArtifactError extends Error {
  readonly code = "PREVIEW_ARTIFACT_PATH_INVALID";
  readonly artifactPath: string;

  constructor(message: string, artifactPath: string) {
    super(message);
    this.name = "ProjectPreviewArtifactError";
    this.artifactPath = artifactPath;
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      artifactPath: this.artifactPath,
    };
  }
}

export interface PreviewArtifactCleanupOptions {
  readonly expectedPaths: readonly string[];
  readonly force?: boolean;
}

export interface PreviewArtifactCleanupResult {
  readonly removedPaths: readonly string[];
}

function assertGeneratedPreviewPath(relativePath: string): void {
  const portable = relativePath.replaceAll("\\", "/");
  const fileName = portable.startsWith("preview/")
    ? portable.slice("preview/".length)
    : "";
  if (
    portable !== relativePath ||
    fileName.includes("/") ||
    !GENERATED_PREVIEW_ARTIFACT.test(fileName)
  ) {
    throw new ProjectPreviewArtifactError(
      "Expected preview paths must name a known generated artifact directly inside preview/",
      relativePath,
    );
  }
}

function isMissingDirectory(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

/**
 * Removes only known, program-generated files directly inside preview/.
 * It intentionally has no recursive-delete path.
 */
export async function cleanProjectPreviewArtifacts(
  projectRoot: string,
  options: PreviewArtifactCleanupOptions,
): Promise<PreviewArtifactCleanupResult> {
  for (const expectedPath of options.expectedPaths) {
    assertGeneratedPreviewPath(expectedPath);
  }
  const expectedPaths = new Set(options.expectedPaths);
  const previewDirectory = resolveProjectPath(projectRoot, "preview");
  let entries;
  try {
    entries = await readdir(previewDirectory, { withFileTypes: true });
  } catch (error) {
    if (isMissingDirectory(error)) {
      return { removedPaths: [] };
    }
    throw error;
  }

  const removable = entries
    .filter(
      (entry) =>
        (entry.isFile() || entry.isSymbolicLink()) &&
        GENERATED_PREVIEW_ARTIFACT.test(entry.name),
    )
    .map((entry) => `preview/${entry.name}`)
    .filter(
      (relativePath) => options.force === true || !expectedPaths.has(relativePath),
    )
    .sort();

  const removedPaths: string[] = [];
  for (const relativePath of removable) {
    assertSafeGeneratedDelete(projectRoot, relativePath);
    const absolutePath = resolveProjectPath(projectRoot, relativePath);
    try {
      await unlink(absolutePath);
      removedPaths.push(relativePath);
    } catch (error) {
      if (!isMissingDirectory(error)) {
        throw error;
      }
    }
  }
  return { removedPaths };
}
