# BlazeAway

Open source live quiz built on Firebase. Questions show on a big screen
(`/host`). Players answer on their phone (`/`). Team scores update in real time.
Made for a real room: about 70 players, one host, one projector.

Stack: Firestore, Firebase Auth, Firebase Hosting. Free plan (Spark). No backend.
The example config has two teams and a few sample questions. Teams, questions
and texts are all configurable.

## Requirements

- Node 20 or newer
- JDK 21 or newer for the Firestore emulator. On macOS: `brew install openjdk@21`.
  The npm scripts set `JAVA_HOME` to `/opt/homebrew/opt/openjdk@21`. If your JDK
  is somewhere else, change the paths in `package.json`.

```bash
npm install
```

## Local development (emulators)

```bash
npm run emulators    # Auth (9099) + Firestore (8180) + UI
npm run dev          # Vite: http://localhost:5173 (player) and /host.html (host)
```

1. Seed the game: `npm run seed:dev`. No password needed.
2. Open `http://localhost:5173/host.html` and click "Connexion hôte (émulateur)".
   The dev host UID is fixed (`dev-host-fixed-uid`). It is already in
   `firestore.rules` and it survives emulator restarts.
3. Players: open `http://localhost:5173/`. One browser = one anonymous account.
   To test several players, use a private window, another browser, Chrome
   profiles, or a real phone on the same wifi at `http://LAPTOP-IP:5173/`.
   Vite and the emulators listen on the local network.

To restart a game from zero, run `npm run seed:dev` again. Each seed creates a
new session id. Old answers and registrations from the previous game are ignored.

## Tests

```bash
npm run test:unit    # tally, teamAverages, sortPlayers, validateConfig
npm run test:rules   # 21 security rules tests, needs the emulator
npm test             # both
npm run simulate     # full game with 70 fake players against the emulator
N=10 npm run simulate
```

Measured with `simulate` at N = 70: about **426 reads and 74 writes per
question**. For 30 questions that is about 13 000 reads and 2 300 writes.
The Spark daily quota is 50 000 reads and 20 000 writes, so there is a lot
of margin.

## Game configuration

Everything is in one file: [`quiz.config.ts`](quiz.config.ts). One question
looks like this:

```ts
export const CONFIG: QuizConfig = {
  teams: [
    { id: "A", name: "Équipe A" },    // 2 to 6 teams, names are free
    { id: "B", name: "Équipe B" },
  ],
  lockAfterMs: 20_000,                // time per question, in milliseconds
  lockWhenAllAnswered: true,          // lock early once everyone answered
  languages: { default: "fr", enabled: ["fr", "en"] },
  questions: [
    {
      text: {
        fr: "Quelle est la plus grande planète du système solaire ?",
        en: "What is the largest planet in the solar system?",   // optional
      },
      choices: {
        fr: ["Mars", "Jupiter", "Saturne", "Neptune"],
        en: ["Mars", "Jupiter", "Saturn", "Neptune"],
      },
      correct: 1,                     // index of the right answer, 0 to 3
    },
    // ... add as many questions as you want
  ],
};
```

Rules to know:

- `correct` is the index in `choices`: 0, 1, 2 or 3.
- Each question needs exactly 4 choices, none empty.
- The default language is required for every question. Other languages are
  optional, question by question. A missing translation falls back to the
  default language, never to a hole.
- Team scores use the average, not the sum, so team sizes can be different.
- With `lockWhenAllAnswered: true`, the question locks 1.5 s after the last
  player answers. Set it to `false` to always wait for the full timer.

Languages: `default` is what everyone sees when the page loads. `enabled` is
the list offered by the 🌐 button on the phones and on the host screen. All
interface texts (buttons, messages) are translated too. To add a language,
for example Spanish:

1. Create `src/i18n/es.ts` with `export const es: Strings = { ... }`. Copy
   `src/i18n/en.ts` as a template. The compiler refuses any missing key.
2. Register it in `src/i18n/index.ts`: `const LOCALES = { fr, en, es }`.
3. Enable it in the config: `languages: { default: "fr", enabled: ["fr", "en", "es"] }`.
4. Add `es` texts to the questions you want. The rest falls back to the default language.

How the config reaches the app: only the scripts read this file. The browser
code never imports it, so the public JavaScript contains no questions and no
answers. The seed script checks the config, then writes two things to
Firestore: the game document (teams, timer, languages, number of questions)
and a private document with the questions and the answer key. Only the host
account can read that private document.

Workflow after any edit:

```bash
npm run test:unit    # validates the config and lists the errors
npm run seed:dev     # local; or HOST_EMAIL=... HOST_PASSWORD=... npm run seed
```

Each seed creates a new game session. Phones forget the previous game, old
answers cannot collide with new ones, and the lobby starts clean. If you edit
the config but forget to seed again, the host screen shows a warning banner.

## Going to production

### 1. Create the Firebase project

1. Go to <https://console.firebase.google.com> and create a project. Analytics
   is not needed.
2. In **Authentication, Sign-in method**: enable **Anonymous** and
   **Email/Password**.
3. In **Authentication, Users**: create the host account with your email and a
   strong password. Copy its **UID**.
4. In **Firestore Database**: create a database. Production mode, region
   **eur3**, database **(default)**. The default database is required for the
   free quota.
5. In **Project settings, Your apps**: register a web app and copy the config
   values (`apiKey`, `authDomain`, `projectId`, `appId`).

### 2. Plug in the code

1. In `.firebaserc`: replace `your-project-id` with your project id.
2. In `src/firebase-config.ts`: paste the web config. This config is public by
   design. It identifies the project, it is not a secret, you can commit it.
3. In `firestore.rules`: replace `YOUR_HOST_UID` with the host UID from
   step 1.3.

### 3. Seed and deploy

```bash
HOST_EMAIL=your@email HOST_PASSWORD='...' npm run seed
npx firebase login
npx firebase deploy --only firestore:rules
npm run build
npx firebase deploy --only hosting
```

Player URL: `https://YOUR-PROJECT.web.app/`. The QR code in the lobby points
there. Projected screen: `https://YOUR-PROJECT.web.app/host`.

The seed refuses to run if a game is in progress, because it would erase the
scores. To force it: `FORCE=1 npm run seed`.

## Built-in guardrails (do not "optimize" them if free firebase version)

- A player phone listens to only one document (`games/game`). The cost of an
  information is the cost of sending it to 70 listeners.
- The answer counter is a local variable on the host page. It is never written
  to the database.
- Answers: create only, fixed id `{session}_{qIndex}_{uid}`, server timestamp
  forced by the rules (`at == request.time`).
- The answer key only travels through the seed, into `games/game/private/key`.
- No `writeBatch` anywhere. No `get()` in the rules.
