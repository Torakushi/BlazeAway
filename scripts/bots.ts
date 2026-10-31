// Fake guests for a real rehearsal. They sign in as anonymous users, register
// in the lobby and answer every question. You run the host screen yourself.
//
//   npm run bots            70 bots on the real project
//   N=20 npm run bots       fewer bots
//   SPREAD=15000 SKIP=0 npm run bots   slower answers, nobody skips
//   npm run bots:dev        same, on the emulator
//
// Stop with Ctrl-C. Bots stay until the game reaches "final". If you seed
// again while they run, they register again for the new session.
import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInAnonymously } from "firebase/auth";
import {
  connectFirestoreEmulator,
  doc,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  setDoc,
  type Firestore,
} from "firebase/firestore";
import { firebaseConfig, GAME_ID } from "../src/firebase-config";
import type { ChoiceIndex, Game } from "../src/types";

const N = Number(process.env["N"] ?? 70);
const SKIP_RATE = Number(process.env["SKIP"] ?? 0.1); // share of bots that don't answer a question
const SPREAD_MS = Number(process.env["SPREAD"] ?? 5000); // answers land between 0.5 s and this
const SIGN_IN_GAP_MS = 60; // stay under the Auth sign-up rate limit
const onEmulator = process.env["EMULATOR"] === "1";

interface Bot {
  i: number;
  uid: string;
  db: Firestore;
  session: string | null;
  answered: Set<number>;
}

const bots: Bot[] = [];
let registeredFor: string | null = null;
const answersPerQ = new Map<number, number>();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function makeBot(i: number): Promise<Bot> {
  // One app per bot, so each one has its own auth user.
  const app = initializeApp(firebaseConfig, `bot-${i}`);
  const auth = getAuth(app);
  const db = getFirestore(app);
  if (onEmulator) {
    connectAuthEmulator(auth, "http://localhost:9099", { disableWarnings: true });
    connectFirestoreEmulator(db, "localhost", 8180);
  }
  const cred = await signInAnonymously(auth);
  return { i, uid: cred.user.uid, db, session: null, answered: new Set() };
}

async function registerAll(g: Game): Promise<void> {
  const teams = g.config.teams;
  let ok = 0;
  await Promise.all(
    bots.map(async (b) => {
      const team = teams[b.i % teams.length];
      if (!team) return;
      try {
        await setDoc(doc(b.db, "games", GAME_ID, "players", b.uid), {
          nickname: `Guest ${b.i + 1}`,
          team: team.id,
          session: g.session,
        });
        b.session = g.session;
        b.answered.clear();
        ok++;
      } catch (e) {
        console.error(`bot ${b.i + 1}: registration refused`, e);
      }
    })
  );
  console.log(`${ok}/${bots.length} bots registered for session ${g.session}.`);
}

function answer(b: Bot, g: Game & { phase: "question" }): void {
  if (b.answered.has(g.qIndex)) return;
  b.answered.add(g.qIndex);
  if (Math.random() < SKIP_RATE) return;

  const delay = 500 + Math.random() * Math.min(SPREAD_MS, g.config.lockAfterMs * 0.8);
  const choice = Math.floor(Math.random() * 4) as ChoiceIndex;
  setTimeout(() => {
    setDoc(doc(b.db, "games", GAME_ID, "answers", `${g.session}_${g.qIndex}_${b.uid}`), {
      q: g.qIndex,
      uid: b.uid,
      choice,
      at: serverTimestamp(),
      session: g.session,
    })
      .then(() => {
        const n = (answersPerQ.get(g.qIndex) ?? 0) + 1;
        answersPerQ.set(g.qIndex, n);
        if (n % 10 === 0 || n === bots.length) console.log(`Q${g.qIndex + 1}: ${n} answers sent`);
      })
      .catch((e: unknown) => {
        // Too late (locked) is normal, anything else is a bug.
        const code = (e as { code?: string }).code ?? "";
        if (code !== "permission-denied") console.error(`bot ${b.i + 1}: answer failed`, e);
      });
  }, delay);
}

function onGame(g: Game | null): void {
  if (!g) {
    console.log("No game document. Run the seed first.");
    return;
  }
  if (g.session !== registeredFor) {
    registeredFor = g.session;
    console.log(`Game found: phase "${g.phase}", ${g.total} questions, ${g.config.teams.length} teams.`);
    if (g.phase !== "lobby") {
      console.log(`Phase is "${g.phase}", not "lobby". Seed again if you want a fresh game.`);
    }
    void registerAll(g);
    return;
  }
  if (g.phase === "question") {
    for (const b of bots) if (b.session === g.session) answer(b, g);
  }
  if (g.phase === "final") {
    console.log("Game over. Bye.");
    setTimeout(() => process.exit(0), 1000);
  }
}

async function main(): Promise<void> {
  console.log(`Starting ${N} bots on ${onEmulator ? "the emulator" : firebaseConfig.projectId}...`);
  for (let i = 0; i < N; i++) {
    try {
      bots.push(await makeBot(i));
    } catch (e) {
      console.error(`bot ${i + 1}: sign-in failed`, e);
    }
    await sleep(SIGN_IN_GAP_MS);
  }
  const first = bots[0];
  if (!first) throw new Error("No bot could sign in.");
  console.log(`${bots.length} bots signed in.`);

  // The first bot drives everyone. The others still listen, like real phones
  // would, so the read load is realistic.
  for (const b of bots) {
    onSnapshot(doc(b.db, "games", GAME_ID), (snap) => {
      if (b === first) onGame(snap.exists() ? (snap.data() as Game) : null);
    });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
