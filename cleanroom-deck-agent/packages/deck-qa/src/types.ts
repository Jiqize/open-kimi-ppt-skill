export const QA_ISSUE_CODES = [
  "ELEMENT_OUT_OF_BOUNDS",
  "ELEMENT_OVERLAP",
  "ELEMENT_ID_DUPLICATE",
  "MISSING_ASSET",
  "REMOTE_ASSET_UNSUPPORTED",
  "FONT_FALLBACK_INVALID",
  "FONT_UNAVAILABLE",
  "LOW_CONTRAST",
  "MISSING_TITLE",
  "TEXT_OVERFLOW_RISK",
  "TEXT_DENSITY_HIGH",
  "EMPTY_PAGE",
  "PAGE_MEANINGFUL_CONTENT_MISSING",
  "IMAGE_FRAME_SUSPICIOUS",
  "GEOMETRY_INVALID",
  "VISUAL_DEFAULT_LOW_CONFIDENCE",
  "LINE_ENDPOINT_INVALID",
] as const;

export type QaIssueCode = (typeof QA_ISSUE_CODES)[number];
export type QaSeverity = "info" | "warning" | "error";

export interface QaIssue {
  readonly code: QaIssueCode;
  readonly severity: QaSeverity;
  readonly pageId: string;
  readonly elementId?: string;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface QaSummary {
  readonly pagesChecked: number;
  readonly elementsChecked: number;
  readonly total: number;
  readonly info: number;
  readonly warning: number;
  readonly error: number;
}

export interface QaReport {
  readonly version: 1;
  readonly ok: boolean;
  readonly issues: readonly QaIssue[];
  readonly summary: QaSummary;
}
