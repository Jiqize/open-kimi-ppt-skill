import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import {
  deckManifestSchema,
  deckPageSchema,
  deckThemeSchema,
  type DeckManifest,
  type DeckPage,
  type DeckTheme,
} from "@deck-agent/deck-schema";
import { parse as parseYaml } from "yaml";

export type DeckProjectLoadErrorCode =
  | "PROJECT_MARKER_MISSING"
  | "PROJECT_MARKER_UNREADABLE"
  | "MANIFEST_MISSING"
  | "MANIFEST_UNREADABLE"
  | "MANIFEST_INVALID"
  | "PAGE_MISSING"
  | "PAGE_UNREADABLE"
  | "PAGE_INVALID"
  | "THEME_MISSING"
  | "THEME_UNREADABLE"
  | "THEME_INVALID";

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

  const manifestSource = await readYaml(path.join(projectRoot, "deck.yaml"), {
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
    const pageSource = await readYaml(path.resolve(projectRoot, pagePath), {
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

    pages.push(pageResult.data);
  }

  if (manifest.theme === undefined) {
    return { root: projectRoot, manifest, pages };
  }

  const themeSource = await readYaml(
    path.resolve(projectRoot, manifest.theme),
    {
      displayPath: manifest.theme,
      missingCode: "THEME_MISSING",
      unreadableCode: "THEME_UNREADABLE",
      invalidCode: "THEME_INVALID",
    },
  );
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

