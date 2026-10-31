import { onTestFinished } from "vitest";

export function addCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");

  document.body.append(canvas);
  onTestFinished(() => {
    canvas.remove();
  });

  return canvas;
}
