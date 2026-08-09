import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  deckManifestSchema,
  deckPageSchema,
  deckThemeSchema,
  type DeckManifest,
  type DeckPage,
  type DeckTheme,
} from "@deck-agent/deck-schema";
import { parse as parseYaml } from "yaml";

import {
  resolveProjectReadPath,
  WorkspaceSafetyError,
} from "./workspace-safety.js";

export type DeckProjectLoadErrorCode =
  | "PROJECT_MARKER_MISSING"
  | "PROJECT_MARKER_UNREADABLE"
  | "MANIFEST_MISSING"
  | "MANIFEST_UNREADABLE"
  | "MANIFEST_INVALID"
  | "MANIFEST_PATH_UNSAFE"
  | "PAGE_MISSING"
  | "PAGE_UNREADABLE"
  | "PAGE_INVALID"
  | "PAGE_PATH_UNSAFE"
  | "THEME_MISSING"
  | "THEME_UNREADABLE"
  | "THEME_INVALID"
  | "THEME_PATH_UNSAFE"
  | "MEDIA_PATH_UNSAFE";

interface DeckProjectLoadErrorOptions {
  path?: string;
  issues?: readonly unknown[];
}

export interface DeckProjectLoadErrorJson {
  name: "DeckProjectLoadError";
  code: DeckProjectLoadErrorCode;
  message: string;
  path?: string;
  issues?: readonly unknown[];
}

export class DeckProjectLoadError extends Error {
  readonly code: DeckProjectLoadErrorCode;
  readonly filePath: string | undefined;
  readonly issues: readonly unknown[] | undefined;

  constructor(
    code: DeckProjectLoadErrorCode,
    message: string,
    options: DeckProjectLoadErrorOptions = {},
  ) {
    super(message);
    this.name = "DeckProjectLoadError";
    this.code = code;
    this.filePath = options.path;
    this.issues = options.issues;
  }

  toJSON(): DeckProjectLoadErrorJson {
    return {
      name: "DeckProjectLoadError",
      code: this.code,
      message: this.message,
      ...(this.filePath === undefined ? {} : { path: this.filePath }),
      ...(this.issues === undefined ? {} : { issues: this.issues }),
    };
  }
}

export interface DeckProject {
  root: string;
  manifest: DeckManifest;
  pages: DeckPage[];
  theme?: DeckTheme;
}

interface ReadYamlOptions {
  displayPath: string;
  missingCode: DeckProjectLoadErrorCode;
  unreadableCode: DeckProjectLoadErrorCode;
  invalidCode: DeckProjectLoadErrorCode;
}

type UnsafeReadPathErrorCode =
  | "MANIFEST_PATH_UNSAFE"
  | "PAGE_PATH_UNSAFE"
  | "THEME_PATH_UNSAFE"
  | "MEDIA_PATH_UNSAFE";

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resolveLocalReadPath(
  projectRoot: string,
  localPath: string,
  code: UnsafeReadPathErrorCode,
  kind: string,
  baseDirectory = projectRoot,
): string {
  try {
    return resolveProjectReadPath(projectRoot, localPath, baseDirectory);
  } catch (error) {
    if (error instanceof WorkspaceSafetyError) {
      throw new DeckProjectLoadError(
        code,
        `Unsafe local ${kind} path: ${localPath}`,
        { path: localPath, issues: [error.toJSON()] },
      );
    }

    throw error;
  }
}

function localMediaPath(source: string): string | undefined {
  if (/^[A-Za-z]:[\\/]/u.test(source) || /^\\\\/u.test(source)) {
    return source;
  }

  let url: URL;
  try {
    url = new URL(source);
  } catch (error) {
    return source;
  }

  if (url.protocol !== "file:") {
    return undefined;
  }

  return fileURLToPath(url);
}

function assertSafePageMediaPaths(
  projectRoot: string,
  pagePath: string,
  absolutePagePath: string,
  page: DeckPage,
): void {
  for (const element of page.elements) {
    if (element.type !== "image") {
      continue;
    }

    let localPath: string | undefined;
    try {
      localPath = localMediaPath(element.source);
    } catch (error) {
      throw new DeckProjectLoadError(
        "MEDIA_PATH_UNSAFE",
        `Invalid local media URL in ${pagePath}: ${element.source}`,
        {
          path: element.source,
          issues: [{ elementId: element.id, message: errorMessage(error) }],
        },
      );
    }

    if (localPath === undefined) {
      continue;
    }

    try {
      resolveLocalReadPath(
        projectRoot,
        localPath,
        "MEDIA_PATH_UNSAFE",
        "media",
        path.dirname(absolutePagePath),
      );
    } catch (error) {
      if (error instanceof DeckProjectLoadError) {
        throw new DeckProjectLoadError(error.code, error.message, {
          path: element.source,
          issues: [
            { pagePath, elementId: element.id },
            ...(error.issues ?? []),
          ],
        });
      }

      throw error;
    }
  }
}

