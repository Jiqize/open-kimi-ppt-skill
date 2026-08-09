#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createProjectAssetResolver,
  createProjectOutputWriter,
  loadDeckProject,
} from "@deck-agent/deck-core";
import {
  resolveDeck,
  type ResolvedDeck,
  type ResolvedTextElement,
} from "@deck-agent/deck-layout";
import { renderPptx, verifyPptx } from "@deck-agent/renderer-pptx";

export type DeckCommandName = "validate" | "render" | "preview" | "qa";

export interface CliDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface CliCommandResult {
  readonly command: DeckCommandName;
  readonly status: "ok" | "warning" | "error";
  readonly warnings: readonly CliDiagnostic[];
  readonly errors: readonly CliDiagnostic[];
  readonly outputPaths: readonly string[];
  readonly details: Readonly<Record<string, unknown>>;
}

export interface CliIo {
  readonly stdout: (value: string) => void;
  readonly stderr: (value: string) => void;
}

interface ParsedCommand {
  readonly command: DeckCommandName;
  readonly projectPath: string;
  readonly json: boolean;
  readonly format?: "pptx";
}

class CliError extends Error {
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(
    code: string,
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "CliError";
    this.code = code;
    this.details = details;
  }
}

function parseCommand(argv: readonly string[]): ParsedCommand {
  const args = [...argv];
  const jsonIndex = args.indexOf("--json");
  const json = jsonIndex >= 0;
  if (json) {
    args.splice(jsonIndex, 1);
  }

  const rawCommand = args.shift();
  if (
    rawCommand !== "validate" &&
    rawCommand !== "render" &&
    rawCommand !== "preview" &&
    rawCommand !== "qa"
  ) {
    throw new CliError(
      "CLI_COMMAND_INVALID",
      "Expected one of: validate, render, preview, qa",
      { command: rawCommand ?? null },
    );
  }

  const projectPath = args.shift();
  if (projectPath === undefined || projectPath.startsWith("--")) {
    throw new CliError(
      "CLI_PROJECT_REQUIRED",
      `The ${rawCommand} command requires a Deck Project path`,
    );
  }

  if (rawCommand === "render") {
    const formatIndex = args.indexOf("--format");
    if (formatIndex < 0 || args[formatIndex + 1] === undefined) {
      throw new CliError(
        "CLI_FORMAT_REQUIRED",
        "The render command requires --format pptx",
      );
    }
    const format = args[formatIndex + 1];
    args.splice(formatIndex, 2);
    if (format !== "pptx") {
      throw new CliError(
        "FORMAT_UNSUPPORTED",
        `Unsupported render format: ${format}`,
        { format },
      );
    }
    if (args.length > 0) {
      throw new CliError("CLI_ARGUMENT_INVALID", `Unexpected argument: ${args[0]}`);
    }
    return { command: rawCommand, projectPath, json, format };
  }

  if (args.length > 0) {
    throw new CliError("CLI_ARGUMENT_INVALID", `Unexpected argument: ${args[0]}`);
  }

  return { command: rawCommand, projectPath, json };
}

async function loadResolvedProject(projectPath: string): Promise<{
  readonly root: string;
  readonly deck: ResolvedDeck;
}> {
  const project = await loadDeckProject(projectPath);
  return { root: project.root, deck: resolveDeck(project) };
}

function successfulResult(
  command: DeckCommandName,
  details: Readonly<Record<string, unknown>>,
  outputPaths: readonly string[] = [],
): CliCommandResult {
  return {
    command,
    status: "ok",
    warnings: [],
    errors: [],
    outputPaths,
    details,
  };
}

