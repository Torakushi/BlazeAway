// Writes the game doc and private/key from quiz.config.ts.
// HOST_EMAIL=... HOST_PASSWORD=... npm run seed (npm run seed:dev for the emulator)
import { initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  signInWithCustomToken,
  signInWithEmailAndPassword,
  type UserCredential,
} from "firebase/auth";
import { connectFirestoreEmulator, doc, getDoc, getFirestore, setDoc } from "firebase/firestore";
import { CONFIG } from "../quiz.config";
import { devHostToken } from "../src/dev-token";
import { firebaseConfig, GAME_ID } from "../src/firebase-config";
import type { HostKey, Question } from "../src/types";
import { validateConfig } from "./validate-config";

const errors = validateConfig(CONFIG);
if (errors.length > 0) {
  console.error("quiz.config.ts is invalid:");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const onEmulator = process.env["EMULATOR"] === "1";

if (onEmulator) {
  connectAuthEmulator(auth, "http://localhost:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "localhost", 8180);
}

async function signIn(): Promise<UserCredential> {
  // Emulator: fixed host UID through an unsigned token, see dev-token.ts.
  if (onEmulator) return signInWithCustomToken(auth, devHostToken());
  const email = process.env["HOST_EMAIL"];
  const password = process.env["HOST_PASSWORD"];
  if (!email || !password) {
    console.error("HOST_EMAIL and HOST_PASSWORD are required in production.");
    process.exit(1);
  }
  return signInWithEmailAndPassword(auth, email, password);
}

async function main(): Promise<void> {
  const uid = (await signIn()).user.uid;

  // A seed during a game would erase the scores.
  const existing = await getDoc(doc(db, "games", GAME_ID));
  const phase = existing.exists() ? (existing.data() as { phase?: string }).phase : undefined;
  if (phase !== undefined && phase !== "lobby" && phase !== "final" && process.env["FORCE"] !== "1") {
    console.error(
      `A game is in progress (phase "${phase}"). Seed refused.\n` +
        `To overwrite anyway: FORCE=1 npm run seed`
    );
    process.exit(1);
  }

  // New id on each seed, so nothing from a previous game leaks in.
  const session = Date.now().toString(36);

  // Questions and answers stay apart so a question can go public as is.
  const questions: Question[] = CONFIG.questions.map(({ text, choices }) => ({ text, choices }));
  const key: HostKey = { session, correct: CONFIG.questions.map((q) => q.correct), questions };

  await setDoc(doc(db, "games", GAME_ID, "private", "key"), key);
  await setDoc(doc(db, "games", GAME_ID), {
    hostUid: uid,
    session,
    phase: "lobby",
    joinOpen: true,
    total: CONFIG.questions.length,
    config: {
      teams: CONFIG.teams,
      lockAfterMs: CONFIG.lockAfterMs,
      lockWhenAllAnswered: CONFIG.lockWhenAllAnswered,
      languages: CONFIG.languages,
    },
    scores: {},
  });

  console.log(
    `Seed OK: ${CONFIG.questions.length} questions, ${CONFIG.teams.length} teams, ${CONFIG.lockAfterMs / 1000} s per question.`
  );
  console.log(`Session: ${session}`);
  console.log(`Host UID: ${uid}`);
  console.log(`Make sure firestore.rules has this UID in isHost, then deploy the rules.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
