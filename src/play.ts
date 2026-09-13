import { onAuthStateChanged, signInAnonymously } from "firebase/auth";
import {
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  type FirestoreError,
} from "firebase/firestore";
import { app as appEl, escapeHtml, frenchPunct, SHAPES, SHAPE_NAMES } from "./dom";
import { auth, db, GAME_ID } from "./firebase";
import { configureLanguages, initLang, qChoices, qText, t } from "./i18n";
import { initFontSize, initTheme } from "./theme";
import type { ChoiceIndex, Game, PlayerDoc } from "./types";

const gameRef = doc(db, "games", GAME_ID);

initTheme();
initFontSize();
initLang(() => {
  render();
  refreshConn();
});

// Connection badge, helps spot a frozen phone.
const conn = document.createElement("div");
conn.id = "conn";
document.body.appendChild(conn);
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

type SendState = "sent" | "confirmed" | "failed";
interface StoredAnswer {
  uid: string;
  choice: ChoiceIndex;
  state: SendState;
}

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

function renderMessage(html: string): void {
  appEl().innerHTML = `<section class="message"><p>${html}</p></section>`;
}

function render(): void {
  if (!gameExists) {
    renderMessage(t("notOpen"));
    return;
  }
  const g = game;
  if (!g || !uid) return;

  if (!isRegistered()) {
    renderRegistration(g);
    return;
  }

  switch (g.phase) {
    case "lobby":
      appEl().innerHTML = `
        <section class="message">
          <p>${t("registered")}</p>
          <button class="btn" id="edit-reg">${t("editReg")}</button>
        </section>`;
      document.querySelector("#edit-reg")?.addEventListener("click", () => {
        memRegistered = false;
        try {
          localStorage.removeItem(K("registered"));
        } catch {
          // blocked: the memory flag is enough
        }
        render();
      });
      break;
    case "reading":
      renderReading(g);
      break;
    case "question":
      renderQuestion(g);
      break;
    case "locked":
      renderLocked(g);
      break;
    case "reveal":
      renderReveal(g);
      break;
    case "final":
      renderFinal(g);
      break;
  }
}

function renderRegistration(g: Game): void {
  const prev = document.querySelector<HTMLInputElement>("#nickname");
  const draft = prev?.value ?? "";
  const hadFocus = prev !== null && document.activeElement === prev;
  const lateNote = g.joinOpen ? "" : `<p class='hint'>${t("lateNote")}</p>`;
  appEl().innerHTML = `
    <section class="register">
      <h1>${t("title")}</h1>
      ${lateNote}
      <form id="register-form">
        <input id="nickname" maxlength="20" placeholder="${t("nicknamePh")}" required autocomplete="off" />
        <p class="team-label">${t("chooseTeam")}</p>
        <div class="team-buttons">
          ${g.config.teams
            .map(
              (tm, i) =>
                `<button type="button" class="btn team-btn team-${i}" data-team="${escapeHtml(tm.id)}">${escapeHtml(tm.name)}</button>`
            )
            .join("")}
        </div>
      </form>
      <p id="register-error" class="error"></p>
    </section>`;
  const input = document.querySelector<HTMLInputElement>("#nickname");
  if (input) {
    input.value = draft;
    if (hadFocus) input.focus();
  }
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-team]")) {
    b.addEventListener("click", () => {
      const nickname = (document.querySelector<HTMLInputElement>("#nickname")?.value ?? "").trim();
      if (!nickname) {
        document.querySelector<HTMLInputElement>("#nickname")?.focus();
        return;
      }
      const team = b.dataset["team"] ?? "";
      register(nickname.slice(0, 20), team).catch((e) => {
        const p = document.querySelector("#register-error");
        if (p) p.textContent = t("regRefused") + (e instanceof Error ? e.message : String(e));
      });
    });
  }
}

function sendStateHtml(a: StoredAnswer): string {
  if (a.state === "confirmed") return `<p class="send-state ok">${t("recorded")}</p>`;
  if (a.state === "sent") return `<p class="send-state pending">${t("sent")}</p>`;
  return `<p class="send-state error">${t("sendFail")}</p>`;
}

function myChoiceHtml(g: Game & { phase: "question" | "locked" }, a: StoredAnswer): string {
  const label = qChoices(g.question)[a.choice];
  return `<div class="choice shape-${a.choice} chosen"><span class="shape">${SHAPES[a.choice]}</span> ${escapeHtml(label)}</div>`;
}

