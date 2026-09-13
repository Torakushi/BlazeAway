import type { QuizConfig } from "./src/types";

// Your quiz: teams, timer, questions and answers.
// Keep it out of src/, it has the answers. `correct` = index of the right choice (0-3).
export const CONFIG: QuizConfig = {
  teams: [
    { id: "A", name: "Équipe A" },
    { id: "B", name: "Équipe B" },
  ],

  lockAfterMs: 20_000,

  // Lock as soon as every player has answered. false = always wait for the timer.
  lockWhenAllAnswered: true,

  // `default` is what everyone gets on load, `enabled` is what the 🌐 button offers.
  languages: { default: "fr", enabled: ["fr", "en"] },

  // Sample questions. Replace them with yours, then run the seed again.
  questions: [
    {
      // The default language is required, others are optional per question.
      text: {
        fr: "Quelle est la plus grande planète du système solaire ?",
        en: "What is the largest planet in the solar system?",
      },
      choices: {
        fr: ["Mars", "Jupiter", "Saturne", "Neptune"],
        en: ["Mars", "Jupiter", "Saturn", "Neptune"],
      },
      correct: 1,
    },
    {
      text: {
        fr: "Combien de continents compte-t-on sur Terre ?",
        en: "How many continents are there on Earth?",
      },
      choices: {
        fr: ["5", "6", "7", "8"],
        en: ["5", "6", "7", "8"],
      },
      correct: 2,
    },
    {
      text: { fr: "Quel est le symbole chimique de l'or ?" },
      choices: { fr: ["Ag", "Au", "Or", "Go"] },
      correct: 1,
    },
    {
      text: { fr: "Qui a peint la Joconde ?" },
      choices: { fr: ["Michel-Ange", "Léonard de Vinci", "Raphaël", "Botticelli"] },
      correct: 1,
    },
    {
      text: { fr: "Dans quel pays se trouve le Machu Picchu ?" },
      choices: { fr: ["Mexique", "Chili", "Pérou", "Bolivie"] },
      correct: 2,
    },
    {
      text: { fr: "Combien de joueurs une équipe de football aligne-t-elle sur le terrain ?" },
      choices: { fr: ["9", "10", "11", "12"] },
      correct: 2,
    },
  ],
};
