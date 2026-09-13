// Non-breaking space before French punctuation, so "?" never starts a line.
export function frenchPunct(s: string): string {
  return s.replace(/ ([?!:;»])/g, "\u00a0$1");
}

export function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function el<T extends HTMLElement = HTMLElement>(sel: string): T {
  const node = document.querySelector<T>(sel);
  if (!node) throw new Error(`Element not found: ${sel}`);
  return node;
}

export const app = (): HTMLElement => el("#app");

// One shape per choice, color alone doesn't work for color-blind people.
export const SHAPES = ["●", "■", "▲", "◆"] as const;
export const SHAPE_NAMES = ["circle", "square", "triangle", "diamond"] as const;

export function fmtAvg(n: number): string {
  return (Math.round(n * 100) / 100).toLocaleString("fr-FR");
}
