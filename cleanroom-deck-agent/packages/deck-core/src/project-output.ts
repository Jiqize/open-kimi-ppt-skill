import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { assertSafeWrite, resolveProjectPath } from "./workspace-safety.js";

export interface ProjectOutputWriteResult {
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly bytesWritten: number;
}

export interface ProjectOutputWriter {
  write(
    relativePath: string,
    data: Uint8Array,
  ): Promise<ProjectOutputWriteResult>;
}

export class ProjectOutputError extends Error {
  readonly code = "OUTPUT_PATH_INVALID";
  readonly outputPath: string;

  constructor(message: string, outputPath: string) {
    super(message);
    this.name = "ProjectOutputError";
    this.outputPath = outputPath;
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return {
      name: "ProjectOutputError",
      code: this.code,
      message: this.message,
      outputPath: this.outputPath,
    };
  }
}

function assertOutputDirectory(relativePath: string): void {
  if (
    relativePath.includes("\\") ||
    !relativePath.startsWith("output/") ||
    relativePath.length === "output/".length
  ) {
    throw new ProjectOutputError(
      "Generated presentation files must be written inside output/",
      relativePath,
    );
  }
}

export function createProjectOutputWriter(
  projectRoot: string,
): ProjectOutputWriter {
  return {
    async write(
      relativePath: string,
      data: Uint8Array,
    ): Promise<ProjectOutputWriteResult> {
      assertOutputDirectory(relativePath);
      assertSafeWrite(projectRoot, relativePath);
      const absolutePath = resolveProjectPath(projectRoot, relativePath);

      await mkdir(path.dirname(absolutePath), { recursive: true });

      // Recheck immediately before opening the output file so a newly-created
      // symlink cannot silently redirect the write outside the project.
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
