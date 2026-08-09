import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createProjectAssetResolver,
  createProjectOutputWriter,
  loadDeckProject,
} from "@deck-agent/deck-core";
import { resolveDeck, type ResolvedDeck } from "@deck-agent/deck-layout";
import { strFromU8, unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { renderPptx, type PptxRenderResult } from "../src/pptx-renderer.js";

const goldenSource = fileURLToPath(
  new URL("../../../examples/golden-task-07", import.meta.url),
);

let temporaryRoot: string;
let projectRoot: string;
let result: PptxRenderResult;
let presentationXml: string;
let slideXml: string;
let slideRelationshipsXml: string;
let zipEntries: Readonly<Record<string, Uint8Array>>;

async function removeTemporaryDirectory(directory: string): Promise<void> {
  const relative = path.relative(tmpdir(), directory);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`Refusing to remove non-temporary path: ${directory}`);
  }
  await rm(directory, { recursive: true, force: true });
}

beforeAll(async () => {
  temporaryRoot = await mkdtemp(path.join(tmpdir(), "deck-pptx-integration-"));
  projectRoot = path.join(temporaryRoot, "golden-task-07");
  await cp(goldenSource, projectRoot, { recursive: true });

  const project = await loadDeckProject(projectRoot);
  const resolvedDeck = resolveDeck(project);
  result = await renderPptx(resolvedDeck, {
    assets: createProjectAssetResolver(projectRoot),
    output: createProjectOutputWriter(projectRoot),
  });

  const bytes = new Uint8Array(await readFile(result.absolutePath));
  zipEntries = unzipSync(bytes);
  presentationXml = strFromU8(
    zipEntries["ppt/presentation.xml"] as Uint8Array,
  );
  slideXml = strFromU8(zipEntries["ppt/slides/slide1.xml"] as Uint8Array);
  slideRelationshipsXml = strFromU8(
    zipEntries["ppt/slides/_rels/slide1.xml.rels"] as Uint8Array,
  );
});

afterAll(async () => {
  await removeTemporaryDirectory(temporaryRoot);
});

describe("Task 07 PPTX renderer integration", () => {
  it("writes a valid one-slide PPTX through the guarded output context", () => {
    expect(result.relativePath).toBe("output/deck.pptx");
    expect(result.bytesWritten).toBeGreaterThan(0);
    expect(result.validation).toMatchObject({
      zipValid: true,
      slideCount: 1,
      pictureCount: 1,
      representativeTextCount: 1,
    });
    expect(zipEntries["[Content_Types].xml"]).toBeDefined();
    expect(zipEntries["ppt/presentation.xml"]).toBeDefined();
    expect(presentationXml).toContain(
      '<p:sldSz cx="9144000" cy="5486400"/>',
    );
  });

  it("keeps text as editable DrawingML text boxes", () => {
    expect(slideXml).toContain('name="title"');
    expect(slideXml).toContain('name="body"');
    expect(slideXml).toContain("<a:t>Editable Golden Deck</a:t>");
    expect(slideXml.match(/<p:txBody>/gu)?.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps the image as a replaceable picture with shared crop geometry", () => {
    expect(slideXml).toContain("<p:pic>");
    expect(slideXml).toContain('name="hero"');
    expect(slideXml).toContain(
      '<a:srcRect l="17391" r="17391" t="0" b="0"/>',
    );
    expect(slideRelationshipsXml).toContain(
      "relationships/image",
    );
    expect(result.validation.mediaCount).toBeGreaterThan(0);
    expect(result.validation.mediaRelationshipCount).toBeGreaterThan(0);
  });

  it("keeps the shape as an editable rounded rectangle", () => {
    expect(slideXml).toContain('name="card"');
    expect(slideXml).toContain('<a:prstGeom prst="roundRect">');
    expect(slideXml).toContain('<a:ln w="12700">');
  });

  it("keeps the line editable with its arrow at the destination", () => {
    expect(slideXml).toContain('name="direction"');
    expect(slideXml).toContain('<a:prstGeom prst="line">');
    expect(slideXml).toContain('<a:tailEnd type="triangle"/>');
  });

  it("preserves start-to-end direction for a reversed line", async () => {
    const reversedLineDeck: ResolvedDeck = {
      size: { width: 10, height: 6 },
      theme: null,
      pages: [
        {
          id: "reverse-page",
          type: "line-test",
          layout: { type: "free", options: {} },
          background: { color: "#FFFFFF" },
          elements: [
            {
              id: "reverse-line",
              type: "line",
              x: 2,
              y: 2,
              w: 6,
              h: 1,
              content: {
                start: { x: 8, y: 2.5 },
                end: { x: 2, y: 2.5 },
              },
              style: {
                stroke: "#3157F6",
                width: 2,
                dash: "solid",
                arrow: "end",
              },
            },
          ],
        },
      ],
    };

    const reversedResult = await renderPptx(reversedLineDeck, {
      assets: createProjectAssetResolver(projectRoot),
      output: createProjectOutputWriter(projectRoot),
    }, { outputPath: "output/reversed-line.pptx" });
    const reversedZip = unzipSync(
      new Uint8Array(await readFile(reversedResult.absolutePath)),
    );
    const reversedSlide = strFromU8(
      reversedZip["ppt/slides/slide1.xml"] as Uint8Array,
    );

    expect(reversedSlide).toContain('name="reverse-line"');
    expect(reversedSlide).toContain('flipH="1"');
    expect(reversedSlide).toContain('<a:tailEnd type="triangle"/>');
    expect(reversedSlide).not.toContain('<a:headEnd type="triangle"/>');
  });

  it("rejects remote images without downloading them", async () => {
    const remoteDeck: ResolvedDeck = {
      size: { width: 10, height: 6 },
      theme: null,
      pages: [
        {
          id: "remote-page",
          type: "image-test",
          layout: { type: "free", options: {} },
          background: { color: "#FFFFFF" },
          elements: [
            {
              id: "remote-image",
              type: "image",
              x: 1,
              y: 1,
              w: 4,
              h: 3,
              content: {
                source: "https://assets.example.com/remote.png",
                fit: "contain",
              },
              style: {},
            },
          ],
        },
      ],
    };

    await expect(
      renderPptx(remoteDeck, {
        assets: createProjectAssetResolver(projectRoot),
        output: createProjectOutputWriter(projectRoot),
      }, { outputPath: "output/remote.pptx" }),
    ).rejects.toMatchObject({ code: "REMOTE_ASSET_UNSUPPORTED" });
  });

  it("rejects a PPTX output path outside output/ before rendering", async () => {
    const emptyDeck: ResolvedDeck = {
      size: { width: 10, height: 6 },
      theme: null,
      pages: [],
    };

    await expect(
      renderPptx(emptyDeck, {
        assets: createProjectAssetResolver(projectRoot),
        output: createProjectOutputWriter(projectRoot),
      }, { outputPath: "reports/deck.pptx" }),
    ).rejects.toMatchObject({ code: "PPTX_OUTPUT_PATH_INVALID" });
  });
});
