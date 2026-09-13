import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithCustomToken,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import QRCode from "qrcode";
import { app as appEl, escapeHtml, fmtAvg, frenchPunct, SHAPES } from "./dom";
import { devHostToken } from "./dev-token";
import { configureLanguages, initLang, qChoices, qText, t } from "./i18n";
import { initFontSize, initTheme } from "./theme";
import { auth, db, GAME_ID, onEmulator } from "./firebase";
import { decideWinner, sortPlayers, tally, teamAverages } from "./tally";
import type { AnswerDoc, Game, HostKey, PlayerDoc, Scores, Team } from "./types";

const gameRef = doc(db, "games", GAME_ID);

// Nothing here is needed to resume, a reload rebuilds it all from the game doc.
let game: Game | null = null;
let gameExists = false;
let gamePending = false; // local writes not yet confirmed by the server
let key: HostKey | null = null;
let keyReloading = false;
let liveCount = 0;
let lobbyPlayers: Array<{ uid: string } & PlayerDoc> = [];
let busy = false; // blocks double transitions (double space press)

let unsubGame: Unsubscribe | null = null;
let unsubAnswers: Unsubscribe | null = null;
let answersQIndex: number | null = null;
let unsubPlayers: Unsubscribe | null = null;
let lockTimer: ReturnType<typeof setTimeout> | null = null;
let lockArmedFor: number | null = null; // qIndex of the running timer
let earlyLockFor: number | null = null;
const ALL_ANSWERED_MS = 1500;
let chronoTimer: ReturnType<typeof setInterval> | null = null;

initTheme();
document.body.classList.add("host-page");
initFontSize();
initLang(() => {
  render();
});

const conn = document.createElement("div");
conn.id = "conn";
document.body.appendChild(conn);

function setConn(state: "ok" | "cache" | "off", label: string): void {
  conn.className = `conn conn-${state}`;
  conn.textContent = label;
}
setConn("off", "…");
addEventListener("offline", () => setConn("off", t("offline")));

// Shown when the key comes from another seed.
const warn = document.createElement("div");
warn.id = "warn";
warn.className = "warn-banner";
warn.hidden = true;
document.body.appendChild(warn);

function updateWarn(): void {
  const g = game;
  const mismatch = g !== null && key !== null && key.session !== g.session;
  warn.hidden = !mismatch;
  if (mismatch) warn.textContent = t("keyMismatch");
  // Seed ran again while this tab is open: reload the key.
  if (mismatch && !keyReloading) {
    keyReloading = true;
    void getDoc(doc(db, "games", GAME_ID, "private", "key"))
      .then((snap) => {
        key = snap.exists() ? (snap.data() as HostKey) : null;
      })
      .finally(() => {
        keyReloading = false;
        render();
      });
  }
}

onAuthStateChanged(auth, (user) => {
  if (!user) {
    renderLogin();
    return;
  }
  void bootstrap(user);
});

async function bootstrap(user: User): Promise<void> {
  renderMessage(t("keyLoading"));
  try {
    // Read once, kept in memory, never copied to the public game doc.
    const snap = await getDoc(doc(db, "games", GAME_ID, "private", "key"));
    key = snap.exists() ? (snap.data() as HostKey) : null;
  } catch {
    // Probably a player session left in this browser (same origin as the player page).
    renderMessage(
      `${t("deniedKey")}<br>` +
        `${t("currentUid")} <code>${escapeHtml(user.uid)}</code><br>` +
        `<small>${t("deniedHint")}</small><br>` +
        (onEmulator
          ? `<button class="btn btn-primary" id="dev-login">${t("devLogin")}</button>`
          : t("prodUidHint")) +
        `<button class="btn" id="switch-account">${t("switchAccount")}</button>`
    );
    document.querySelector("#dev-login")?.addEventListener("click", () => {
      void signInWithCustomToken(auth, devHostToken());
    });
    document.querySelector("#switch-account")?.addEventListener("click", () => {
      void signOut(auth);
    });
    return;
  }
  subscribeGame();
}

