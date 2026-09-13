import type { Timestamp } from "firebase/firestore";
import type {
  AnswerDoc,
  ChoiceIndex,
  PlayerScore,
  Reveal,
  Scores,
  Team,
  TeamId,
  TeamRoundStat,
} from "./types";

export function tally(
  answers: AnswerDoc[],
  correct: ChoiceIndex,
  openedAt: Timestamp,
  windowMs: number, // lockedAt - openedAt
  scores: Scores,
  teams: Team[]
): { reveal: Reveal; scores: Scores } {
  const next: Scores = structuredClone(scores);
  const counts: [number, number, number, number] = [0, 0, 0, 0];
  const round: Record<TeamId, { correct: number; answered: number }> = {};
  for (const t of teams) round[t.id] = { correct: 0, answered: 0 };

  for (const a of answers) {
    const elapsed = a.at.toMillis() - openedAt.toMillis();
    if (elapsed < 0 || elapsed > windowMs) continue; // outside the answer window
    const p = next[a.uid];
    if (!p) continue; // not registered
    const r = round[p.team];
    if (!r) continue; // unknown team

    counts[a.choice]++;
    p.answered++;
    r.answered++;
    p.totalMs += elapsed;
    if (a.choice === correct) {
      p.score++;
      r.correct++;
    }
  }

  const avgs = teamAverages(next, teams);
  const teamStats: Record<TeamId, TeamRoundStat> = {};
  for (const t of teams) {
    teamStats[t.id] = {
      avg: avgs[t.id] ?? 0,
      roundCorrect: round[t.id]?.correct ?? 0,
      roundAnswered: round[t.id]?.answered ?? 0,
    };
  }
  return { reveal: { correct, counts, teams: teamStats }, scores: next };
}

// Average, not sum, or the biggest team always wins.
export function teamAverages(scores: Scores, teams: Team[]): Record<TeamId, number> {
  const out: Record<TeamId, number> = {};
  for (const t of teams) {
    const members = Object.values(scores).filter((p) => p.team === t.id);
    out[t.id] =
      members.length === 0
        ? 0
        : members.reduce((s, p) => s + p.score, 0) / members.length;
  }
  return out;
}

// Score, then answered, then totalMs. totalMs alone would reward people who skipped questions.
export function sortPlayers(scores: Scores): PlayerScore[] {
  return Object.values(scores).sort(
    (a, b) => b.score - a.score || b.answered - a.answered || a.totalMs - b.totalMs
  );
}

export function decideWinner(averages: Record<TeamId, number>): TeamId | "tie" {
  let best: TeamId | "tie" = "tie";
  let bestAvg = -Infinity;
  for (const [id, avg] of Object.entries(averages)) {
    if (avg > bestAvg) {
      bestAvg = avg;
      best = id;
    } else if (avg === bestAvg) {
      best = "tie";
    }
  }
  return best;
}
