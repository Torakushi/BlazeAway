// Load test: N fake players run a full game on the emulator, and we count reads
// and writes. npm run simulate (70 players), or N=10 npm run simulate
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  deleteField,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type DocumentReference,
  type Firestore,
} from "firebase/firestore";
import { readFileSync } from "node:fs";
import { CONFIG } from "../quiz.config";
import { decideWinner, sortPlayers, tally, teamAverages } from "../src/tally";
import type { AnswerDoc, ChoiceIndex, Game, Question, Scores } from "../src/types";
import { validateConfig } from "./validate-config";

const configErrors = validateConfig(CONFIG);
if (configErrors.length > 0) throw new Error(`quiz.config.ts is invalid: ${configErrors.join(" | ")}`);
const QUESTIONS: Question[] = CONFIG.questions.map(({ text, choices }) => ({ text, choices }));
const CORRECT: ChoiceIndex[] = CONFIG.questions.map((q) => q.correct);
const TEAMS = CONFIG.teams;
const LOCK_AFTER_MS = CONFIG.lockAfterMs;

const N = Number(process.env["N"] ?? 70);
const GAME = "game";
const rules = readFileSync("firestore.rules", "utf8");
const HOST_UID = rules.match(/request\.auth\.uid == "([^"]+)"/)?.[1] ?? "";
if (!HOST_UID) throw new Error("Host UID not found in firestore.rules");

let reads = 0;
let writes = 0;
const perQuestion: Array<{ reads: number; writes: number }> = [];
let qReads = 0;
let qWrites = 0;

function w<T>(p: Promise<T>): Promise<T> {
  writes++;
  qWrites++;
  return p;
}

function waitFor(pred: () => boolean, label: string, timeoutMs = 30_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (pred()) {
        clearInterval(iv);
        resolve();
      } else if (Date.now() - t0 > timeoutMs) {
        clearInterval(iv);
        reject(new Error(`Timeout: ${label}`));
      }
    }, 25);
  });
}

