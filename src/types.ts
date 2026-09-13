import type { Timestamp } from "firebase/firestore";
import type { Lang } from "./i18n";

export type TeamId = string;
export type ChoiceIndex = 0 | 1 | 2 | 3;

export interface Team {
  id: TeamId;
  name: string;
}

// The default language is required, other languages are optional.
export type LocalizedString = Partial<Record<Lang, string>>;
export type LocalizedChoices = Partial<Record<Lang, [string, string, string, string]>>;

export interface Question {
  text: LocalizedString;
  choices: LocalizedChoices;
}

export interface LanguagesConfig {
  default: Lang;
  enabled: Lang[];
}

export interface PlayerScore {
  nickname: string;
  team: TeamId;
  score: number;
  answered: number;
  totalMs: number; // sum of answer times, breaks ties
}

export type Scores = Record<string, PlayerScore>; // keyed by uid

export interface TeamRoundStat {
  avg: number;
  roundCorrect: number;
  roundAnswered: number;
}

export interface Reveal {
  correct: ChoiceIndex;
  counts: [number, number, number, number];
  teams: Record<TeamId, TeamRoundStat>;
}

export interface GameConfig {
  teams: Team[];
  lockAfterMs: number;
  lockWhenAllAnswered: boolean;
  languages: LanguagesConfig;
}

interface GameBase {
  hostUid: string;
  // New on each seed, so nothing from a previous game leaks in.
  session: string;
  total: number;
  config: GameConfig;
  scores: Scores;
}

export type Game =
  | (GameBase & { phase: "lobby"; joinOpen: true })
  | (GameBase & {
      // Question shown, answers closed until the host starts the timer.
      phase: "reading";
      joinOpen: false;
      qIndex: number;
      question: Question;
    })
  | (GameBase & {
      phase: "question";
      joinOpen: false;
      qIndex: number;
      question: Question;
      openedAt: Timestamp;
    })
  | (GameBase & {
      phase: "locked";
      joinOpen: false;
      qIndex: number;
      question: Question;
      openedAt: Timestamp;
      lockedAt: Timestamp;
    })
  | (GameBase & {
      phase: "reveal";
      joinOpen: false;
      qIndex: number;
      question: Question;
      reveal: Reveal;
    })
  | (GameBase & {
      phase: "final";
      joinOpen: false;
      podium: PlayerScore[]; // top 5
      winner: TeamId | "tie";
      averages: Record<TeamId, number>;
      // 0 drumroll, 1 places 4-5, 2 places 2-3, 3 first place, 4 winning team.
      finalStep: number;
    });

export interface PlayerDoc {
  nickname: string;
  team: TeamId;
  session: string;
}

export interface AnswerDoc {
  q: number;
  uid: string;
  choice: ChoiceIndex;
  at: Timestamp;
  session: string;
}

// private/key, host only. Questions and answers are split so a question can go public as is.
export interface HostKey {
  session: string; // seed that wrote it, to spot a stale key
  correct: ChoiceIndex[]; // indexed by qIndex
  questions: Question[];
}

// Shape of quiz.config.ts. Don't import that file from browser code, it has the answers.
export interface QuizConfigQuestion extends Question {
  correct: ChoiceIndex;
}

export interface QuizConfig {
  teams: Team[];
  lockAfterMs: number;
  lockWhenAllAnswered: boolean;
  languages: LanguagesConfig;
  questions: QuizConfigQuestion[];
}