function subscribeGame(): void {
  unsubGame?.();
  unsubGame = onSnapshot(
    gameRef,
    { includeMetadataChanges: true },
    (snap) => {
      gameExists = snap.exists();
      configureLanguages(gameExists ? (snap.data() as Game).config.languages : undefined);
      gamePending = snap.metadata.hasPendingWrites;
      // "estimate": read our own pending serverTimestamp() values.
      game = gameExists ? (snap.data({ serverTimestamps: "estimate" }) as Game) : null;
      setConn(snap.metadata.fromCache ? "cache" : "ok", snap.metadata.fromCache ? t("cacheWait") : t("online"));
      onGameUpdate();
    },
    () => setConn("off", t("connError"))
  );
}

function onGameUpdate(): void {
  const g = game;

  if (g?.phase === "question") {
    ensureAnswersListener(g.qIndex);
    if (lockArmedFor !== g.qIndex) {
      lockArmedFor = g.qIndex;
      armAutoLock(g.openedAt.toMillis() + g.config.lockAfterMs - Date.now());
    }
    startChrono();
  } else {
    stopAnswersListener();
    clearAutoLock();
    stopChrono();
  }

  if (g?.phase === "lobby") ensurePlayersListener();
  else stopPlayersListener();

  render();
}

function ensureAnswersListener(qIndex: number): void {
  if (answersQIndex === qIndex && unsubAnswers) return;
  stopAnswersListener();
  answersQIndex = qIndex;
  const g = game;
  if (!g) return;
  const q = query(
    collection(db, "games", GAME_ID, "answers"),
    where("q", "==", qIndex),
    where("session", "==", g.session)
  );
  // Live count stays local, in the game doc it'd cost 70 reads per answer.
  unsubAnswers = onSnapshot(q, (snap) => {
    const cur = game;
    if (!cur) return;
    // Late signups not added to scores yet don't count.
    liveCount = snap.docs.filter((d) => cur.scores[(d.data() as AnswerDoc).uid] !== undefined).length;
    const total = Object.keys(cur.scores).length;
    const count = document.querySelector("#live-count");
    if (count) count.textContent = `${liveCount} / ${total}`;
    // Everyone answered: lock after a short pause so the room sees the full count.
    const allIn = total > 0 && liveCount >= total;
    if (allIn && cur.config.lockWhenAllAnswered !== false && earlyLockFor !== qIndex) {
      earlyLockFor = qIndex;
      armAutoLock(ALL_ANSWERED_MS);
      lockArmedFor = qIndex;
    }
  });
}

function stopAnswersListener(): void {
  unsubAnswers?.();
  unsubAnswers = null;
  answersQIndex = null;
}

function ensurePlayersListener(): void {
  if (unsubPlayers) return;
  unsubPlayers = onSnapshot(
    collection(db, "games", GAME_ID, "players"),
    (snap) => {
      lobbyPlayers = snap.docs.map((d) => ({ uid: d.id, ...(d.data() as PlayerDoc) }));
      render();
    },
    () => {
      // listener died: clear it so the next game snapshot restarts it
      unsubPlayers = null;
    }
  );
}

function stopPlayersListener(): void {
  unsubPlayers?.();
  unsubPlayers = null;
}

function armAutoLock(inMs: number): void {
  clearAutoLock();
  lockTimer = setTimeout(() => void lock(), Math.max(0, inMs));
}

function clearAutoLock(): void {
  if (lockTimer !== null) clearTimeout(lockTimer);
  lockTimer = null;
  lockArmedFor = null;
}

function startChrono(): void {
  stopChrono();
  chronoTimer = setInterval(() => {
    const g = game;
    const t = document.querySelector("#chrono");
    if (!t || g?.phase !== "question") return;
    const left = Math.max(0, g.openedAt.toMillis() + g.config.lockAfterMs - Date.now());
    t.textContent = String(Math.ceil(left / 1000));
  }, 200);
}

function stopChrono(): void {
  if (chronoTimer !== null) clearInterval(chronoTimer);
  chronoTimer = null;
}

