import { Timestamp } from "firebase/firestore";
import { describe, expect, it } from "vitest";
import { decideWinner, sortPlayers, tally, teamAverages } from "../src/tally";
import type { AnswerDoc, ChoiceIndex, Scores, Team } from "../src/types";

const TEAMS: Team[] = [
  { id: "A", name: "Team A" },
  { id: "B", name: "Team B" },
];

const T0 = 1_000_000_000_000;
const openedAt = Timestamp.fromMillis(T0);
const WINDOW = 20_000;

function player(team: "A" | "B", score = 0, answered = 0, totalMs = 0) {
  return { nickname: "p", team, score, answered, totalMs };
}

function answer(uid: string, choice: ChoiceIndex, atOffsetMs: number): AnswerDoc {
  return { q: 0, uid, choice, at: Timestamp.fromMillis(T0 + atOffsetMs), session: "s" };
}

describe("tally", () => {
  it("counts votes and points exactly", () => {
    const scores: Scores = { u1: player("A"), u2: player("A"), u3: player("B") };
    const { reveal, scores: next } = tally(
      [answer("u1", 2, 1000), answer("u2", 0, 2000), answer("u3", 2, 3000)],
      2, openedAt, WINDOW, scores, TEAMS
    );
    expect(reveal.counts).toEqual([1, 0, 2, 0]);
    expect(next["u1"]?.score).toBe(1);
    expect(next["u2"]?.score).toBe(0);
    expect(next["u3"]?.score).toBe(1);
  });

  it("ignores answers outside the window (too late and negative)", () => {
    const scores: Scores = { u1: player("A"), u2: player("A") };
    const { reveal, scores: next } = tally(
      [answer("u1", 2, WINDOW + 1), answer("u2", 2, -5)],
      2, openedAt, WINDOW, scores, TEAMS
    );
    expect(reveal.counts).toEqual([0, 0, 0, 0]);
    expect(next["u1"]?.score).toBe(0);
    expect(next["u1"]?.answered).toBe(0);
    expect(next["u2"]?.answered).toBe(0);
  });

  it("accepts an answer right at the window limit", () => {
    const scores: Scores = { u1: player("A") };
    const { reveal } = tally([answer("u1", 1, WINDOW)], 1, openedAt, WINDOW, scores, TEAMS);
    expect(reveal.counts[1]).toBe(1);
  });

  it("ignores a player who is not registered", () => {
    const scores: Scores = { u1: player("A") };
    const { reveal, scores: next } = tally(
      [answer("fantome", 2, 1000)],
      2, openedAt, WINDOW, scores, TEAMS
    );
    expect(reveal.counts).toEqual([0, 0, 0, 0]);
    expect(next["fantome"]).toBeUndefined();
  });

  it("ignores an unknown team", () => {
    const scores: Scores = { u1: { nickname: "x", team: "Z", score: 0, answered: 0, totalMs: 0 } };
    const { reveal, scores: next } = tally(
      [answer("u1", 2, 1000)],
      2, openedAt, WINDOW, scores, TEAMS
    );
    expect(reveal.counts).toEqual([0, 0, 0, 0]);
    expect(next["u1"]?.score).toBe(0);
  });

  it("adds up totalMs", () => {
    const scores: Scores = { u1: player("A", 3, 5, 12_000) };
    const { scores: next } = tally([answer("u1", 2, 4000)], 2, openedAt, WINDOW, scores, TEAMS);
    expect(next["u1"]?.totalMs).toBe(16_000);
    expect(next["u1"]?.answered).toBe(6);
  });

  it("does not mutate the input scores", () => {
    const scores: Scores = { u1: player("A") };
    tally([answer("u1", 2, 1000)], 2, openedAt, WINDOW, scores, TEAMS);
    expect(scores["u1"]?.score).toBe(0);
  });

  it("computes team stats for the round", () => {
    const scores: Scores = { u1: player("A"), u2: player("A"), u3: player("B") };
    const { reveal } = tally(
      [answer("u1", 2, 1000), answer("u2", 1, 1000), answer("u3", 0, 1000)],
      2, openedAt, WINDOW, scores, TEAMS
    );
    expect(reveal.teams["A"]).toEqual({ avg: 0.5, roundCorrect: 1, roundAnswered: 2 });
    expect(reveal.teams["B"]).toEqual({ avg: 0, roundCorrect: 0, roundAnswered: 1 });
  });
});

describe("teamAverages", () => {
  it("empty team gives 0", () => {
    const scores: Scores = { u1: player("A", 5) };
    expect(teamAverages(scores, TEAMS)).toEqual({ A: 5, B: 0 });
  });

  it("very uneven sizes (35 vs 3): average, not sum", () => {
    const scores: Scores = {};
    for (let i = 0; i < 35; i++) scores[`a${i}`] = player("A", 2);
    for (let i = 0; i < 3; i++) scores[`b${i}`] = player("B", 10);
    const avgs = teamAverages(scores, TEAMS);
    expect(avgs["A"]).toBe(2);
    expect(avgs["B"]).toBe(10);
  });

  it("perfect tie", () => {
    const scores: Scores = { u1: player("A", 4), u2: player("B", 4) };
    const avgs = teamAverages(scores, TEAMS);
    expect(avgs["A"]).toBe(avgs["B"]);
    expect(decideWinner(avgs)).toBe("tie");
  });

  it("more than 2 teams", () => {
    const teams: Team[] = [
      { id: "A", name: "A" }, { id: "B", name: "B" }, { id: "C", name: "C" },
    ];
    const scores: Scores = {
      u1: player("A", 1),
      u2: player("B", 2),
      u3: { nickname: "c", team: "C", score: 9, answered: 0, totalMs: 0 },
    };
    const avgs = teamAverages(scores, teams);
    expect(avgs).toEqual({ A: 1, B: 2, C: 9 });
    expect(decideWinner(avgs)).toBe("C");
  });
});

describe("sortPlayers", () => {
  it("score desc, then answered desc, then totalMs asc", () => {
    const scores: Scores = {
      lent: player("A", 10, 20, 90_000),
      rapide: player("B", 10, 20, 50_000),
      absent: player("A", 10, 12, 30_000),
      faible: player("B", 3, 20, 10_000),
    };
    const uids = sortPlayers(scores).map((p) => {
      const entry = Object.entries(scores).find(([, v]) => v === undefined ? false : v.totalMs === p.totalMs && v.score === p.score && v.answered === p.answered);
      return entry?.[0];
    });
    expect(uids).toEqual(["rapide", "lent", "absent", "faible"]);
  });
});
