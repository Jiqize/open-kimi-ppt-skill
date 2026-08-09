import { readFile } from "node:fs/promises";
import path from "node:path";

import { strFromU8, unzipSync } from "fflate";

import { PptxRenderError } from "./errors.js";

export interface PptxValidationExpectations {
  readonly slideCount: number;
  readonly imageCount: number;
  readonly representativeTexts: readonly (string | undefined)[];
}

export interface PptxValidationResult {
  readonly zipValid: true;
  readonly crcValid: true;
  readonly crcEntriesChecked: number;
  readonly slideCount: number;
  readonly presentationRelationshipCount: number;
  readonly slideRelationshipFileCount: number;
  readonly relationshipCount: number;
  readonly pictureCount: number;
  readonly mediaCount: number;
  readonly mediaRelationshipCount: number;
  readonly representativeTextCount: number;
}

interface Relationship {
  readonly id: string;
  readonly type: string;
  readonly target: string;
}

type ZipEntries = Readonly<Record<string, Uint8Array>>;

const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;

function uint16(data: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > data.length) {
    throw new PptxRenderError(
      "PPTX_ZIP_INVALID",
      "PPTX ZIP contains a truncated 16-bit field",
      { offset },
    );
  }
  return (data[offset] as number) | ((data[offset + 1] as number) << 8);
}

function uint32(data: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > data.length) {
    throw new PptxRenderError(
      "PPTX_ZIP_INVALID",
      "PPTX ZIP contains a truncated 32-bit field",
      { offset },
    );
  }
  return (
    ((data[offset] as number) |
      ((data[offset + 1] as number) << 8) |
      ((data[offset + 2] as number) << 16) |
      ((data[offset + 3] as number) << 24)) >>> 0
  );
}

function endOfCentralDirectoryOffset(data: Uint8Array): number {
  const minimumOffset = Math.max(0, data.length - 65_558);
  for (let offset = data.length - 22; offset >= minimumOffset; offset -= 1) {
    if (uint32(data, offset) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      return offset;
    }
  }
  throw new PptxRenderError(
    "PPTX_ZIP_INVALID",
    "PPTX ZIP end-of-central-directory record is missing",
  );
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function verifyZipCrc(data: Uint8Array, entries: ZipEntries): number {
  const eocdOffset = endOfCentralDirectoryOffset(data);
  const entryCount = uint16(data, eocdOffset + 10);
  const centralDirectoryOffset = uint32(data, eocdOffset + 16);
  if (entryCount === 0xffff || centralDirectoryOffset === 0xffffffff) {
    throw new PptxRenderError(
      "PPTX_ZIP_INVALID",
      "ZIP64 packages are not supported by the Milestone 1 verifier",
    );
  }

  let offset = centralDirectoryOffset;
  const seenNames = new Set<string>();
  for (let index = 0; index < entryCount; index += 1) {
    if (uint32(data, offset) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new PptxRenderError(
        "PPTX_ZIP_INVALID",
        "PPTX ZIP central-directory entry is missing or truncated",
        { index, offset },
      );
    }
    const flags = uint16(data, offset + 8);
    const expectedCrc = uint32(data, offset + 16);
    const expectedSize = uint32(data, offset + 24);
    const fileNameLength = uint16(data, offset + 28);
    const extraLength = uint16(data, offset + 30);
    const commentLength = uint16(data, offset + 32);
    const nameStart = offset + 46;
    const nameEnd = nameStart + fileNameLength;
    if (nameEnd > data.length) {
      throw new PptxRenderError(
        "PPTX_ZIP_INVALID",
        "PPTX ZIP central-directory filename is truncated",
        { index, offset },
      );
    }
    const fileName = strFromU8(data.subarray(nameStart, nameEnd), (flags & 2048) === 0);
    if (seenNames.has(fileName)) {
      throw new PptxRenderError(
        "PPTX_ZIP_INVALID",
        `PPTX ZIP contains a duplicate entry: ${fileName}`,
        { entry: fileName },
      );
    }
    seenNames.add(fileName);
    const unpacked = entries[fileName];
    if (unpacked === undefined) {
      throw new PptxRenderError(
        "PPTX_ZIP_INVALID",
        `PPTX ZIP central-directory entry was not unpacked: ${fileName}`,
        { entry: fileName },
      );
    }
    const actualCrc = crc32(unpacked);
    if (actualCrc !== expectedCrc || unpacked.length !== expectedSize) {
      throw new PptxRenderError(
        "PPTX_CRC_INVALID",
        `PPTX ZIP CRC or size check failed: ${fileName}`,
        {
          entry: fileName,
          expectedCrc,
          actualCrc,
          expectedSize,
          actualSize: unpacked.length,
        },
      );
    }
    offset = nameEnd + extraLength + commentLength;
  }

  if (seenNames.size !== Object.keys(entries).length) {
    throw new PptxRenderError(
      "PPTX_ZIP_INVALID",
      "PPTX ZIP entry count does not match its central directory",
      { centralDirectoryEntries: seenNames.size, unpackedEntries: Object.keys(entries).length },
    );
  }
  return seenNames.size;
}

function requiredEntry(entries: ZipEntries, name: string): Uint8Array {
  const entry = entries[name];
  if (entry === undefined) {
    throw new PptxRenderError(
      "PPTX_ZIP_INVALID",
      `PPTX package is missing required entry: ${name}`,
      { entry: name },
    );
  }
  return entry;
}

function xmlEntry(entries: ZipEntries, name: string): string {
  return strFromU8(requiredEntry(entries, name));
}

function parseAttributes(source: string): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Array.from(source.matchAll(/([A-Za-z_:][A-Za-z0-9_.:-]*)="([^"]*)"/gu)).map(
      (match) => [match[1] as string, match[2] as string],
    ),
  );
}