async function executeCommand(command: ParsedCommand): Promise<CliCommandResult> {
  if (command.command === "preview" || command.command === "qa") {
    throw new CliError(
      "CLI_COMMAND_NOT_IMPLEMENTED",
      `${command.command} is implemented by a later Milestone 1 task`,
      { command: command.command },
    );
  }

  const { root, deck } = await loadResolvedProject(command.projectPath);
  const elementCount = deck.pages.reduce(
    (count, page) => count + page.elements.length,
    0,
  );

  if (command.command === "validate") {
    return successfulResult("validate", {
      projectRoot: root,
      pageCount: deck.pages.length,
      elementCount,
    });
  }

  const rendered = await renderPptx(deck, {
    assets: createProjectAssetResolver(root),
    output: createProjectOutputWriter(root),
  });
  const imageCount = deck.pages.reduce(
    (count, page) =>
      count + page.elements.filter((element) => element.type === "image").length,
    0,
  );
  const representativeTexts = deck.pages.map(
    (page) =>
      page.elements.find(
        (element): element is ResolvedTextElement =>
          element.type === "text" && element.content.value.length > 0,
      )?.content.value,
  );
  const verification = await verifyPptx(rendered.absolutePath, {
    slideCount: deck.pages.length,
    imageCount,
    representativeTexts,
  });
  return successfulResult(
    "render",
    {
      projectRoot: root,
      format: command.format,
      pageCount: deck.pages.length,
      elementCount,
      output: {
        relativePath: rendered.relativePath,
        bytesWritten: rendered.bytesWritten,
      },
      verification: {
        status: verification.status,
        zip: {
          valid: verification.zipValid,
          crcValid: verification.crcValid,
          crcEntriesChecked: verification.crcEntriesChecked,
        },
        slides: {
          expected: verification.expectedSlideCount,
          actual: verification.slideCount,
        },
        media: {
          pictures: verification.pictureCount,
          files: verification.mediaCount,
        },
        relationships: {
          total: verification.relationshipCount,
          presentation: verification.presentationRelationshipCount,
          slideFiles: verification.slideRelationshipFileCount,
          media: verification.mediaRelationshipCount,
        },
        representativeTextCount: verification.representativeTextCount,
      },
    },
    [rendered.absolutePath],
  );
}

function diagnosticFromError(error: unknown): CliDiagnostic {
  if (error instanceof Error) {
    const record = error as Error & {
      readonly code?: unknown;
      readonly details?: unknown;
      readonly toJSON?: () => unknown;
    };
    const code = typeof record.code === "string" ? record.code : "UNEXPECTED_ERROR";
    const serialized = typeof record.toJSON === "function" ? record.toJSON() : undefined;
    const details =
      serialized !== undefined && typeof serialized === "object" && serialized !== null
        ? (serialized as Readonly<Record<string, unknown>>)
        : record.details !== undefined &&
            typeof record.details === "object" &&
            record.details !== null
          ? (record.details as Readonly<Record<string, unknown>>)
          : undefined;
    return {
      code,
      message: error.message,
      ...(details === undefined ? {} : { details }),
    };
  }
  return { code: "UNEXPECTED_ERROR", message: String(error) };
}

function failedResult(command: DeckCommandName, error: unknown): CliCommandResult {
  return {
    command,
    status: "error",
    warnings: [],
    errors: [diagnosticFromError(error)],
    outputPaths: [],
    details: {},
  };
}

function humanSummary(result: CliCommandResult): string {
  if (result.status === "error") {
    const first = result.errors[0];
    return `ERROR ${first?.code ?? "UNEXPECTED_ERROR"}: ${first?.message ?? "Command failed"}`;
  }
  if (result.command === "validate") {
    return `OK validate: ${String(result.details.pageCount)} page(s), ${String(result.details.elementCount)} element(s)`;
  }
  return `OK render: ${result.outputPaths[0] ?? "output/deck.pptx"}`;
}

export async function runCli(
  argv: readonly string[],
  io: CliIo = {
    stdout: (value) => process.stdout.write(`${value}\n`),
    stderr: (value) => process.stderr.write(`${value}\n`),
  },
): Promise<number> {
  let parsed: ParsedCommand | undefined;
  const json = argv.includes("--json");
  try {
    parsed = parseCommand(argv);
    const result = await executeCommand(parsed);
    io.stdout(json ? JSON.stringify(result, null, 2) : humanSummary(result));
    return 0;
  } catch (error) {
    const command = parsed?.command ??
      (argv.find((argument) =>
        ["validate", "render", "preview", "qa"].includes(argument),
      ) as DeckCommandName | undefined) ??
      "validate";
    const result = failedResult(command, error);
    const formatted = json ? JSON.stringify(result, null, 2) : humanSummary(result);
    if (json) {
      io.stdout(formatted);
    } else {
      io.stderr(formatted);
    }
    return 1;
  }
}

function isMainModule(): boolean {
  const scriptPath = process.argv[1];
  return scriptPath !== undefined && path.resolve(scriptPath) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  process.exitCode = await runCli(process.argv.slice(2));
}
