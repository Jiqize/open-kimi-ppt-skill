import type {
  DeckElement,
  DeckSize,
  DeckTheme,
} from "@deck-agent/deck-schema";

export interface ResolvedBounds {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface ResolvedElementStyle {
  readonly color?: string;
  readonly fill?: string;
  readonly stroke?: string;
  readonly strokeWidth?: number;
  readonly dash?: "solid" | "dash" | "dot";
  readonly fontFamily?: string;
  readonly fontWeight?: number;
  readonly fontStyle?: "normal" | "italic";
}

export interface ResolvedElement extends ResolvedBounds {
  readonly id: string;
  readonly type: DeckElement["type"];
  readonly content: Readonly<Record<string, unknown>>;
  readonly style: ResolvedElementStyle;
}

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
  }>;
}

export type ResolvedLayout = ResolvedFreeLayout | ResolvedSplitLayout;

export interface ResolvedPageBackground {
  readonly color: string;
}

export interface ResolvedPage {
  readonly id: string;
  readonly type: string;
  readonly layout: ResolvedLayout;
  readonly background?: ResolvedPageBackground;
  readonly elements: readonly ResolvedElement[];
}

export interface ResolvedDeck {
  readonly size: DeckSize;
  readonly theme: DeckTheme | null;
  readonly pages: readonly ResolvedPage[];
}

