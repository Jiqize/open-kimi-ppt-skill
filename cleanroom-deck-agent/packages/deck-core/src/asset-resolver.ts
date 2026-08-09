import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { imageSize } from "image-size";

import {
  resolveProjectReadPath,
  WorkspaceSafetyError,
} from "./workspace-safety.js";

export interface ResolvedLocalAsset {
  readonly kind: "local";
  readonly source: string;
  readonly absolutePath: string;
  readonly mimeType?: string;
}

export interface ResolvedRemoteAsset {
  readonly kind: "remote";
  readonly source: string;
  readonly mimeType?: string;
}

export type ResolvedAsset = ResolvedLocalAsset | ResolvedRemoteAsset;

export interface ImageDimensions {
  readonly width: number;
  readonly height: number;
}

export interface LoadedImageAsset {
  readonly asset: ResolvedLocalAsset;
  readonly data: Uint8Array;
  readonly dimensions: ImageDimensions;
}

export interface AssetResolver {
  resolve(source: string): Promise<ResolvedAsset>;
  read(asset: ResolvedLocalAsset): Promise<Uint8Array>;
  readImage(asset: ResolvedLocalAsset): Promise<LoadedImageAsset>;
}

export type AssetResolutionErrorCode =
  | "ASSET_SOURCE_INVALID"
  | "ASSET_PATH_UNSAFE"
  | "ASSET_CHANGED"
  | "ASSET_READ_FAILED"
  | "ASSET_IMAGE_INVALID";

export class AssetResolutionError extends Error {
  readonly code: AssetResolutionErrorCode;
  readonly source: string;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(
    code: AssetResolutionErrorCode,
    message: string,
    source: string,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "AssetResolutionError";
    this.code = code;
    this.source = source;
    this.details = details;
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return {
      name: "AssetResolutionError",
      code: this.code,
      message: this.message,
      source: this.source,
      ...(this.details === undefined ? {} : { details: this.details }),
    };
  }
}

const MIME_TYPES = new Map<string, string>([
  [".bmp", "image/bmp"],
  [".gif", "image/gif"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".tif", "image/tiff"],
  [".tiff", "image/tiff"],
  [".webp", "image/webp"],
]);

function mimeTypeForPath(inputPath: string): string | undefined {
  return MIME_TYPES.get(path.extname(inputPath).toLowerCase());
}

function isWindowsFilesystemPath(source: string): boolean {
  return /^[A-Za-z]:[\\/]/u.test(source) || /^\\\\/u.test(source);
}

function sourceAsLocalPath(source: string): string | undefined {
  if (isWindowsFilesystemPath(source)) {
    return source;
  }

  let url: URL;
  try {
    url = new URL(source);
  } catch {
    return source;
  }

  if (url.protocol !== "file:") {
    return undefined;
  }

  try {
    return fileURLToPath(url);
  } catch (error) {
    throw new AssetResolutionError(
      "ASSET_SOURCE_INVALID",
      `Invalid file URL: ${source}`,
      source,
      { message: error instanceof Error ? error.message : String(error) },
    );
  }
}

function resolveSafeLocalPath(projectRoot: string, source: string): string {
  const localPath = sourceAsLocalPath(source);
  if (localPath === undefined) {
    throw new AssetResolutionError(
      "ASSET_SOURCE_INVALID",
      `Remote asset cannot be treated as a local file: ${source}`,
      source,
    );
  }

  try {
    return resolveProjectReadPath(projectRoot, localPath);
  } catch (error) {
    if (error instanceof WorkspaceSafetyError) {
      throw new AssetResolutionError(
        "ASSET_PATH_UNSAFE",
        `Unsafe local asset path: ${source}`,
        source,
        { workspaceError: error.toJSON() },
      );
    }
    throw error;
  }
}

function pathsEqual(left: string, right: string): boolean {
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

export function createProjectAssetResolver(projectRoot: string): AssetResolver {
  const resolver: AssetResolver = {
    async resolve(source: string): Promise<ResolvedAsset> {
      const localPath = sourceAsLocalPath(source);
      if (localPath === undefined) {
        const url = new URL(source);
        const mimeType = mimeTypeForPath(url.pathname);
        return {
          kind: "remote",
          source,
          ...(mimeType === undefined ? {} : { mimeType }),
        };
      }

      const absolutePath = resolveSafeLocalPath(projectRoot, source);
      const mimeType = mimeTypeForPath(localPath);
      return {
        kind: "local",
        source,
        absolutePath,
        ...(mimeType === undefined ? {} : { mimeType }),
      };
    },

    async read(asset: ResolvedLocalAsset): Promise<Uint8Array> {
      const revalidatedPath = resolveSafeLocalPath(projectRoot, asset.source);
      if (!pathsEqual(revalidatedPath, asset.absolutePath)) {
        throw new AssetResolutionError(
          "ASSET_CHANGED",
          `Local asset resolved to a different path before read: ${asset.source}`,
          asset.source,
          {
            previousPath: asset.absolutePath,
            revalidatedPath,
          },
        );
      }

      try {
        return new Uint8Array(await readFile(revalidatedPath));
      } catch (error) {
        throw new AssetResolutionError(
          "ASSET_READ_FAILED",
          `Could not read local asset: ${asset.source}`,
          asset.source,
          { message: error instanceof Error ? error.message : String(error) },
        );
      }
    },

    async readImage(asset: ResolvedLocalAsset): Promise<LoadedImageAsset> {
      const data = await resolver.read(asset);
      try {
        const dimensions = imageSize(data);
        if (
          !Number.isFinite(dimensions.width) ||
          !Number.isFinite(dimensions.height) ||
          dimensions.width <= 0 ||
          dimensions.height <= 0
        ) {
          throw new Error("Image dimensions must be positive finite numbers");
        }
        return {
          asset,
          data,
          dimensions: {
            width: dimensions.width,
            height: dimensions.height,
          },
        };
      } catch (error) {
        throw new AssetResolutionError(
          "ASSET_IMAGE_INVALID",
          `Could not inspect local image asset: ${asset.source}`,
          asset.source,
          { message: error instanceof Error ? error.message : String(error) },
        );
      }
    },
  };

  return resolver;
}