// Game transitions: each one is a single write to the game doc.
async function guarded(fn: () => Promise<void>): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    await fn();
  } catch (e) {
    alert(t("writeFail") + (e instanceof Error ? e.message : String(e)));
  } finally {
    busy = false;
  }
}

// Copy new signups into scores. Team is checked here since rules can't without a get().
async function mergePlayers(
  base: Scores,
  teams: Team[],
  session: string
): Promise<{ scores: Scores; added: number }> {
  const snap = await getDocs(collection(db, "games", GAME_ID, "players"));
  const scores: Scores = structuredClone(base);
  const validTeams = new Set(teams.map((t) => t.id));
  let added = 0;
  if (game?.session !== session)
    throw new Error("The game was seeded again during the merge, action cancelled");
  for (const d of snap.docs) {
    const p = d.data() as PlayerDoc;
    if (p.session !== session) continue; // from a previous game
    if (scores[d.id] || !validTeams.has(p.team)) continue;
    scores[d.id] = { nickname: p.nickname, team: p.team, score: 0, answered: 0, totalMs: 0 };
    added++;
  }
  return { scores, added };
}

function openReading(i: number, scores?: Scores): Promise<void> {
  // Texts come from private/key, so the public bundle has no quiz content.
  const question = key?.questions[i];
  if (!question) return Promise.reject(new Error(`Question ${i} missing from private/key, run the seed again`));
  return updateDoc(gameRef, {
    phase: "reading",
    qIndex: i,
    question, // never includes the answer
    joinOpen: false,
    reveal: deleteField(),
    ...(scores ? { scores } : {}),
  });
}

// Opens answers and starts the timer.
async function go(): Promise<void> {
  if (game?.phase !== "reading") return;
  await updateDoc(gameRef, { phase: "question", openedAt: serverTimestamp() });
}

async function start(): Promise<void> {
  const g = game;
  if (g?.phase !== "lobby") return;
  const { scores } = await mergePlayers(g.scores, g.config.teams, g.session);
  await openReading(0, scores);
}

async function lock(): Promise<void> {
  if (game?.phase !== "question") return;
  await updateDoc(gameRef, { phase: "locked", lockedAt: serverTimestamp() });
}

async function revealNow(): Promise<void> {
  // Window = lockedAt - openedAt (server times), so wait for our writes to land.
  for (let i = 0; i < 60 && gamePending; i++) {
    await new Promise((r) => setTimeout(r, 50));
  }
  const g = game;
  if (g?.phase !== "locked") return;
  const correct = key?.correct[g.qIndex];
  if (correct === undefined) throw new Error(`No answer for question ${g.qIndex}`);

  // Fresh read, not the listener buffer: catches late answers and survives a reload.
  const snap = await getDocs(
    query(
      collection(db, "games", GAME_ID, "answers"),
      where("q", "==", g.qIndex),
      where("session", "==", g.session)
    )
  );
  const answers = snap.docs.map((d) => d.data() as AnswerDoc);

  const windowMs = g.lockedAt.toMillis() - g.openedAt.toMillis();
  const { reveal, scores } = tally(answers, correct, g.openedAt, windowMs, g.scores, g.config.teams);

  // One write on one doc, no writeBatch.
  await updateDoc(gameRef, {
    phase: "reveal",
    reveal,
    scores,
    openedAt: deleteField(),
    lockedAt: deleteField(),
  });
}

async function next(): Promise<void> {
  const g = game;
  if (g?.phase !== "reveal") return;
  if (g.qIndex + 1 < g.total) {
    await openReading(g.qIndex + 1);
  } else {
    const averages = teamAverages(g.scores, g.config.teams);
    await updateDoc(gameRef, {
      phase: "final",
      finalStep: 0,
      podium: sortPlayers(g.scores).slice(0, 5),
      winner: decideWinner(averages),
      averages,
      qIndex: deleteField(),
      question: deleteField(),
      reveal: deleteField(),
    });
  }
}

async function finalNext(): Promise<void> {
  const g = game;
  if (g?.phase !== "final" || g.finalStep >= 4) return;
  await updateDoc(gameRef, { finalStep: g.finalStep + 1 });
}

