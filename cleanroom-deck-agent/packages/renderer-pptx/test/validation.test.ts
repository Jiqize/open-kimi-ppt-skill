import { describe, expect, it } from "vitest";

import { validatePptxPackage } from "../src/validation.js";

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
});