async function readYaml(
  absolutePath: string,
  options: ReadYamlOptions,
): Promise<unknown> {
  let source: string;

  try {
    source = await readFile(absolutePath, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      throw new DeckProjectLoadError(
        options.missingCode,
        `Required file is missing: ${options.displayPath}`,
        { path: options.displayPath },
      );
    }

    throw new DeckProjectLoadError(
      options.unreadableCode,
      `Could not read ${options.displayPath}: ${errorMessage(error)}`,
      { path: options.displayPath },
    );
  }

  try {
    return parseYaml(source);
  } catch (error) {
    throw new DeckProjectLoadError(
      options.invalidCode,
      `Could not parse ${options.displayPath} as YAML: ${errorMessage(error)}`,
      { path: options.displayPath },
    );
  }
}

async function assertProjectMarker(projectRoot: string): Promise<void> {
  const markerPath = path.join(projectRoot, ".deck-project");

  try {
    const marker = await stat(markerPath);
    if (!marker.isFile()) {
      throw new DeckProjectLoadError(
        "PROJECT_MARKER_MISSING",
        "Deck Project marker is missing or is not a file: .deck-project",
        { path: ".deck-project" },
      );
    }
  } catch (error) {
    if (error instanceof DeckProjectLoadError) {
      throw error;
    }

    if (isMissingFileError(error)) {
      throw new DeckProjectLoadError(
        "PROJECT_MARKER_MISSING",
        "Deck Project marker is missing: .deck-project",
        { path: ".deck-project" },
      );
    }

    throw new DeckProjectLoadError(
      "PROJECT_MARKER_UNREADABLE",
      `Could not inspect .deck-project: ${errorMessage(error)}`,
      { path: ".deck-project" },
    );
  }
}

export async function loadDeckProject(
  projectPath: string,
): Promise<DeckProject> {
  const projectRoot = path.resolve(projectPath);
  await assertProjectMarker(projectRoot);

  const manifestPath = resolveLocalReadPath(
    projectRoot,
    "deck.yaml",
    "MANIFEST_PATH_UNSAFE",
    "manifest",
  );
  const manifestSource = await readYaml(manifestPath, {
    displayPath: "deck.yaml",
    missingCode: "MANIFEST_MISSING",
    unreadableCode: "MANIFEST_UNREADABLE",
    invalidCode: "MANIFEST_INVALID",
  });
  const manifestResult = deckManifestSchema.safeParse(manifestSource);

  if (!manifestResult.success) {
    throw new DeckProjectLoadError(
      "MANIFEST_INVALID",
      "deck.yaml does not match the Deck IR manifest schema",
      { path: "deck.yaml", issues: manifestResult.error.issues },
    );
  }

  const manifest = manifestResult.data;
  const pages: DeckPage[] = [];

  for (const pagePath of manifest.pages) {
    const absolutePagePath = resolveLocalReadPath(
      projectRoot,
      pagePath,
      "PAGE_PATH_UNSAFE",
      "page",
    );
    const pageSource = await readYaml(absolutePagePath, {
      displayPath: pagePath,
      missingCode: "PAGE_MISSING",
      unreadableCode: "PAGE_UNREADABLE",
      invalidCode: "PAGE_INVALID",
    });
    const pageResult = deckPageSchema.safeParse(pageSource);

    if (!pageResult.success) {
      throw new DeckProjectLoadError(
        "PAGE_INVALID",
        `Page does not match the Deck IR page schema: ${pagePath}`,
        { path: pagePath, issues: pageResult.error.issues },
      );
    }

    assertSafePageMediaPaths(
      projectRoot,
      pagePath,
      absolutePagePath,
      pageResult.data,
    );
    pages.push(pageResult.data);
  }

  if (manifest.theme === undefined) {
    return { root: projectRoot, manifest, pages };
  }

  const absoluteThemePath = resolveLocalReadPath(
    projectRoot,
    manifest.theme,
    "THEME_PATH_UNSAFE",
    "theme",
  );
  const themeSource = await readYaml(absoluteThemePath, {
    displayPath: manifest.theme,
    missingCode: "THEME_MISSING",
    unreadableCode: "THEME_UNREADABLE",
    invalidCode: "THEME_INVALID",
  });
  const themeResult = deckThemeSchema.safeParse(themeSource);

  if (!themeResult.success) {
    throw new DeckProjectLoadError(
      "THEME_INVALID",
      `Theme does not match the Deck IR theme schema: ${manifest.theme}`,
      { path: manifest.theme, issues: themeResult.error.issues },
    );
  }

  return { root: projectRoot, manifest, pages, theme: themeResult.data };
}