async function main(): Promise<void> {
  const env: RulesTestEnvironment = await initializeTestEnvironment({
    projectId: "demo-quiz-rules",
    firestore: { rules, host: "127.0.0.1", port: 8180 },
  });
  await env.clearFirestore();

  const SESSION = Date.now().toString(36);
  const hostDb = env.authenticatedContext(HOST_UID).firestore();
  const hostGameRef = doc(hostDb, "games", GAME) as DocumentReference;

  // Seed (not counted per question)
  await w(setDoc(doc(hostDb, "games", GAME, "private", "key"), { session: SESSION, correct: CORRECT, questions: QUESTIONS }));
  await w(
    setDoc(hostGameRef, {
      hostUid: HOST_UID,
      session: SESSION,
      phase: "lobby",
      joinOpen: true,
      total: QUESTIONS.length,
      config: { teams: TEAMS, lockAfterMs: LOCK_AFTER_MS, lockWhenAllAnswered: CONFIG.lockWhenAllAnswered, languages: CONFIG.languages },
      scores: {},
    })
  );

  // Host: key in memory, listens to the game doc
  let hostGame: Game | null = null;
  reads++; // same as the host reading private/key once
  const unsubHostGame = onSnapshot(hostGameRef, (s) => {
    reads++;
    qReads++;
    hostGame = s.exists() ? (s.data({ serverTimestamps: "estimate" }) as Game) : null;
  });

  // Players: one listener each on the game doc, they answer every question
  type Player = {
    uid: string;
    db: Firestore;
    phase: string;
    qIndex: number;
    answered: Set<number>;
    unsub: () => void;
  };
  const players: Player[] = [];
  for (let i = 0; i < N; i++) {
    const uid = `p${i}`;
    const pdb = env.authenticatedContext(uid).firestore() as unknown as Firestore;
    const p: Player = { uid, db: pdb, phase: "", qIndex: -1, answered: new Set(), unsub: () => {} };
    p.unsub = onSnapshot(doc(pdb, "games", GAME), (s) => {
      reads++;
      qReads++;
      const g = s.data() as Game | undefined;
      if (!g) return;
      p.phase = g.phase;
      if (g.phase === "question") {
        p.qIndex = g.qIndex;
        if (!p.answered.has(g.qIndex)) {
          p.answered.add(g.qIndex);
          const choice = (i % 4) as ChoiceIndex;
          const delay = Math.floor((i / N) * 1500);
          setTimeout(() => {
            void w(
              setDoc(doc(pdb, "games", GAME, "answers", `${g.session}_${g.qIndex}_${uid}`), {
                q: g.qIndex,
                uid,
                choice,
                at: serverTimestamp(),
                session: g.session,
              })
            ).catch((e: unknown) => console.error(`answer refused ${uid}:`, e));
          }, delay);
        }
      }
    });
    players.push(p);
  }

  await Promise.all(
    players.map((p, i) =>
      w(
        setDoc(doc(p.db, "games", GAME, "players", p.uid), {
          nickname: `Guest ${i}`,
          team: TEAMS[i % TEAMS.length]?.id ?? "A",
          session: SESSION,
        })
      )
    )
  );
  console.log(`${N} players registered.`);

  const regs = await getDocs(collection(hostDb, "games", GAME, "players"));
  reads += regs.size;
  const scores: Scores = {};
  for (const d of regs.docs) {
    const data = d.data() as { nickname: string; team: string };
    scores[d.id] = { nickname: data.nickname, team: data.team, score: 0, answered: 0, totalMs: 0 };
  }

  for (let qi = 0; qi < QUESTIONS.length; qi++) {
    qReads = 0;
    qWrites = 0;

    await w(
      updateDoc(hostGameRef, {
        phase: "reading",
        qIndex: qi,
        question: QUESTIONS[qi],
        joinOpen: false,
        reveal: deleteField(),
        ...(qi === 0 ? { scores } : {}),
      })
    );
    // host reads the question, then starts the timer
    await new Promise((r) => setTimeout(r, 150));
    await w(updateDoc(hostGameRef, { phase: "question", openedAt: serverTimestamp() }));

    let live = 0;
    const unsubAnswers = onSnapshot(
      query(
        collection(hostDb, "games", GAME, "answers"),
        where("q", "==", qi),
        where("session", "==", SESSION)
      ),
      (s) => {
        qReads += s.docChanges().length;
        reads += s.docChanges().length;
        live = s.size;
      }
    );
    await waitFor(() => live === N, `all answers for question ${qi}`);
    unsubAnswers();

    await w(updateDoc(hostGameRef, { phase: "locked", lockedAt: serverTimestamp() }));
    await waitFor(() => {
      const cur = hostGame as Game | null;
      return cur?.phase === "locked" && cur.lockedAt != null && cur.openedAt != null;
    }, "lockedAt resolved");

    // TS does not see assignments made in the onSnapshot callback.
    const g = hostGame as Game | null;
    if (g?.phase !== "locked") throw new Error("unexpected state");

    // Tally from a fresh read, like the host page
    const snap = await getDocs(
      query(
        collection(hostDb, "games", GAME, "answers"),
        where("q", "==", qi),
        where("session", "==", SESSION)
      )
    );
    reads += snap.size;
    qReads += snap.size;
    const answers = snap.docs.map((d) => d.data() as AnswerDoc);
    const correct = CORRECT[qi];
    if (correct === undefined) throw new Error("missing answer key");
    const windowMs = g.lockedAt.toMillis() - g.openedAt.toMillis();
    const result = tally(answers, correct, g.openedAt, windowMs, g.scores, g.config.teams);

    await w(
      updateDoc(hostGameRef, {
        phase: "reveal",
        reveal: result.reveal,
        scores: result.scores,
        openedAt: deleteField(),
        lockedAt: deleteField(),
      })
    );
    await waitFor(() => players.every((p) => p.phase === "reveal"), `reveal received q${qi}`);

    const validCount = Object.values(result.reveal.teams).reduce(
      (s, t) => s + t.roundAnswered,
      0
    );
    if (validCount !== N) {
      throw new Error(`Question ${qi}: ${validCount}/${N} valid answers in the tally`);
    }
    perQuestion.push({ reads: qReads, writes: qWrites });
    console.log(`Q${qi + 1}: ${validCount}/${N} valid answers, ${qReads} reads, ${qWrites} writes`);
  }

  const g = hostGame as Game | null;
  if (g?.phase !== "reveal") throw new Error("unexpected state before final");
  const averages = teamAverages(g.scores, g.config.teams);
  await w(
    updateDoc(hostGameRef, {
      phase: "final",
      finalStep: 4, // skip the staged reveal
      podium: sortPlayers(g.scores).slice(0, 5),
      winner: decideWinner(averages),
      averages,
      qIndex: deleteField(),
      question: deleteField(),
      reveal: deleteField(),
    })
  );
  await waitFor(() => players.every((p) => p.phase === "final"), "final received");

  const gf = hostGame as Game | null;
  if (gf?.phase === "final") {
    console.log(`\nWinner: ${gf.winner}, averages:`, gf.averages);
    console.log(`Podium : ${gf.podium.map((p) => `${p.nickname} (${p.score})`).join(", ")}`);
  }

  for (const p of players) p.unsub();
  unsubHostGame();

  const avgReads = Math.round(perQuestion.reduce((s, q) => s + q.reads, 0) / perQuestion.length);
  const avgWrites = Math.round(perQuestion.reduce((s, q) => s + q.writes, 0) / perQuestion.length);
  console.log(`\n=== Summary N=${N}, ${QUESTIONS.length} questions ===`);
  console.log(`Total: ${reads} reads, ${writes} writes`);
  console.log(`Per question: ~${avgReads} reads, ~${avgWrites} writes`);
  console.log(
    `For 30 questions: ~${avgReads * 30 + N * 2} reads, ~${avgWrites * 30 + N + 2} writes ` +
      `(Spark quota: 50000 reads / 20000 writes per day)`
  );

  await env.cleanup();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
