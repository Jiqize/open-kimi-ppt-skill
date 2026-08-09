import type {
  ResolvedElement,
  ResolvedImageElement,
  ResolvedLineElement,
  ResolvedShapeElement,
  ResolvedTextElement,
} from "./types.js";

export interface ResolvedElementRenderer<TResult> {
  renderText(element: ResolvedTextElement): TResult;
  renderImage(element: ResolvedImageElement): TResult;
  renderShape(element: ResolvedShapeElement): TResult;
  renderLine(element: ResolvedLineElement): TResult;
}

export function dispatchResolvedElement<TResult>(
  element: ResolvedElement,
  renderer: ResolvedElementRenderer<TResult>,
): TResult {
  switch (element.type) {
    case "text":
      return renderer.renderText(element);
    case "image":
      return renderer.renderImage(element);
    case "shape":
      return renderer.renderShape(element);
    case "line":
      return renderer.renderLine(element);
  }
}

