import type { DeckSize, DeckTheme } from "@deck-agent/deck-schema";

export interface ResolvedBounds {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface ResolvedTextWrap {
  readonly mode: "word" | "character" | "none";
  readonly maxLines?: number;
  readonly overflow: "clip" | "ellipsis" | "shrink";
}

export interface ResolvedTextContent {
  readonly value: string;
}

export interface ResolvedTextStyle {
  readonly fontFamily: string;
  readonly fontWeight: number;
  readonly fontStyle: "normal" | "italic";
  readonly fontSize: number;
  readonly color: string;
  readonly bold: boolean;
  readonly alignment: "left" | "center" | "right" | "justify";
  readonly wrap: ResolvedTextWrap;
}

export interface ResolvedImageCrop {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface ResolvedImageContent {
  readonly source: string;
  readonly fit: "cover" | "contain";
  readonly crop?: ResolvedImageCrop;
  readonly alt?: string;
}

export type ResolvedImageStyle = Readonly<Record<string, never>>;

export interface ResolvedShapeContent {
  readonly kind: "rectangle" | "ellipse";
}

export interface ResolvedShapeStyle {
  readonly fill: string | null;
  readonly stroke: string | null;
  readonly strokeWidth: number;
  readonly radius: number;
}

export interface ResolvedPoint {
  readonly x: number;
  readonly y: number;
}

export interface ResolvedLineContent {
  /** Absolute source point. */
  readonly start: ResolvedPoint;
  /** Absolute destination point; end arrows point here from start. */
  readonly end: ResolvedPoint;
}

export interface ResolvedLineStyle {
  readonly stroke: string;
  readonly width: number;
  readonly dash: "solid" | "dash" | "dot";
  readonly arrow: "none" | "start" | "end" | "both";
}

export interface ResolvedElementBase extends ResolvedBounds {
  readonly id: string;
  readonly type: "text" | "image" | "shape" | "line";
}

export interface ResolvedTextElement extends ResolvedElementBase {
  readonly type: "text";
  readonly content: ResolvedTextContent;
  readonly style: ResolvedTextStyle;
}

export interface ResolvedImageElement extends ResolvedElementBase {
  readonly type: "image";
  readonly content: ResolvedImageContent;
  readonly style: ResolvedImageStyle;
}

export interface ResolvedShapeElement extends ResolvedElementBase {
  readonly type: "shape";
  readonly content: ResolvedShapeContent;
  readonly style: ResolvedShapeStyle;
}

export interface ResolvedLineElement extends ResolvedElementBase {
  readonly type: "line";
  readonly content: ResolvedLineContent;
  readonly style: ResolvedLineStyle;
}

export type ResolvedElement =
  | ResolvedTextElement
  | ResolvedImageElement
  | ResolvedShapeElement
  | ResolvedLineElement;

export type ResolvedElementStyle = ResolvedElement["style"];

export interface ResolvedFreeLayout {
  readonly type: "free";
  readonly options: Readonly<Record<string, never>>;
}

export interface ResolvedSplitLayout {
  readonly type: "split";
  readonly options: Readonly<{
    ratio: number;
    margin: number;
    gap: number;
    titleHeight: number;
  }>;
}

export interface ResolvedCoverLayout {
  readonly type: "cover";
  readonly options: Readonly<{
    margin: number;
    gap: number;
    titleHeight: number;
    bodyHeight: number;
  }>;
}

export interface ResolvedTitleBodyLayout {
  readonly type: "title-body";
  readonly options: Readonly<{
    margin: number;
    gap: number;
    titleHeight: number;
  }>;
}

export interface ResolvedTwoColumnLayout {
  readonly type: "two-column";
  readonly options: Readonly<{
    margin: number;
    gap: number;
    titleHeight: number;
    columnTitleHeight: number;
  }>;
}

export interface ResolvedMetricGridLayout {
  readonly type: "metric-grid";
  readonly options: Readonly<{
    columns: number;
    rows: number;
    margin: number;
    gap: number;
    titleHeight: number;
  }>;
}

export interface ResolvedFullImageLayout {
  readonly type: "full-image";
  readonly options: Readonly<{
    margin: number;
    gap: number;
    titleHeight: number;
    bodyHeight: number;
  }>;
}

export type ResolvedLayout =
  | ResolvedFreeLayout
  | ResolvedCoverLayout
  | ResolvedTitleBodyLayout
  | ResolvedSplitLayout
  | ResolvedTwoColumnLayout
  | ResolvedMetricGridLayout
  | ResolvedFullImageLayout;

export interface ResolvedPageBackground {
  readonly color: string;
}

export interface ResolvedPage {
  readonly id: string;
  readonly type: string;
  readonly layout: ResolvedLayout;
  readonly background: ResolvedPageBackground;
  readonly elements: readonly ResolvedElement[];
}

export interface ResolvedDeck {
  readonly size: DeckSize;
  readonly theme: DeckTheme | null;
  readonly pages: readonly ResolvedPage[];
}
