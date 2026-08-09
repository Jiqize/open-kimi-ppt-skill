export type PptxRenderErrorCode =
  | "REMOTE_ASSET_UNSUPPORTED"
  | "IMAGE_FORMAT_UNSUPPORTED"
  | "PPTX_OUTPUT_PATH_INVALID"
  | "PPTX_GENERATION_FAILED"
  | "PPTX_ZIP_INVALID"
  | "PPTX_SLIDE_COUNT_MISMATCH"
  | "PPTX_RELATIONSHIP_INVALID"
  | "PPTX_MEDIA_INVALID"
  | "PPTX_TEXT_MISSING";

export class PptxRenderError extends Error {
  readonly code: PptxRenderErrorCode;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(
    code: PptxRenderErrorCode,
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "PptxRenderError";
    this.code = code;
    this.details = details;
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return {
      name: "PptxRenderError",
      code: this.code,
      message: this.message,
      ...(this.details === undefined ? {} : { details: this.details }),
    };
  }
}
