import { describe, expect, it } from "vitest";
import { CONFIG } from "../quiz.config";
import { validateConfig } from "../scripts/validate-config";
import type { QuizConfig } from "../src/types";

const base = (): QuizConfig => structuredClone(CONFIG);

describe("quiz.config.ts (the project config)", () => {
  it("is valid", () => {
    expect(validateConfig(CONFIG)).toEqual([]);
  });
});

describe("validateConfig", () => {
  it("rejects fewer than 2 teams", () => {
    const c = base();
    c.teams = c.teams.slice(0, 1);
    expect(validateConfig(c)).not.toEqual([]);
  });

  it("rejects duplicate team ids", () => {
    const c = base();
    c.teams = [
      { id: "A", name: "Un" },
      { id: "A", name: "Deux" },
    ];
    expect(validateConfig(c).join(" ")).toContain("duplicate");
  });

  it("rejects an out of range correct", () => {
    const c = base();
    const q = c.questions[0];
    if (!q) throw new Error("config vide");
    // a 4 can slip in when editing by hand
    (q as { correct: number }).correct = 4;
    expect(validateConfig(c).join(" ")).toContain("correct");
  });

  it("rejects an empty choice", () => {
    const c = base();
    const ch = c.questions[0]?.choices.fr;
    if (!ch) throw new Error("config vide");
    ch[2] = "  ";
    expect(validateConfig(c).join(" ")).toContain("4 non-empty choices");
  });

  it("rejects a question with no text in the default language", () => {
    const c = base();
    const q = c.questions[0];
    if (!q) throw new Error("config vide");
    delete q.text.fr;
    expect(validateConfig(c).join(" ")).toContain("default language");
  });

  it("rejects a default language not in enabled", () => {
    const c = base();
    c.languages = { default: "en", enabled: ["fr"] };
    expect(validateConfig(c).join(" ")).toContain("languages.default");
  });

  it("rejects an unknown language in enabled", () => {
    const c = base();
    (c.languages.enabled as string[]).push("de");
    expect(validateConfig(c).join(" ")).toContain("unknown");
  });

  it("rejects a silly timer value", () => {
    const c = base();
    c.lockAfterMs = 500;
    expect(validateConfig(c).join(" ")).toContain("lockAfterMs");
  });
});
