import type { LanguagesConfig, Question } from "../types";
import { en } from "./en";
import { fr, type Strings } from "./fr";

// New language: add src/i18n/xx.ts, register it here, enable it in quiz.config.ts.
export const LOCALES = { fr, en } satisfies Record<string, Strings>;

export type Lang = keyof typeof LOCALES;

const ALL_LANGS = Object.keys(LOCALES) as Lang[];

export function isLang(l: string): l is Lang {
  return l in LOCALES;
}

let lang: Lang = "fr";
let fallback: Lang = "fr"; // default language of the game
let enabled: Lang[] = ALL_LANGS;
let btn: HTMLButtonElement | null = null;
let notify: (() => void) | null = null;

export function currentLang(): Lang {
  return lang;
}

export function t(key: keyof Strings): string {
  return LOCALES[lang][key] ?? LOCALES[fallback][key];
}

// Falls back to the default language when a translation is missing.
export function qText(q: Question): string {
  return q.text[lang] ?? q.text[fallback] ?? "";
}

export function qChoices(q: Question): [string, string, string, string] {
  return q.choices[lang] ?? q.choices[fallback] ?? ["", "", "", ""];
}

function storedLang(): Lang | null {
  try {
    const l = localStorage.getItem("quiz:lang");
    return l !== null && isLang(l) ? l : null;
  } catch {
    return null;
  }
}

function applyLang(l: Lang, persist: boolean): void {
  lang = l;
  if (persist) {
    try {
      localStorage.setItem("quiz:lang", l);
    } catch {
      // storage blocked (private mode)
    }
  }
  refreshButton();
}

function refreshButton(): void {
  if (!btn) return;
  btn.hidden = enabled.length < 2;
  const next = enabled[(enabled.indexOf(lang) + 1) % enabled.length] ?? lang;
  btn.textContent = `🌐 ${next.toUpperCase()}`;
}

// Called on each game snapshot with the languages from the config.
export function configureLanguages(cfg: LanguagesConfig | undefined): void {
  if (!cfg) return;
  const nextEnabled = cfg.enabled.filter(isLang);
  const nextFallback = isLang(cfg.default) ? cfg.default : "fr";
  const changed =
    nextFallback !== fallback || nextEnabled.join(",") !== enabled.join(",");
  fallback = nextFallback;
  enabled = nextEnabled.length > 0 ? nextEnabled : [nextFallback];
  if (!enabled.includes(lang)) {
    // current language was disabled in the config
    const stored = storedLang();
    applyLang(stored !== null && enabled.includes(stored) ? stored : fallback, false);
  } else if (changed) {
    refreshButton();
  }
}

export function initLang(onChange: () => void): void {
  notify = onChange;
  // Default language for everyone, unless the user already picked one.
  const stored = storedLang();
  lang = stored !== null && enabled.includes(stored) ? stored : fallback;

  btn = document.createElement("button");
  btn.className = "lang-btn";
  btn.setAttribute("aria-label", "Language");
  document.body.appendChild(btn);
  refreshButton();

  btn.addEventListener("click", () => {
    const i = enabled.indexOf(lang);
    applyLang(enabled[(i + 1) % enabled.length] ?? fallback, true);
    notify?.();
  });
}
