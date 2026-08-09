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
  readonly slideCount: number;
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

  slideParts.forEach((slidePart, index) => {
    const slideXml = xmlEntry(entries, slidePart);
    pictureCount += slideXml.match(/<p:pic(?:\s|>)/gu)?.length ?? 0;

    const relationshipPart = `ppt/slides/_rels/${path.posix.basename(slidePart)}.rels`;
    const relationships = parseRelationships(xmlEntry(entries, relationshipPart));
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
    slideCount: slideParts.length,
    pictureCount,
    mediaCount,
    mediaRelationshipCount,
    representativeTextCount,
  };
}
