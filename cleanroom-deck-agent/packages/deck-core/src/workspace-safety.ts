import { lstatSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export const GENERATED_DIRECTORIES = [
  "preview",
  "output",
  "reports",
  ".deck-cache",
] as const;

export type WorkspaceSafetyErrorCode =
  | "INVALID_PROJECT_ROOT"
  | "PROJECT_MARKER_MISSING"
  | "PATH_TRAVERSAL"
  | "ABSOLUTE_PATH_OUTSIDE_PROJECT"
  | "PATH_OUTSIDE_PROJECT"
  | "PROTECTED_PATH"
  | "PROJECT_ROOT_TARGET"
  | "SYMLINK_ESCAPE"
  | "PATH_UNREADABLE"
  | "DELETE_OUTSIDE_GENERATED_DIRECTORIES";

export interface WorkspaceSafetyErrorJson {
  name: "WorkspaceSafetyError";
  code: WorkspaceSafetyErrorCode;
  message: string;
  path?: string;
}

export class WorkspaceSafetyError extends Error {
  readonly code: WorkspaceSafetyErrorCode;
  readonly targetPath: string | undefined;

  constructor(
    code: WorkspaceSafetyErrorCode,
    message: string,
    targetPath?: string,
  ) {
    super(message);
    this.name = "WorkspaceSafetyError";
    this.code = code;
    this.targetPath = targetPath;
  }

  toJSON(): WorkspaceSafetyErrorJson {
    return {
      name: "WorkspaceSafetyError",
      code: this.code,
      message: this.message,
      ...(this.targetPath === undefined ? {} : { path: this.targetPath }),
    };
  }
}

function pathsEqual(left: string, right: string): boolean {
  if (process.platform === "win32") {
    return left.toLowerCase() === right.toLowerCase();
  }

  return left === right;
}

function isWithinOrEqual(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

function canonicalExistingPath(inputPath: string): string {
  try {
    return realpathSync.native(inputPath);
  } catch (error) {
    throw new WorkspaceSafetyError(
      "INVALID_PROJECT_ROOT",
      `Project root must be an existing directory: ${inputPath}`,
      inputPath,
    );
  }
}

function canonicalProjectRoot(projectRoot: string): string {
  const absoluteRoot = path.resolve(projectRoot);
  const canonicalRoot = canonicalExistingPath(absoluteRoot);

  try {
    if (!statSync(canonicalRoot).isDirectory()) {
      throw new WorkspaceSafetyError(
        "INVALID_PROJECT_ROOT",
        `Project root is not a directory: ${projectRoot}`,
        projectRoot,
      );
    }
  } catch (error) {
    if (error instanceof WorkspaceSafetyError) {
      throw error;
    }

    throw new WorkspaceSafetyError(
      "INVALID_PROJECT_ROOT",
      `Could not inspect project root: ${projectRoot}`,
      projectRoot,
    );
  }

  const filesystemRoot = path.parse(canonicalRoot).root;
  const canonicalHome = canonicalExistingPath(homedir());

  if (
    pathsEqual(canonicalRoot, filesystemRoot) ||
    pathsEqual(canonicalRoot, canonicalHome)
  ) {
    throw new WorkspaceSafetyError(
      "INVALID_PROJECT_ROOT",
      "Filesystem root and home directory cannot be used as a Deck Project root",
      canonicalRoot,
    );
  }

  return canonicalRoot;
}

function assertProjectMarker(projectRoot: string): void {
  const markerPath = path.join(projectRoot, ".deck-project");

  try {
    const marker = lstatSync(markerPath);
    if (!marker.isFile()) {
      throw new WorkspaceSafetyError(
        "PROJECT_MARKER_MISSING",
        "A regular .deck-project marker file is required",
        markerPath,
      );
    }
  } catch (error) {
    if (error instanceof WorkspaceSafetyError) {
      throw error;
    }

    throw new WorkspaceSafetyError(
      "PROJECT_MARKER_MISSING",
      "A regular .deck-project marker file is required",
      markerPath,
    );
  }
}

function hasTraversalSegment(inputPath: string): boolean {
  return inputPath.split(/[\\/]+/u).some((segment) => segment === "..");
}

function isForeignWindowsPath(inputPath: string): boolean {
  return (
    process.platform !== "win32" &&
    (/^[A-Za-z]:/u.test(inputPath) || /^\\\\/u.test(inputPath))
  );
}

function assertTargetIsNotProtected(
  projectRoot: string,
  targetPath: string,
): void {
  if (pathsEqual(targetPath, projectRoot)) {
    throw new WorkspaceSafetyError(
      "PROJECT_ROOT_TARGET",
      "The Deck Project root cannot be a write or delete target",
      targetPath,
    );
  }

  const protectedPaths = new Set([
    path.parse(targetPath).root,
    canonicalExistingPath(homedir()),
    path.dirname(projectRoot),
  ]);

  for (const protectedPath of protectedPaths) {
    if (pathsEqual(targetPath, protectedPath)) {
      throw new WorkspaceSafetyError(
        "PROTECTED_PATH",
        "Filesystem root, home directory, and project parent are protected",
        targetPath,
      );
    }
  }
}

function nearestExistingAncestor(targetPath: string): string {
  let candidate = targetPath;

  while (true) {
    try {
      lstatSync(candidate);
      return candidate;
    } catch (error) {
      const code =
        error instanceof Error && "code" in error
          ? (error as NodeJS.ErrnoException).code
          : undefined;

      if (code !== "ENOENT" && code !== "ENOTDIR") {
        throw new WorkspaceSafetyError(
          "PATH_UNREADABLE",
          `Could not inspect path: ${candidate}`,
          candidate,
        );
      }

      const parent = path.dirname(candidate);
      if (pathsEqual(parent, candidate)) {
        throw new WorkspaceSafetyError(
          "PATH_UNREADABLE",
          `Could not find an existing ancestor for path: ${targetPath}`,
          targetPath,
        );
      }
      candidate = parent;
    }
  }
}

function assertNoSymlinkEscape(projectRoot: string, targetPath: string): void {
  const existingAncestor = nearestExistingAncestor(targetPath);
  let canonicalAncestor: string;

  try {
    canonicalAncestor = realpathSync.native(existingAncestor);
  } catch (error) {
    throw new WorkspaceSafetyError(
      "SYMLINK_ESCAPE",
      `Path contains an unresolved or dangling symlink: ${existingAncestor}`,
      targetPath,
    );
  }

  if (!isWithinOrEqual(projectRoot, canonicalAncestor)) {
    throw new WorkspaceSafetyError(
      "SYMLINK_ESCAPE",
      `Path escapes the Deck Project through a symlink: ${targetPath}`,
      targetPath,
    );
  }
}

function resolveFromCanonicalRoot(
  projectRoot: string,
  logicalProjectRoot: string,
  inputPath: string,
): string {
  if (inputPath.length === 0) {
    throw new WorkspaceSafetyError(
      "PROJECT_ROOT_TARGET",
      "An empty path targets the Deck Project root",
      inputPath,
    );
  }

  if (hasTraversalSegment(inputPath)) {
    throw new WorkspaceSafetyError(
      "PATH_TRAVERSAL",
      `Parent path traversal is not allowed: ${inputPath}`,
      inputPath,
    );
  }

  const isAmbiguousWindowsDrivePath =
    process.platform === "win32" &&
    /^[A-Za-z]:/u.test(inputPath) &&
    !path.win32.isAbsolute(inputPath);

  if (isForeignWindowsPath(inputPath) || isAmbiguousWindowsDrivePath) {
    throw new WorkspaceSafetyError(
      "ABSOLUTE_PATH_OUTSIDE_PROJECT",
      `Windows drive and UNC paths are not valid for this project: ${inputPath}`,
      inputPath,
    );
  }

  const inputIsAbsolute = path.isAbsolute(inputPath);
  const absoluteInputPath = inputIsAbsolute ? path.resolve(inputPath) : undefined;
  const targetPath =
    absoluteInputPath === undefined
      ? path.resolve(projectRoot, inputPath)
      : isWithinOrEqual(logicalProjectRoot, absoluteInputPath)
        ? path.resolve(
            projectRoot,
            path.relative(logicalProjectRoot, absoluteInputPath),
          )
        : absoluteInputPath;

  assertTargetIsNotProtected(projectRoot, targetPath);

  if (!isWithinOrEqual(projectRoot, targetPath)) {
    throw new WorkspaceSafetyError(
      inputIsAbsolute
        ? "ABSOLUTE_PATH_OUTSIDE_PROJECT"
        : "PATH_OUTSIDE_PROJECT",
      `Path is outside the Deck Project: ${inputPath}`,
      inputPath,
    );
  }

  assertNoSymlinkEscape(projectRoot, targetPath);
  return targetPath;
}

export function resolveProjectPath(
  projectRoot: string,
  relativePath: string,
): string {
  const logicalProjectRoot = path.resolve(projectRoot);
  return resolveFromCanonicalRoot(
    canonicalProjectRoot(projectRoot),
    logicalProjectRoot,
    relativePath,
  );
}

export function assertSafeWrite(
  projectRoot: string,
  relativePath: string,
): void {
  const canonicalRoot = canonicalProjectRoot(projectRoot);
  assertProjectMarker(canonicalRoot);
  resolveFromCanonicalRoot(canonicalRoot, path.resolve(projectRoot), relativePath);
}

export function assertSafeGeneratedDelete(
  projectRoot: string,
  relativePath: string,
): void {
  const canonicalRoot = canonicalProjectRoot(projectRoot);
  assertProjectMarker(canonicalRoot);
  const targetPath = resolveFromCanonicalRoot(
    canonicalRoot,
    path.resolve(projectRoot),
    relativePath,
  );
  const projectRelativePath = path.relative(canonicalRoot, targetPath);
  const topLevelDirectory = projectRelativePath.split(path.sep)[0];

  if (
    topLevelDirectory === undefined ||
    !GENERATED_DIRECTORIES.includes(
      topLevelDirectory as (typeof GENERATED_DIRECTORIES)[number],
    )
  ) {
    throw new WorkspaceSafetyError(
      "DELETE_OUTSIDE_GENERATED_DIRECTORIES",
      `Deletion is allowed only in: ${GENERATED_DIRECTORIES.join(", ")}`,
      relativePath,
    );
  }
}