// Adds players who registered late, with a score of 0.
async function integrate(): Promise<void> {
  const g = game;
  if (!g) return;
  const { scores, added } = await mergePlayers(g.scores, g.config.teams, g.session);
  if (added > 0) await updateDoc(gameRef, { scores });
  alert(added > 0 ? `${added} ${t("integratedSome")}` : t("integratedNone"));
}

async function kick(uid: string): Promise<void> {
  await deleteDoc(doc(db, "games", GAME_ID, "players", uid));
}

// Space bar runs the main action of the current phase.
document.addEventListener("keydown", (e) => {
  if (e.code !== "Space" || e.target instanceof HTMLInputElement) return;
  e.preventDefault();
  const g = game;
  if (!g) return;
  if (g.phase === "lobby") void guarded(start);
  else if (g.phase === "reading") void guarded(go);
  else if (g.phase === "question") void guarded(lock);
  else if (g.phase === "locked") void guarded(revealNow);
  else if (g.phase === "reveal") void guarded(next);
  else if (g.phase === "final") void guarded(finalNext);
});

function renderLogin(): void {
  appEl().innerHTML = `
    <section class="login">
      <h1>${t("hostTitle")}</h1>
      ${onEmulator ? `<button class="btn btn-primary" id="dev-login">${t("devLogin")}</button><p class="hint">${t("orProd")}</p>` : ""}
      <form id="login-form">
        <input type="email" id="email" placeholder="${t("emailPh")}" required autocomplete="username" />
        <input type="password" id="password" placeholder="${t("passwordPh")}" required autocomplete="current-password" />
        <button type="submit" class="btn">${t("loginBtn")}</button>
      </form>
      <p id="login-error" class="error"></p>
    </section>`;
  document.querySelector("#dev-login")?.addEventListener("click", () => {
    void signInWithCustomToken(auth, devHostToken()).catch((e: unknown) => {
      const p = document.querySelector("#login-error");
      if (p) p.textContent = String(e);
    });
  });
  const form = document.querySelector<HTMLFormElement>("#login-form");
  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    const email = (document.querySelector<HTMLInputElement>("#email")?.value ?? "").trim();
    const password = document.querySelector<HTMLInputElement>("#password")?.value ?? "";
    void (async () => {
      try {
        await signInWithEmailAndPassword(auth, email, password);
      } catch (err) {
        if (onEmulator) {
          try {
            await createUserWithEmailAndPassword(auth, email, password);
            return;
          } catch {
            // fall through to the error message
          }
        }
        const p = document.querySelector("#login-error");
        if (p) p.textContent = t("loginRefused") + (err instanceof Error ? err.message : String(err));
      }
    })();
  });
}

function renderMessage(html: string): void {
  appEl().innerHTML = `<section class="message"><p>${html}</p></section>`;
}

function teamName(g: Game, id: string): string {
  return g.config.teams.find((t) => t.id === id)?.name ?? id;
}

function controlsHtml(g: Game): string {
  const btn = (action: string, label: string, primary: boolean) =>
    `<button class="btn ${primary ? "btn-primary" : ""}" data-action="${action}">${label}</button>`;
  const items: string[] = [];
  if (g.phase === "lobby") items.push(btn("start", t("startBtn"), true));
  if (g.phase === "reading") items.push(btn("go", t("goBtn"), true));
  if (g.phase === "question") items.push(btn("lock", t("lockBtn"), true));
  if (g.phase === "locked") items.push(btn("reveal", t("revealBtn"), true));
  if (g.phase === "reveal") {
    items.push(btn("next", g.qIndex + 1 < g.total ? t("nextBtn") : t("finalBtn"), true));
    items.push(btn("integrate", t("integrateBtn"), false));
  }
  if (g.phase === "lobby") items.push(btn("integrate", t("integrateBtn"), false));
  if (g.phase === "final" && g.finalStep < 4) items.push(btn("finalNext", t("suspenseBtn"), true));
  return `<nav class="controls">${items.join("")}</nav>`;
}

