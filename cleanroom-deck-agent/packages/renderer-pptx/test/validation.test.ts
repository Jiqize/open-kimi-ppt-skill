import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { strToU8, zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";

import { validatePptxPackage, verifyPptx } from "../src/validation.js";

const temporaryDirectories: string[] = [];

function validPptxBytes(): Uint8Array {
  return zipSync({
    "[Content_Types].xml": strToU8("<Types/>"),
    "ppt/presentation.xml": strToU8("<p:presentation/>"),
    "ppt/_rels/presentation.xml.rels": strToU8(
      '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>',
    ),
    "ppt/slides/slide1.xml": strToU8(
      "<p:sld><p:sp><p:txBody><a:p><a:r><a:t>Representative text</a:t></a:r></a:p></p:txBody></p:sp></p:sld>",
    ),
    "ppt/slides/_rels/slide1.xml.rels": strToU8("<Relationships/>"),
  });
}

function corruptFirstCentralDirectoryCrc(data: Uint8Array): Uint8Array {
  const corrupted = data.slice();
  for (let offset = 0; offset + 20 <= corrupted.length; offset += 1) {
    if (
      corrupted[offset] === 0x50 &&
      corrupted[offset + 1] === 0x4b &&
      corrupted[offset + 2] === 0x01 &&
      corrupted[offset + 3] === 0x02
    ) {
      corrupted[offset + 16] = (corrupted[offset + 16] as number) ^ 0xff;
      return corrupted;
    }
  }
  throw new Error("Test fixture has no central-directory entry");
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("validatePptxPackage", () => {
  it("rejects non-ZIP output with a typed error", () => {
    expect(() =>
      validatePptxPackage(new Uint8Array([1, 2, 3, 4]), {
        slideCount: 1,
        imageCount: 0,
        representativeTexts: [undefined],
      }),
    ).toThrowError(expect.objectContaining({ code: "PPTX_ZIP_INVALID" }));
  });

  it("verifies a generated file from disk including every ZIP CRC", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "deck-pptx-valid-"));
    temporaryDirectories.push(directory);
    const outputPath = path.join(directory, "valid.pptx");
    await writeFile(outputPath, validPptxBytes());
    const report = await verifyPptx(outputPath, {
      slideCount: 1,
      imageCount: 0,
      representativeTexts: ["Representative text"],
    });

    expect(report).toMatchObject({
      status: "verified",
      zipValid: true,
      crcValid: true,
      slideCount: 1,
      presentationRelationshipCount: 1,
      slideRelationshipFileCount: 1,
    });
    expect(report.crcEntriesChecked).toBeGreaterThan(0);
  });

  it("rejects a corrupted ZIP with a typed CRC error", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "deck-pptx-corrupt-"));
    temporaryDirectories.push(directory);
    const outputPath = path.join(directory, "corrupt.pptx");
    await writeFile(outputPath, corruptFirstCentralDirectoryCrc(validPptxBytes()));

    await expect(
      verifyPptx(outputPath, {
        slideCount: 1,
        imageCount: 0,
        representativeTexts: ["Representative text"],
      }),
    ).rejects.toMatchObject({ code: "PPTX_CRC_INVALID" });
  });

  it("rejects a slide-count mismatch with a typed error", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "deck-pptx-mismatch-"));
    temporaryDirectories.push(directory);
    const outputPath = path.join(directory, "mismatch.pptx");
    await writeFile(outputPath, validPptxBytes());
    await expect(
      verifyPptx(outputPath, {
        slideCount: 2,
        imageCount: 0,
        representativeTexts: ["Representative text", undefined],
      }),
    ).rejects.toMatchObject({ code: "PPTX_SLIDE_COUNT_MISMATCH" });
  });
});
