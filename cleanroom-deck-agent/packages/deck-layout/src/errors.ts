export type LayoutResolutionErrorCode =
  | "LAYOUT_UNSUPPORTED"
  | "LAYOUT_OPTIONS_INVALID"
  | "PLACEMENT_UNRESOLVED"
  | "PLACEMENT_CONFLICT"
  | "SLOT_INVALID"
  | "ELEMENT_OUT_OF_BOUNDS"
  | "THEME_TOKEN_UNRESOLVED";

export interface LayoutResolutionErrorContext {
  readonly pageId: string;
  readonly elementId?: string;
  readonly layoutType?: string;
  readonly slot?: string;
  readonly token?: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface LayoutResolutionErrorJson {
  readonly name: "LayoutResolutionError";
  readonly code: LayoutResolutionErrorCode;
  readonly message: string;
  readonly context: LayoutResolutionErrorContext;
}

export class LayoutResolutionError extends Error {
  readonly code: LayoutResolutionErrorCode;
  readonly context: LayoutResolutionErrorContext;

  constructor(
    code: LayoutResolutionErrorCode,
    message: string,
    context: LayoutResolutionErrorContext,
  ) {
    super(message);
    this.name = "LayoutResolutionError";
    this.code = code;
    this.context = context;
  }

  toJSON(): LayoutResolutionErrorJson {
    return {
      name: "LayoutResolutionError",
      code: this.code,
      message: this.message,
      context: this.context,
    };
  }
}

