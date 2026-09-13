import { isLang, LOCALES } from "../src/i18n";
import type { QuizConfig } from "../src/types";

// Checks quiz.config.ts. Run by the seed and by npm test.
export function validateConfig(c: QuizConfig): string[] {
  const errors: string[] = [];

  if (c.teams.length < 2) errors.push("Need at least 2 teams.");
  if (c.teams.length > 6)
    errors.push("At most 6 teams (the UI has 6 team colors).");
  const ids = new Set<string>();
  c.teams.forEach((t, i) => {
    if (!t.id.trim() || t.id !== t.id.trim() || t.id.length > 20)
      errors.push(`Team ${i + 1}: id is empty, has spaces around it, or is longer than 20 characters.`);
    if (!t.name.trim() || t.name.length > 40)
      errors.push(`Team ${i + 1}: name is empty or longer than 40 characters.`);
    if (ids.has(t.id)) errors.push(`Team ${i + 1}: duplicate id "${t.id}".`);
    ids.add(t.id);
  });

  if (!Number.isInteger(c.lockAfterMs) || c.lockAfterMs < 5_000 || c.lockAfterMs > 120_000)
    errors.push("lockAfterMs must be an integer between 5000 and 120000 ms.");
  if (typeof c.lockWhenAllAnswered !== "boolean")
    errors.push("lockWhenAllAnswered must be true or false.");

  const known = Object.keys(LOCALES).join(", ");
  const def = c.languages.default;
  if (!isLang(def)) errors.push(`languages.default "${def}" is unknown (available: ${known}).`);
  if (c.languages.enabled.length === 0) errors.push("languages.enabled is empty.");
  for (const l of c.languages.enabled)
    if (!isLang(l)) errors.push(`languages.enabled has "${l}", which is unknown (available: ${known}).`);
  if (!c.languages.enabled.includes(def))
    errors.push("languages.default must be in languages.enabled.");

  if (c.questions.length === 0) errors.push("No questions.");
  c.questions.forEach((q, i) => {
    const n = i + 1;
    const defText = q.text[def];
    if (defText === undefined || !defText.trim())
      errors.push(`Question ${n}: text missing in the default language (${def}).`);
    if (q.choices[def] === undefined)
      errors.push(`Question ${n}: choices missing in the default language (${def}).`);

    for (const [l, txt] of Object.entries(q.text)) {
      if (!isLang(l)) errors.push(`Question ${n}: unknown text language "${l}".`);
      if (txt !== undefined && (!txt.trim() || txt.length > 200))
        errors.push(`Question ${n} (${l}): text is empty or too long (max 200 characters).`);
    }
    for (const [l, ch] of Object.entries(q.choices)) {
      if (!isLang(l)) errors.push(`Question ${n}: unknown choices language "${l}".`);
      const choices = (ch ?? []) as readonly string[];
      if (choices.length !== 4 || choices.some((s) => !s.trim() || s.length > 100))
        errors.push(`Question ${n} (${l}): needs exactly 4 non-empty choices, 100 characters max.`);
    }
    if (!Number.isInteger(q.correct) || q.correct < 0 || q.correct > 3)
      errors.push(`Question ${n}: correct must be 0, 1, 2 or 3.`);
  });

  return errors;
}