function parseRelationships(xml: string): readonly Relationship[] {
  return Array.from(xml.matchAll(/<Relationship\b([^>]*)\/?\s*>/gu)).map(
    (match) => {
      const attributes = parseAttributes(match[1] ?? "");
      const id = attributes.Id;
      const type = attributes.Type;
      const target = attributes.Target;
      if (id === undefined || type === undefined || target === undefined) {
        throw new PptxRenderError(
          "PPTX_RELATIONSHIP_INVALID",
          "PPTX relationship is missing Id, Type, or Target",
          { attributes },
        );
      }
      return { id, type, target };
    },
  );
}

function packageTarget(sourcePart: string, target: string): string {
  if (target.startsWith("/")) {
    return target.slice(1);
  }
  return path.posix.normalize(path.posix.join(path.posix.dirname(sourcePart), target));
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&#x([0-9A-Fa-f]+);/gu, (_, digits: string) =>
      String.fromCodePoint(Number.parseInt(digits, 16)),
    )
    .replace(/&#([0-9]+);/gu, (_, digits: string) =>
      String.fromCodePoint(Number.parseInt(digits, 10)),
    )
    .replace(/&apos;/gu, "'")
    .replace(/&quot;/gu, '"')
    .replace(/&gt;/gu, ">")
    .replace(/&lt;/gu, "<")
    .replace(/&amp;/gu, "&");
}

function textRuns(slideXml: string): readonly string[] {
  return Array.from(slideXml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/gu)).map(
    (match) => decodeXmlText(match[1] ?? ""),
  );
}

function normalizedText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function sortedSlideParts(entries: ZipEntries): readonly string[] {
  return Object.keys(entries)
    .map((name) => {
      const match = /^ppt\/slides\/slide([1-9][0-9]*)\.xml$/u.exec(name);
      return match === null
        ? undefined
        : { name, number: Number.parseInt(match[1] as string, 10) };
    })
    .filter(
      (value): value is { readonly name: string; readonly number: number } =>
        value !== undefined,
    )
    .sort((left, right) => left.number - right.number)
    .map(({ name }) => name);
}

