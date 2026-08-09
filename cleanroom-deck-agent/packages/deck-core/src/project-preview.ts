import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { assertSafeWrite, resolveProjectPath } from "./workspace-safety.js";

export interface ProjectPreviewWriteResult {
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly bytesWritten: number;
}

export interface ProjectPreviewWriter {
  write(
    relativePath: string,
    data: Uint8Array,
  ): Promise<ProjectPreviewWriteResult>;
}

export class ProjectPreviewError extends Error {
  readonly code = "PREVIEW_PATH_INVALID";
  readonly previewPath: string;

  constructor(message: string, previewPath: string) {
    super(message);
    this.name = "ProjectPreviewError";
    this.previewPath = previewPath;
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return {
      name: "ProjectPreviewError",
      code: this.code,
      message: this.message,
      previewPath: this.previewPath,
    };
  }
}

function assertPreviewDirectory(relativePath: string): void {
  if (
    relativePath.includes("\\") ||
    !relativePath.startsWith("preview/") ||
    relativePath.length === "preview/".length
  ) {
    throw new ProjectPreviewError(
      "Generated preview files must be written inside preview/",
      relativePath,
    );
  }
}

export function createProjectPreviewWriter(
  projectRoot: string,
): ProjectPreviewWriter {
  return {
    async write(
      relativePath: string,
      data: Uint8Array,
    ): Promise<ProjectPreviewWriteResult> {
      assertPreviewDirectory(relativePath);
      assertSafeWrite(projectRoot, relativePath);
      const absolutePath = resolveProjectPath(projectRoot, relativePath);

      await mkdir(path.dirname(absolutePath), { recursive: true });

      // Recheck immediately before opening the file so a newly-created
      // symlink cannot redirect the write outside the Deck Project.
      assertSafeWrite(projectRoot, relativePath);
      await writeFile(absolutePath, data);

      return {
        relativePath,
        absolutePath,
        bytesWritten: data.byteLength,
      };
    },
  };
}
