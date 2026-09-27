import { app as appEl, escapeHtml, frenchPunct, SHAPES, SHAPE_NAMES } from "./dom";
import { qChoices, qText, t } from "./i18n";
import type { ChoiceIndex, Game, Question } from "./types";

// Player phone screens, shared by play.ts and demo.ts.

export type SendState = "sent" | "confirmed" | "failed";

export interface StoredAnswer {
  uid: string;
  choice: ChoiceIndex;
  state: SendState;
}

export interface PlayerView {
  game: Game;
  uid: string;
  registered: boolean;
  answer: StoredAnswer | null; // answer to the current question
  deadline: number | null; // timer end, phone local time
  register(nickname: string, team: string): Promise<void>;
  submit(choice: ChoiceIndex): void;
  editRegistration(): void;
}

// 100vh lies on iOS Safari (address bar), so we measure the real height.
export function initPlayerLayout(): void {
  document.body.classList.add("player-page");
  const fit = (): void => {
    document.documentElement.style.setProperty("--app-h", `${window.innerHeight}px`);
  };
  fit();
  window.addEventListener("resize", fit);

  // Top right corner: connection badge (added by play.ts) and the timer.
  const corner = document.createElement("div");
  corner.className = "top-right";
  corner.innerHTML = `<span id="chrono-slot"></span>`;
  document.body.appendChild(corner);
}

let chrono: ReturnType<typeof setInterval> | null = null;

function stopChrono(): void {
  if (chrono !== null) clearInterval(chrono);
  chrono = null;
  const slot = document.querySelector("#chrono-slot");
  if (slot) slot.textContent = "";
}

function startChrono(deadline: number): void {
  const slot = document.querySelector("#chrono-slot");
  if (!slot) return;
  const tick = (): void => {
    slot.textContent = `⏱ ${Math.max(0, Math.ceil((deadline - Date.now()) / 1000))}`;
  };
  tick();
  chrono = setInterval(tick, 250);
}

export function renderMessage(html: string): void {
  appEl().innerHTML = `<section class="message"><p>${html}</p></section>`;
}

export function renderPlayer(v: PlayerView): void {
  stopChrono();
  const g = v.game;
  if (!v.registered) {
    renderRegistration(v);
    return;
  }
  switch (g.phase) {
    case "lobby":
      renderLobby(v);
      break;
    case "reading":
      renderReading(g.question);
      break;
    case "question":
      renderQuestion(v, g.question);
      if (v.deadline !== null) startChrono(v.deadline);
      break;
    case "locked":
      renderLocked(v, g.question);
      break;
    case "reveal":
      renderReveal(v, g);
      break;
    case "final":
      renderFinal(v, g);
      break;
  }
}

