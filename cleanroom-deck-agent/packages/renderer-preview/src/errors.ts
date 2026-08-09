export type PreviewRenderErrorCode =
  | "PREVIEW_DIMENSIONS_INVALID"
  | "PREVIEW_BROWSER_UNAVAILABLE"
  | "PREVIEW_SCREENSHOT_FAILED";

export class PreviewRenderError extends Error {
  readonly code: PreviewRenderErrorCode;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(
    code: PreviewRenderErrorCode,
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "PreviewRenderError";
    this.code = code;
    this.details = details;
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return {
      name: "PreviewRenderError",
      code: this.code,
      message: this.message,
      ...(this.details === undefined ? {} : { details: this.details }),
    };
  }
}