function render(): void {
  if (!auth.currentUser) return;
  updateWarn();
  if (!gameExists) {
    renderMessage(t("seedMissing"));
    return;
  }
  const g = game;
  if (!g) return;

  const header = `<header class="topbar">
    <span>${t("question")} ${"qIndex" in g ? g.qIndex + 1 : "—"} / ${g.total}</span>
    <span class="phase-tag">${g.phase}</span>
  </header>`;

  switch (g.phase) {
    case "lobby":
      renderLobby(g);
      break;
    case "reading":
      appEl().innerHTML = `${header}
        <section class="question-screen">
          <h1 class="question-text">${frenchPunct(escapeHtml(qText(g.question)))}</h1>
          <div class="choices-grid">
            ${qChoices(g.question)
              .map(
                (c, i) =>
                  `<div class="choice shape-${i}"><span class="shape">${SHAPES[i]}</span> ${escapeHtml(c)}</div>`
              )
              .join("")}
          </div>
          <p class="locked-banner reading-banner">${t("getReady")}</p>
        </section>
        ${controlsHtml(g)}`;
      break;
    case "question": {
      const total = Object.keys(g.scores).length;
      appEl().innerHTML = `${header}
        <section class="question-screen">
          <h1 class="question-text">${frenchPunct(escapeHtml(qText(g.question)))}</h1>
          <div class="choices-grid">
            ${qChoices(g.question)
              .map(
                (c, i) =>
                  `<div class="choice shape-${i}"><span class="shape">${SHAPES[i]}</span> ${escapeHtml(c)}</div>`
              )
              .join("")}
          </div>
          <div class="live-row">
            <div class="chrono-box">⏱ <span id="chrono">—</span> s</div>
            <div class="count-box"><span id="live-count">${liveCount} / ${total}</span> ${t("answersWord")}</div>
          </div>
        </section>
        ${controlsHtml(g)}`;
      break;
    }
    case "locked":
      appEl().innerHTML = `${header}
        <section class="question-screen">
          <h1 class="question-text">${frenchPunct(escapeHtml(qText(g.question)))}</h1>
          <p class="locked-banner">${t("lockedBanner")}</p>
        </section>
        ${controlsHtml(g)}`;
      break;
    case "reveal":
      renderReveal(g);
      break;
    case "final":
      renderFinal(g);
      break;
  }
  bindControls();
}

function renderLobby(g: Game & { phase: "lobby" }): void {
  const byTeam = new Map<string, number>();
  for (const p of lobbyPlayers) byTeam.set(p.team, (byTeam.get(p.team) ?? 0) + 1);
  appEl().innerHTML = `
    <section class="lobby">
      <h1>${t("scanToPlay")}</h1>
      <canvas id="qr"></canvas>
      <p class="join-url">${escapeHtml(location.origin + "/")}</p>
      <div class="team-counts">
        ${g.config.teams
          .map(
            (t, i) =>
              `<div class="team-count team-${i}">${escapeHtml(t.name)} : <strong>${byTeam.get(t.id) ?? 0}</strong></div>`
          )
          .join("")}
      </div>
      <ul class="lobby-list">
        ${lobbyPlayers
          .map(
            (p) =>
              `<li>${escapeHtml(p.nickname)} <small>(${escapeHtml(teamName(g, p.team))})</small>
               <button class="kick" data-kick="${escapeHtml(p.uid)}" title="${t("kickTitle")}">✕</button></li>`
          )
          .join("")}
      </ul>
    </section>
    ${controlsHtml(g)}`;
  const canvas = document.querySelector<HTMLCanvasElement>("#qr");
  if (canvas) void QRCode.toCanvas(canvas, location.origin + "/", { width: 640, margin: 1 });
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-kick]")) {
    b.addEventListener("click", () => {
      const uid = b.dataset["kick"];
      if (uid) void guarded(() => kick(uid));
    });
  }
}

