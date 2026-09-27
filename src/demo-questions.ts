import type { QuizConfigQuestion } from "./types";

// Public, they ship in the page code. Never put real quiz questions here.
export const DEMO_QUESTIONS: QuizConfigQuestion[] = [
  {
    text: { fr: "Combien de pattes a une araignée ?", en: "How many legs does a spider have?" },
    choices: { fr: ["6", "8", "10", "12"], en: ["6", "8", "10", "12"] },
    correct: 1,
  },
  {
    text: { fr: "Quelle est la capitale de l'Australie ?", en: "What is the capital of Australia?" },
    choices: {
      fr: ["Sydney", "Melbourne", "Canberra", "Perth"],
      en: ["Sydney", "Melbourne", "Canberra", "Perth"],
    },
    correct: 2,
  },
  {
    text: {
      fr: "En quelle année a-t-on marché sur la Lune pour la première fois ?",
      en: "In which year did people first walk on the Moon?",
    },
    choices: { fr: ["1965", "1969", "1972", "1975"], en: ["1965", "1969", "1972", "1975"] },
    correct: 1,
  },
  {
    text: {
      fr: "Parmi ces animaux, lequel est capable de courir le plus vite sur une courte distance, au point de dépasser largement la vitesse autorisée en ville pour une voiture ?",
      en: "Among these animals, which one can run the fastest over a short distance, to the point of going far beyond the speed limit for a car in town?",
    },
    choices: {
      fr: ["Le guépard, champion du sprint", "Le lion de la savane", "Le cheval de course", "Le lévrier anglais"],
      en: ["The cheetah, sprint champion", "The savanna lion", "The racehorse", "The English greyhound"],
    },
    correct: 0,
  },
];
