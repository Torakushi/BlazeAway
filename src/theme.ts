// Follows the system theme until the user picks one.
type Theme = "dark" | "light";

function storedTheme(): Theme | null {
  try {
    const t = localStorage.getItem("quiz:theme");
    return t === "light" || t === "dark" ? t : null;
  } catch {
    return null;
  }
}

export function initTheme(): void {
  const btn = document.createElement("button");
  btn.className = "theme-toggle";
  btn.setAttribute("aria-label", "Toggle theme");
  document.body.appendChild(btn);

  const apply = (t: Theme, persist: boolean): void => {
    document.documentElement.dataset["theme"] = t;
    btn.textContent = t === "dark" ? "☀️" : "🌙";
    if (persist) {
      try {
        localStorage.setItem("quiz:theme", t);
      } catch {
        // storage blocked (private mode)
      }
    }
  };

  const system = matchMedia("(prefers-color-scheme: light)");
  apply(storedTheme() ?? (system.matches ? "light" : "dark"), false);

  system.addEventListener?.("change", (e) => {
    if (storedTheme() === null) apply(e.matches ? "light" : "dark", false);
  });

  btn.addEventListener("click", () => {
    apply(document.documentElement.dataset["theme"] === "light" ? "dark" : "light", true);
  });
}

// All CSS uses rem, so changing the root size scales everything.
const FONT_SCALES = [1, 1.15, 1.3, 1.45] as const;

function storedFontStep(): number {
  try {
    const n = Number(localStorage.getItem("quiz:fontstep"));
    return Number.isInteger(n) && n >= 0 && n < FONT_SCALES.length ? n : 0;
  } catch {
    return 0;
  }
}

export function initFontSize(): void {
  let step = storedFontStep();
  const wrap = document.createElement("div");
  wrap.className = "font-controls";
  const minus = document.createElement("button");
  minus.className = "font-btn";
  minus.textContent = "A−";
  minus.setAttribute("aria-label", "Smaller text");
  const plus = document.createElement("button");
  plus.className = "font-btn";
  plus.textContent = "A+";
  plus.setAttribute("aria-label", "Bigger text");
  wrap.append(minus, plus);
  document.body.appendChild(wrap);

  const apply = (): void => {
    document.documentElement.style.fontSize = `${(FONT_SCALES[step] ?? 1) * 100}%`;
    minus.disabled = step === 0;
    plus.disabled = step === FONT_SCALES.length - 1;
    try {
      localStorage.setItem("quiz:fontstep", String(step));
    } catch {
      // storage blocked (private mode)
    }
  };
  apply();

  minus.addEventListener("click", () => {
    if (step > 0) {
      step--;
      apply();
    }
  });
  plus.addEventListener("click", () => {
    if (step < FONT_SCALES.length - 1) {
      step++;
      apply();
    }
  });
}