export function validatePptxPackage(
  data: Uint8Array,
  expectations: PptxValidationExpectations,
): PptxValidationResult {
  if (
    data[0] !== 0x50 ||
    data[1] !== 0x4b ||
    data[2] !== 0x03 ||
    data[3] !== 0x04
  ) {
    throw new PptxRenderError(
      "PPTX_ZIP_INVALID",
      "PPTX output does not begin with a ZIP local-file signature",
    );
  }

  let entries: ZipEntries;
  try {
    entries = unzipSync(data);
  } catch (error) {
    throw new PptxRenderError("PPTX_ZIP_INVALID", "Could not read PPTX ZIP", {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  const crcEntriesChecked = verifyZipCrc(data, entries);

  requiredEntry(entries, "[Content_Types].xml");
  requiredEntry(entries, "ppt/presentation.xml");
  const presentationRelationships = parseRelationships(
    xmlEntry(entries, "ppt/_rels/presentation.xml.rels"),
  ).filter((relationship) => relationship.type.endsWith("/slide"));
  const slideParts = sortedSlideParts(entries);

  if (
    slideParts.length !== expectations.slideCount ||
    presentationRelationships.length !== expectations.slideCount
  ) {
    throw new PptxRenderError(
      "PPTX_SLIDE_COUNT_MISMATCH",
      "Generated PPTX slide count does not match the Resolved Deck",
      {
        expected: expectations.slideCount,
        slideParts: slideParts.length,
        presentationRelationships: presentationRelationships.length,
      },
    );
  }

  const relatedSlideParts = presentationRelationships.map((relationship) => {
    const target = packageTarget("ppt/presentation.xml", relationship.target);
    if (entries[target] === undefined) {
      throw new PptxRenderError(
        "PPTX_RELATIONSHIP_INVALID",
        `Presentation relationship target is missing: ${target}`,
        { relationship },
      );
    }
    return target;
  });
  if (
    new Set(relatedSlideParts).size !== slideParts.length ||
    slideParts.some((slidePart) => !relatedSlideParts.includes(slidePart))
  ) {
    throw new PptxRenderError(
      "PPTX_RELATIONSHIP_INVALID",
      "Presentation slide relationships do not match the slide parts",
      { relatedSlideParts, slideParts },
    );
  }

  let pictureCount = 0;
  let mediaRelationshipCount = 0;
  let representativeTextCount = 0;
  let relationshipCount = presentationRelationships.length;

  slideParts.forEach((slidePart, index) => {
    const slideXml = xmlEntry(entries, slidePart);
    pictureCount += slideXml.match(/<p:pic(?:\s|>)/gu)?.length ?? 0;

    const relationshipPart = `ppt/slides/_rels/${path.posix.basename(slidePart)}.rels`;
    const relationships = parseRelationships(xmlEntry(entries, relationshipPart));
    relationshipCount += relationships.length;
    const relationshipsById = new Map(
      relationships.map((relationship) => [relationship.id, relationship]),
    );
    const imageRelationships = relationships.filter((relationship) =>
      relationship.type.endsWith("/image"),
    );
    mediaRelationshipCount += imageRelationships.length;

    for (const relationship of imageRelationships) {
      const target = packageTarget(slidePart, relationship.target);
      if (!target.startsWith("ppt/media/") || entries[target] === undefined) {
        throw new PptxRenderError(
          "PPTX_MEDIA_INVALID",
          `Slide image relationship target is missing or outside ppt/media: ${target}`,
          { slidePart, relationship },
        );
      }
    }

    for (const match of slideXml.matchAll(/<a:blip\b[^>]*\br:embed="([^"]+)"/gu)) {
      const relationshipId = match[1] as string;
      const relationship = relationshipsById.get(relationshipId);
      if (relationship === undefined || !relationship.type.endsWith("/image")) {
        throw new PptxRenderError(
          "PPTX_RELATIONSHIP_INVALID",
          `Embedded image relationship is missing: ${relationshipId}`,
          { slidePart, relationshipId },
        );
      }
    }

    const representativeText = expectations.representativeTexts[index];
    if (representativeText !== undefined && representativeText.length > 0) {
      const runs = textRuns(slideXml);
      const normalizedRepresentative = normalizedText(representativeText);
      const normalizedSlideText = normalizedText(runs.join(" "));
      if (!normalizedSlideText.includes(normalizedRepresentative)) {
        throw new PptxRenderError(
          "PPTX_TEXT_MISSING",
          `Representative text is missing from ${slidePart}`,
          { slidePart, representativeText },
        );
      }
      representativeTextCount += 1;
    }
  });

  if (pictureCount !== expectations.imageCount) {
    throw new PptxRenderError(
      "PPTX_MEDIA_INVALID",
      "Generated PPTX picture count does not match the Resolved Deck",
      { expected: expectations.imageCount, actual: pictureCount },
    );
  }
  if (pictureCount > 0 && mediaRelationshipCount === 0) {
    throw new PptxRenderError(
      "PPTX_MEDIA_INVALID",
      "Generated PPTX pictures have no media relationships",
    );
  }

  const mediaCount = Object.keys(entries).filter((name) =>
    /^ppt\/media\/[^/]+$/u.test(name),
  ).length;
  if (pictureCount > 0 && mediaCount === 0) {
    throw new PptxRenderError(
      "PPTX_MEDIA_INVALID",
      "Generated PPTX contains pictures but no media files",
    );
  }

  return {
    zipValid: true,
    crcValid: true,
    crcEntriesChecked,
    slideCount: slideParts.length,
    presentationRelationshipCount: presentationRelationships.length,
    slideRelationshipFileCount: slideParts.length,
    relationshipCount,
    pictureCount,
    mediaCount,
    mediaRelationshipCount,
    representativeTextCount,
  };
}

export interface PptxVerificationExpectations
  extends PptxValidationExpectations {}

export interface PptxVerificationReport extends PptxValidationResult {
  readonly status: "verified";
  readonly path: string;
  readonly expectedSlideCount: number;
}

export async function verifyPptx(
  filePath: string,
  expected: PptxVerificationExpectations,
): Promise<PptxVerificationReport> {
  let data: Uint8Array;
  try {
    data = new Uint8Array(await readFile(filePath));
  } catch (error) {
    throw new PptxRenderError(
      "PPTX_READ_FAILED",
      `Could not read generated PPTX: ${filePath}`,
      { path: filePath, message: error instanceof Error ? error.message : String(error) },
    );
  }

  const validation = validatePptxPackage(data, expected);
  return {
    status: "verified",
    path: filePath,
    expectedSlideCount: expected.slideCount,
    ...validation,
  };
}
