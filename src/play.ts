import { onAuthStateChanged, signInAnonymously } from "firebase/auth";
import {
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  type FirestoreError,
} from "firebase/firestore";
import { auth, db, GAME_ID } from "./firebase";
import { configureLanguages, initLang, t } from "./i18n";
import { initPlayerLayout, renderMessage, renderPlayer, type StoredAnswer } from "./player-view";
import { initFontSize, initTheme } from "./theme";
import type { ChoiceIndex, Game, PlayerDoc } from "./types";

const gameRef = doc(db, "games", GAME_ID);

initTheme();
initFontSize();
initPlayerLayout();
initLang(() => {
  render();
  refreshConn();
});

// Connection badge, helps spot a frozen phone.
const conn = document.createElement("div");
conn.id = "conn";
document.querySelector(".top-right")?.prepend(conn);
let connState: "ok" | "cache" | "off" = "off";
let connKey: "online" | "reconnecting" | "lost" | "offline" | "connecting" = "connecting";
function setConn(state: typeof connState, key: typeof connKey): void {
  connState = state;
  connKey = key;
  refreshConn();
}
function refreshConn(): void {
  conn.className = `conn conn-${connState}`;
  conn.textContent =
    connKey === "connecting" ? t("connecting")
    : connKey === "online" ? t("online")
    : connKey === "reconnecting" ? t("reconnecting")
    : connKey === "lost" ? t("lost")
    : t("offline");
}
setConn("off", "connecting");
addEventListener("offline", () => setConn("off", "offline"));

// Players only listen to the game doc. Never players/ or answers/.
let game: Game | null = null;
let gameExists = false;
let uid: string | null = null;

// Keys include the session, so a new seed hides the previous game.
const KFor = (sess: string, s: string): string => `quiz:${GAME_ID}:${sess}:${s}`;
const K = (s: string): string => KFor(game?.session ?? "?", s);

// localStorage can be blocked (private mode), memory keeps this session working.
const memAnswers = new Map<number, StoredAnswer>();
let memRegistered = false;

function storedAnswer(qIndex: number): StoredAnswer | null {
  const m = memAnswers.get(qIndex);
  if (m && m.uid === uid) return m;
  try {
    const raw = localStorage.getItem(K(`answer:${qIndex}`));
    if (!raw) return null;
    const a = JSON.parse(raw) as StoredAnswer;
    return a.uid === uid ? a : null; // another anonymous session
  } catch {
    return null;
  }
}

function saveAnswer(qIndex: number, a: StoredAnswer): void {
  memAnswers.set(qIndex, a);
  try {
    localStorage.setItem(K(`answer:${qIndex}`), JSON.stringify(a));
  } catch {
    // blocked: memory is enough for this session
  }
}

function markRegistered(u: string): void {
  memRegistered = true;
  try {
    localStorage.setItem(K("registered"), u);
  } catch {
    // blocked
  }
}

function isRegistered(): boolean {
  if (uid && game && game.scores[uid]) return true;
  if (memRegistered) return true;
  try {
    return localStorage.getItem(K("registered")) === uid;
  } catch {
    return false;
  }
}

renderMessage(t("connecting"));

onAuthStateChanged(auth, (user) => {
  if (!user) {
    signInAnonymously(auth).catch(() => renderMessage(t("connectFail")));
    return;
  }
  uid = user.uid;
  subscribeGame();
});

let currentSession: string | null = null;

function subscribeGame(): void {
  onSnapshot(
    gameRef,
    { includeMetadataChanges: true },
    (snap) => {
      setConn(
        snap.metadata.fromCache ? "cache" : "ok",
        snap.metadata.fromCache ? "reconnecting" : "online"
      );
      gameExists = snap.exists();
      game = gameExists ? (snap.data() as Game) : null;
      configureLanguages(game?.config.languages);
      if (game && game.session !== currentSession) {
        // new seed: forget the previous game
        currentSession = game.session;
        memAnswers.clear();
        memRegistered = false;
      }
      render();
    },
    () => setConn("off", "lost")
  );
}

async function register(nickname: string, team: string): Promise<void> {
  const u = uid;
  const g = game;
  if (!u || !g) return;
  // Overwrites an entry from a previous game (the owner may update it).
  await setDoc(doc(db, "games", GAME_ID, "players", u), {
    nickname,
    team,
    session: g.session,
  } satisfies PlayerDoc);
  markRegistered(u);
  render();
}

function submit(choice: ChoiceIndex): void {
  const g = game;
  const u = uid;
  if (g?.phase !== "question" || !u) return;
  const qIndex = g.qIndex;

  // Optimistic "Sending..." right away, confirmed when the write resolves.
  saveAnswer(qIndex, { uid: u, choice, state: "sent" });
  render();

  setDoc(doc(db, "games", GAME_ID, "answers", `${g.session}_${qIndex}_${u}`), {
    q: qIndex,
    uid: u,
    choice,
    at: serverTimestamp(),
    session: g.session,
  })
    .then(() => {
      if (game?.session !== g.session) return; // seeded again meanwhile
      saveAnswer(qIndex, { uid: u, choice, state: "confirmed" });
      render();
    })
    .catch((e: FirestoreError) => {
      if (game?.session !== g.session) return;
      // create-only rule: an existing doc (other tab) gives permission-denied
      const already = e.code === "permission-denied";
      saveAnswer(qIndex, { uid: u, choice, state: already ? "confirmed" : "failed" });
      render();
    });
}

function editRegistration(): void {
  memRegistered = false;
  try {
    localStorage.removeItem(K("registered"));
  } catch {
    // blocked: the memory flag is enough
  }
  render();
}

// Timer end, set once per question. Trust the server open time if the phone clock
// looks sane (survives a reload), else count from when we got it. Display only.
let deadlineQ: string | null = null;
let deadline = 0;

function questionDeadline(g: Game): number | null {
  if (g.phase !== "question") return null;
  const key = `${g.session}:${g.qIndex}`;
  if (deadlineQ !== key) {
    const lock = g.config.lockAfterMs;
    const opened = g.openedAt.toMillis();
    const sinceOpen = Date.now() - opened;
    const clockOk = sinceOpen >= -2000 && sinceOpen <= lock + 2000;
    deadline = clockOk ? opened + lock : Date.now() + lock;
    deadlineQ = key;
  }
  return deadline;
}

function render(): void {
  if (!gameExists) {
    renderMessage(t("notOpen"));
    return;
  }
  const g = game;
  const u = uid;
  if (!g || !u) return;
  renderPlayer({
    game: g,
    uid: u,
    registered: isRegistered(),
    answer: "qIndex" in g ? storedAnswer(g.qIndex) : null,
    deadline: questionDeadline(g),
    register,
    submit,
    editRegistration,
  });
}
