import type { Timestamp } from "firebase/firestore";
import { DEMO_QUESTIONS } from "./demo-questions";
import { initLang, t } from "./i18n";
import { initPlayerLayout, renderPlayer, type StoredAnswer } from "./player-view";
import { decideWinner, sortPlayers, teamAverages } from "./tally";
import { initFontSize, initTheme } from "./theme";
import type { ChoiceIndex, Game, LanguagesConfig, Reveal, Scores, Team, TeamRoundStat } from "./types";

// Practice game, no Firebase, no host. Screens come from player-view.ts, we only fake the game.

const UID = "me";
const LOBBY_MS = 2500;
const READING_MS = 3000;
const ANSWER_MS = 12000;
const SEND_MS = 400; // fake network delay
const ALL_ANSWERED_MS = 1500;
const LOCKED_MS = 2000;
const REVEAL_MS = 5000;
const SUSPENSE_MS = 4000;
const BOTS_PER_TEAM = 6;
const BOT_SKILL = 0.55; // chance a bot finds the right answer
const LANGUAGES: LanguagesConfig = { default: "fr", enabled: ["fr", "en"] };

// The player view never reads timestamps.
const NOW = { toMillis: () => Date.now() } as unknown as Timestamp;

type Phase = Game["phase"];

let registered = false;
let phase: Phase = "lobby";
let qIndex = 0;
let finalStep = 0;
let scores: Scores = {};
let reveal: Reveal | null = null;
let answers = new Map<number, StoredAnswer>();
let deadline = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

const endBar = document.createElement("div");
endBar.className = "demo-bar";
endBar.hidden = true;
document.body.appendChild(endBar);

initTheme();
initFontSize();
initPlayerLayout();
initLang(render);
render();

function teams(): Team[] {
  return [
    { id: "A", name: t("demoTeamA") },
    { id: "B", name: t("demoTeamB") },
  ];
}

function question() {
  const q = DEMO_QUESTIONS[qIndex];
  if (!q) throw new Error(`Demo question ${qIndex} not found`);
  return q;
}

// Same shape as the game doc Firestore sends to phones.
function currentGame(): Game {
  const base = {
    hostUid: "demo",
    session: "demo",
    total: DEMO_QUESTIONS.length,
    config: { teams: teams(), lockAfterMs: ANSWER_MS, lockWhenAllAnswered: true, languages: LANGUAGES },
    scores,
  };
  const q = { text: question().text, choices: question().choices };
  switch (phase) {
    case "lobby":
      return { ...base, phase, joinOpen: true };
    case "reading":
      return { ...base, phase, joinOpen: false, qIndex, question: q };
    case "question":
      return { ...base, phase, joinOpen: false, qIndex, question: q, openedAt: NOW };
    case "locked":
      return { ...base, phase, joinOpen: false, qIndex, question: q, openedAt: NOW, lockedAt: NOW };
    case "reveal":
      return { ...base, phase, joinOpen: false, qIndex, question: q, reveal: reveal ?? emptyReveal() };
    case "final": {
      const averages = teamAverages(scores, teams());
      return {
        ...base,
        phase,
        joinOpen: false,
        podium: sortPlayers(scores).slice(0, 5),
        winner: decideWinner(averages),
        averages,
        finalStep,
      };
    }
  }
}

function render(): void {
  const g = currentGame();
  renderPlayer({
    game: g,
    uid: UID,
    registered,
    answer: "qIndex" in g ? (answers.get(g.qIndex) ?? null) : null,
    deadline: phase === "question" ? deadline : null,
    register,
    submit,
    editRegistration,
  });
}


function register(nickname: string, team: string): Promise<void> {
  scores = { [UID]: { nickname, team, score: 0, answered: 0, totalMs: 0 } };
  for (const tm of ["A", "B"]) {
    for (let i = 1; i <= BOTS_PER_TEAM; i++) {
      scores[`bot-${tm}-${i}`] = { nickname: `Bot ${i}`, team: tm, score: 0, answered: 0, totalMs: 0 };
    }
  }
  answers = new Map();
  registered = true;
  endBar.hidden = true;
  setPhase("lobby");
  later(() => openQuestion(0), LOBBY_MS);
  return Promise.resolve();
}

function editRegistration(): void {
  stop();
  registered = false;
  render();
}

function submit(choice: ChoiceIndex): void {
  if (phase !== "question" || answers.has(qIndex)) return;
  const q = qIndex;
  answers.set(q, { uid: UID, choice, state: "sent" });
  render();
  setTimeout(() => {
    answers.set(q, { uid: UID, choice, state: "confirmed" });
    if (qIndex === q) render();
  }, SEND_MS);
  // The tester is the only real player, so everyone has answered.
  later(lock, ALL_ANSWERED_MS);
}

// Fake host

function openQuestion(i: number): void {
  qIndex = i;
  setPhase("reading");
  later(() => {
    deadline = Date.now() + ANSWER_MS;
    setPhase("question");
    later(lock, ANSWER_MS);
  }, READING_MS);
}

function lock(): void {
  setPhase("locked");
  later(showReveal, LOCKED_MS);
}

function showReveal(): void {
  reveal = scoreRound();
  setPhase("reveal");
  later(next, REVEAL_MS);
}

function next(): void {
  if (qIndex + 1 < DEMO_QUESTIONS.length) {
    openQuestion(qIndex + 1);
    return;
  }
  finalStep = 0;
  setPhase("final");
  later(() => {
    finalStep = 4;
    render();
    showEndBar();
  }, SUSPENSE_MS);
}

function scoreRound(): Reveal {
  const correct = question().correct;
  const counts: [number, number, number, number] = [0, 0, 0, 0];
  const round: Record<string, { correct: number; answered: number }> = {
    A: { correct: 0, answered: 0 },
    B: { correct: 0, answered: 0 },
  };
  for (const [id, p] of Object.entries(scores)) {
    const choice = id === UID ? (answers.get(qIndex)?.choice ?? null) : botChoice(correct);
    const r = round[p.team];
    if (choice === null || !r) continue;
    counts[choice]++;
    p.answered++;
    r.answered++;
    if (choice === correct) {
      p.score++;
      r.correct++;
    }
  }
  const avgs = teamAverages(scores, teams());
  const stats: Record<string, TeamRoundStat> = {};
  for (const tm of teams()) {
    stats[tm.id] = {
      avg: avgs[tm.id] ?? 0,
      roundCorrect: round[tm.id]?.correct ?? 0,
      roundAnswered: round[tm.id]?.answered ?? 0,
    };
  }
  return { correct, counts, teams: stats };
}

function emptyReveal(): Reveal {
  return { correct: question().correct, counts: [0, 0, 0, 0], teams: {} };
}

function botChoice(correct: ChoiceIndex): ChoiceIndex {
  if (Math.random() < BOT_SKILL) return correct;
  const wrong = ([0, 1, 2, 3] as ChoiceIndex[]).filter((c) => c !== correct);
  return wrong[Math.floor(Math.random() * wrong.length)] ?? correct;
}

function showEndBar(): void {
  endBar.innerHTML = `<span>${t("demoEnd")}</span> <button class="btn btn-primary" id="replay">${t("demoReplay")}</button>`;
  endBar.hidden = false;
  document.querySelector("#replay")?.addEventListener("click", () => {
    const me = scores[UID];
    if (me) void register(me.nickname, me.team);
  });
}

function setPhase(p: Phase): void {
  phase = p;
  render();
}

function later(fn: () => void, ms: number): void {
  stop();
  timer = setTimeout(fn, ms);
}

function stop(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
}