function renderReading(g: Game & { phase: "reading" }): void {
  appEl().innerHTML = `
    <section class="play-question">
      <p class="q-small">${frenchPunct(escapeHtml(qText(g.question)))}</p>
      <div class="answer-buttons">
        ${qChoices(g.question)
          .map(
            (c, i) =>
              `<button class="btn answer-btn shape-${i}" disabled>
                 <span class="shape">${SHAPES[i]}</span><span class="answer-text">${escapeHtml(c)}</span>
               </button>`
          )
          .join("")}
      </div>
      <p class="hint">${t("waitGo")}</p>
    </section>`;
}

function renderQuestion(g: Game & { phase: "question" }): void {
  const a = storedAnswer(g.qIndex);
  if (a) {
    appEl().innerHTML = `
      <section class="answered">
        <p class="q-small">${frenchPunct(escapeHtml(qText(g.question)))}</p>
        ${myChoiceHtml(g, a)}
        ${sendStateHtml(a)}
        ${a.state === "failed" ? `<button class="btn" id="retry">${t("retry")}</button>` : ""}
      </section>`;
    document.querySelector("#retry")?.addEventListener("click", () => submit(a.choice));
    return;
  }
  appEl().innerHTML = `
    <section class="play-question">
      <p class="q-small">${frenchPunct(escapeHtml(qText(g.question)))}</p>
      <div class="answer-buttons">
        ${qChoices(g.question)
          .map(
            (c, i) =>
              `<button class="btn answer-btn shape-${i}" data-choice="${i}"
                 aria-label="${SHAPE_NAMES[i]}: ${escapeHtml(c)}">
                 <span class="shape">${SHAPES[i]}</span><span class="answer-text">${escapeHtml(c)}</span>
               </button>`
          )
          .join("")}
      </div>
    </section>`;
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-choice]")) {
    b.addEventListener("click", () => {
      const c = Number(b.dataset["choice"]);
      if (c === 0 || c === 1 || c === 2 || c === 3) submit(c);
    });
  }
}

function renderLocked(g: Game & { phase: "locked" }): void {
  const a = storedAnswer(g.qIndex);
  appEl().innerHTML = `
    <section class="answered">
      <h1>${t("closed")}</h1>
      <p class="q-small">${frenchPunct(escapeHtml(qText(g.question)))}</p>
      ${a ? myChoiceHtml(g, a) + sendStateHtml(a) : `<p>${t("noAnswerSent")}</p>`}
      <p class="hint">${t("watchScreen")}</p>
    </section>`;
}

function renderReveal(g: Game & { phase: "reveal" }): void {
  const a = storedAnswer(g.qIndex);
  const me = uid ? g.scores[uid] : undefined;
  const correctLabel = qChoices(g.question)[g.reveal.correct];
  const verdict = !a
    ? `<h1 class="neutral">${t("noAnswer")}</h1>`
    : a.choice === g.reveal.correct
      ? `<h1 class="good">${t("goodAnswer")}</h1>`
      : `<h1 class="bad">${t("badAnswer")}</h1>`;
  appEl().innerHTML = `
    <section class="player-reveal">
      ${verdict}
      <p>${t("correctWas")}</p>
      <div class="choice shape-${g.reveal.correct} correct">
        <span class="correct-mark">✓</span><span class="shape">${SHAPES[g.reveal.correct]}</span> ${escapeHtml(correctLabel)}
      </div>
      ${me ? `<p class="my-score">${t("yourScore")} <strong>${me.score}</strong> / ${g.qIndex + 1}</p>` : `<p class='hint'>${t("joinNext")}</p>`}
      <p class="hint">${t("rankingOnScreen")}</p>
    </section>`;
}

function renderFinal(g: Game & { phase: "final" }): void {
  // The big screen shows the winner first.
  if (g.finalStep < 4) {
    appEl().innerHTML = `
      <section class="player-final">
        <h1>🥁</h1>
        <p class="hint">${t("verdictComing")}</p>
      </section>`;
    return;
  }
  const me = uid ? g.scores[uid] : undefined;
  const winnerName =
    g.winner === "tie"
      ? t("tie")
      : `${escapeHtml(g.config.teams.find((tm) => tm.id === g.winner)?.name ?? g.winner)} ${t("wins")}`;
  appEl().innerHTML = `
    <section class="player-final">
      <h1>${winnerName}</h1>
      ${me ? `<p class="my-score">${t("yourFinalScore")} <strong>${me.score}</strong> / ${g.total}</p>` : ""}
      <p>${t("thanks")}</p>
    </section>`;
}
