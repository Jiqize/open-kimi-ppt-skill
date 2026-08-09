import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { assertSafeWrite, resolveProjectPath } from "./workspace-safety.js";

export interface ProjectReportWriteResult {
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly bytesWritten: number;
}

export interface ProjectReportWriter {
  write(
    relativePath: string,
    data: Uint8Array,
  ): Promise<ProjectReportWriteResult>;
}

export class ProjectReportError extends Error {
  readonly code = "REPORT_PATH_INVALID";
  readonly reportPath: string;

  constructor(message: string, reportPath: string) {
    super(message);
    this.name = "ProjectReportError";
    this.reportPath = reportPath;
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      reportPath: this.reportPath,
    };
  }
}

function assertReportDirectory(relativePath: string): void {
  if (
    relativePath.includes("\\") ||
    !relativePath.startsWith("reports/") ||
    relativePath.length === "reports/".length
  ) {
    throw new ProjectReportError(
      "Generated QA reports must be written inside reports/",
      relativePath,
    );
  }
}

export function createProjectReportWriter(
  projectRoot: string,
): ProjectReportWriter {
  return {
    async write(relativePath, data) {
      assertReportDirectory(relativePath);
      assertSafeWrite(projectRoot, relativePath);
      const absolutePath = resolveProjectPath(projectRoot, relativePath);
      await mkdir(path.dirname(absolutePath), { recursive: true });
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
