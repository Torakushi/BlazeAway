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

// Team average as a share of right answers, so "0,77" reads as "13 %".
export function fmtPct(avg: number, questions: number): string {
  return `${questions > 0 ? Math.round((avg / questions) * 100) : 0}\u00a0%`;
}