function renderRegistration(v: PlayerView): void {
  const prev = document.querySelector<HTMLInputElement>("#nickname");
  const draft = prev?.value ?? "";
  const hadFocus = prev !== null && document.activeElement === prev;
  const lateNote = v.game.joinOpen ? "" : `<p class='hint'>${t("lateNote")}</p>`;
  appEl().innerHTML = `
    <section class="register">
      <h1>${t("title")}</h1>
      ${lateNote}
      <form id="register-form">
        <input id="nickname" maxlength="20" placeholder="${t("nicknamePh")}" required autocomplete="off" />
        <p class="team-label">${t("chooseTeam")}</p>
        <div class="team-buttons">
          ${v.game.config.teams
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
      const nickname = (input?.value ?? "").trim();
      if (!nickname) {
        input?.focus();
        return;
      }
      v.register(nickname.slice(0, 20), b.dataset["team"] ?? "").catch((e: unknown) => {
        const p = document.querySelector("#register-error");
        if (p) p.textContent = t("regRefused") + (e instanceof Error ? e.message : String(e));
      });
    });
  }
}

function renderLobby(v: PlayerView): void {
  appEl().innerHTML = `
    <section class="message">
      <p class="info-text">${t("registered")}</p>
      <button class="btn" id="edit-reg">${t("editReg")}</button>
    </section>`;
  document.querySelector("#edit-reg")?.addEventListener("click", () => v.editRegistration());
}

function questionHtml(q: Question): string {
  const text = qText(q);
  const size = text.length > 110 ? "q-small q-long" : "q-small";
  return `<p class="${size}">${frenchPunct(escapeHtml(text))}</p>`;
}

function sendStateHtml(a: StoredAnswer): string {
  if (a.state === "confirmed") return `<p class="send-state ok">${t("recorded")}</p>`;
  if (a.state === "sent") return `<p class="send-state pending">${t("sent")}</p>`;
  return `<p class="send-state error">${t("sendFail")}</p>`;
}

function myChoiceHtml(q: Question, a: StoredAnswer): string {
  const label = qChoices(q)[a.choice];
  return `<div class="choice shape-${a.choice} chosen"><span class="shape">${SHAPES[a.choice]}</span> ${escapeHtml(label)}</div>`;
}

function answerButtonsHtml(q: Question, enabled: boolean): string {
  return `<div class="answer-buttons">
    ${qChoices(q)
      .map(
        (c, i) =>
          `<button class="btn answer-btn shape-${i}" ${enabled ? `data-choice="${i}"` : "disabled"}
             aria-label="${SHAPE_NAMES[i]}: ${escapeHtml(c)}">
             <span class="shape">${SHAPES[i]}</span><span class="answer-text">${escapeHtml(c)}</span>
           </button>`
      )
      .join("")}
  </div>`;
}

function renderReading(q: Question): void {
  appEl().innerHTML = `
    <section class="play-question">
      ${questionHtml(q)}
      ${answerButtonsHtml(q, false)}
      <p class="hint">${t("waitGo")}</p>
    </section>`;
}

function renderQuestion(v: PlayerView, q: Question): void {
  const a = v.answer;
  if (a) {
    appEl().innerHTML = `
      <section class="answered">
        ${questionHtml(q)}
        ${myChoiceHtml(q, a)}
        ${sendStateHtml(a)}
        ${a.state === "failed" ? `<button class="btn" id="retry">${t("retry")}</button>` : ""}
      </section>`;
    document.querySelector("#retry")?.addEventListener("click", () => v.submit(a.choice));
    return;
  }
  appEl().innerHTML = `
    <section class="play-question">
      ${questionHtml(q)}
      ${answerButtonsHtml(q, true)}
    </section>`;
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-choice]")) {
    b.addEventListener("click", () => {
      const c = Number(b.dataset["choice"]);
      if (c === 0 || c === 1 || c === 2 || c === 3) v.submit(c);
    });
  }
}

function renderLocked(v: PlayerView, q: Question): void {
  const a = v.answer;
  appEl().innerHTML = `
    <section class="answered">
      <h1>${t("closed")}</h1>
      ${questionHtml(q)}
      ${a ? myChoiceHtml(q, a) + sendStateHtml(a) : `<p class="info-text">${t("noAnswerSent")}</p>`}
      <p class="hint">${t("watchScreen")}</p>
    </section>`;
}

function renderReveal(v: PlayerView, g: Game & { phase: "reveal" }): void {
  const a = v.answer;
  const me = g.scores[v.uid];
  const correct = g.reveal.correct;
  const verdict = !a
    ? `<h1 class="neutral">${t("noAnswer")}</h1>`
    : a.choice === correct
      ? `<h1 class="good">${t("goodAnswer")}</h1>`
      : `<h1 class="bad">${t("badAnswer")}</h1>`;
  appEl().innerHTML = `
    <section class="player-reveal">
      ${verdict}
      <p class="info-text">${t("correctWas")}</p>
      <div class="choice shape-${correct} correct">
        <span class="correct-mark">✓</span><span class="shape">${SHAPES[correct]}</span> ${escapeHtml(qChoices(g.question)[correct])}
      </div>
      ${me ? `<p class="my-score">${t("yourScore")} <strong>${me.score}</strong> / ${g.qIndex + 1}</p>` : `<p class='hint'>${t("joinNext")}</p>`}
      <p class="hint">${t("rankingOnScreen")}</p>
    </section>`;
}

// The big screen shows the winner first.
function renderFinal(v: PlayerView, g: Game & { phase: "final" }): void {
  if (g.finalStep < 4) {
    appEl().innerHTML = `
      <section class="player-final">
        <p class="big-emoji">🥁</p>
        <p class="wait-text">${t("verdictComing")}</p>
      </section>`;
    return;
  }
  const me = g.scores[v.uid];
  const winnerName =
    g.winner === "tie"
      ? t("tie")
      : `${escapeHtml(g.config.teams.find((tm) => tm.id === g.winner)?.name ?? g.winner)} ${t("wins")}`;
  appEl().innerHTML = `
    <section class="player-final">
      <h1 class="final-winner">${winnerName}</h1>
      ${me ? `<p class="my-score">${t("yourFinalScore")} <strong>${me.score}</strong> / ${g.total}</p>` : ""}
      <p class="info-text">${t("thanks")}</p>
    </section>`;
}