function renderReveal(g: Game & { phase: "reveal" }): void {
  const r = g.reveal;
  const totalVotes = r.counts.reduce((a, b) => a + b, 0);
  appEl().innerHTML = `
    <header class="topbar"><span>${t("question")} ${g.qIndex + 1} / ${g.total}</span><span class="phase-tag">${g.phase}</span></header>
    <section class="reveal-screen">
      <h1 class="question-text">${frenchPunct(escapeHtml(qText(g.question)))}</h1>
      <div class="choices-grid">
        ${qChoices(g.question)
          .map((c, i) => {
            const count = r.counts[i] ?? 0;
            const pct = totalVotes === 0 ? 0 : Math.round((count / totalVotes) * 100);
            return `<div class="choice shape-${i} ${i === r.correct ? "correct" : "dimmed"}">
              ${i === r.correct ? '<span class="correct-mark">✓</span>' : ""}<span class="shape">${SHAPES[i]}</span> ${escapeHtml(c)}
              <div class="bar-track"><div class="bar" style="width:${pct}%"></div></div>
              <span class="votes">${count}</span>
            </div>`;
          })
          .join("")}
      </div>
      <div class="reveal-side">
        <div class="team-stats">
          ${g.config.teams
            .map((tm, i) => {
              const s = r.teams[tm.id];
              return `<div class="team-stat team-${i}">
                <strong>${escapeHtml(tm.name)}</strong>
                <span>${t("thisRound")} ${s?.roundCorrect ?? 0} / ${s?.roundAnswered ?? 0}</span>
                <span>${t("average")} ${fmtAvg(s?.avg ?? 0)}</span>
              </div>`;
            })
            .join("")}
        </div>
      </div>
    </section>
    ${controlsHtml(g)}`;
}

// Staged reveal: drumroll, places 4-5, places 2-3, first place, winning team.
function renderFinal(g: Game & { phase: "final" }): void {
  const step = g.finalStep;
  if (step === 0) {
    appEl().innerHTML = `
      <section class="final-screen">
        <h1 class="drumroll">${t("drumroll")}</h1>
        <p class="hint">${t("allReady")}</p>
      </section>
      ${controlsHtml(g)}`;
    return;
  }

  const medals = ["🥇", "🥈", "🥉", "4.", "5."];
  const revealedFrom = step >= 3 ? 0 : step === 2 ? 1 : 3; // first visible podium index
  const podiumHtml = g.podium
    .map((p, i) => {
      const medal = medals[i] ?? `${i + 1}.`;
      if (i < revealedFrom)
        return `<li class="podium-row masked"><span class="medal">${medal}</span> ???</li>`;
      return `<li class="podium-row rank-${i}"><span class="medal">${medal}</span>
        ${escapeHtml(p.nickname)} <small>(${escapeHtml(teamName(g, p.team))})</small>
        <span class="pts">${p.score} ${p.score > 1 ? t("pts") : t("pt")}</span></li>`;
    })
    .join("");

  const winnerLabel =
    g.winner === "tie" ? t("tie") : `🏆 ${escapeHtml(teamName(g, g.winner))} ${t("wins")}`;
  const verdictHtml =
    step >= 4
      ? `<h1 class="winner">${winnerLabel}</h1>
         <div class="team-stats">
           ${g.config.teams
             .map(
               (tm, i) =>
                 `<div class="team-stat team-${i} ${tm.id === g.winner ? "winning" : ""}">
                    <strong>${tm.id === g.winner ? "🏆 " : ""}${escapeHtml(tm.name)}</strong>
                    <span>${t("average")} ${fmtAvg(g.averages[tm.id] ?? 0)}</span></div>`
             )
             .join("")}
         </div>`
      : `<h2 class="pending-verdict">${t("andWinnerIs")}</h2>`;

  appEl().innerHTML = `
    <section class="final-screen">
      ${verdictHtml}
      ${g.podium.length > 0 ? `<h2>${t("podiumTitle")}</h2><ol class="podium">${podiumHtml}</ol>` : ""}
    </section>
    ${controlsHtml(g)}`;
}

function bindControls(): void {
  const actions: Record<string, () => Promise<void>> = {
    start,
    go,
    lock,
    reveal: revealNow,
    next,
    finalNext,
    integrate,
  };
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-action]")) {
    b.addEventListener("click", () => {
      const fn = actions[b.dataset["action"] ?? ""];
      if (fn) void guarded(fn);
    });
  }
}
