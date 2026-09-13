import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from "firebase/firestore";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

// Host UID is read from the rules file, so tests follow any change to it.
const rules = readFileSync("firestore.rules", "utf8");
const hostUidMatch = rules.match(/request\.auth\.uid == "([^"]+)"/);
if (!hostUidMatch?.[1]) throw new Error("Host UID not found in firestore.rules");
const HOST_UID = hostUidMatch[1];

const GAME = "game";
let env: RulesTestEnvironment;

const playerDb = () => env.authenticatedContext("player1").firestore();
const otherDb = () => env.authenticatedContext("player2").firestore();
const hostDb = () => env.authenticatedContext(HOST_UID).firestore();

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-quiz-rules",
    firestore: { rules, host: "127.0.0.1", port: 8180 },
  });
});

beforeEach(() => env.clearFirestore());
afterAll(() => env.cleanup());

const answerRef = (db: ReturnType<typeof playerDb>, id: string) =>
  doc(db, "games", GAME, "answers", id);

const validAnswer = (uid: string, q = 0) => ({
  q,
  uid,
  choice: 2,
  at: serverTimestamp(),
  session: "s1",
});

describe("firestore.rules", () => {
  it("accepts a valid answer from a signed-in player", async () => {
    await assertSucceeds(
      setDoc(answerRef(playerDb(), "s1_0_player1"), validAnswer("player1"))
    );
  });

  it("rejects changing an answer already sent", async () => {
    await setDoc(answerRef(playerDb(), "s1_0_player1"), validAnswer("player1"));
    await assertFails(
      setDoc(answerRef(playerDb(), "s1_0_player1"), { ...validAnswer("player1"), choice: 3 })
    );
  });

  it("rejects a made-up timestamp", async () => {
    await assertFails(
      setDoc(answerRef(playerDb(), "s1_0_player1"), {
        ...validAnswer("player1"),
        at: Timestamp.fromMillis(1_000),
      })
    );
  });

  it("rejects writing another player's answer", async () => {
    await assertFails(
      setDoc(answerRef(otherDb(), "s1_0_player1"), validAnswer("player1"))
    );
  });

  it("rejects an answer with an extra field", async () => {
    await assertFails(
      setDoc(answerRef(playerDb(), "s1_0_player1"), {
        ...validAnswer("player1"),
        bonus: 9999,
      })
    );
  });

  it("rejects a non-integer qIndex", async () => {
    await assertFails(
      setDoc(answerRef(playerDb(), "s1_1.5_player1"), {
        ...validAnswer("player1"),
        q: 1.5,
      })
    );
  });

  it("rejects an id that does not match qIndex", async () => {
    await assertFails(
      setDoc(answerRef(playerDb(), "s1_3_player1"), validAnswer("player1", 5))
    );
  });

  it("rejects an id with the wrong session", async () => {
    await assertFails(
      setDoc(answerRef(playerDb(), "autre_0_player1"), validAnswer("player1"))
    );
  });

  it("rejects a player reading private/key", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "games", GAME, "private", "key"), {
        correct: [0, 1, 2],
      });
    });
    await assertFails(getDoc(doc(playerDb(), "games", GAME, "private", "key")));
    await assertSucceeds(getDoc(doc(hostDb(), "games", GAME, "private", "key")));
  });

  it("rejects a player writing games/{g}", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "games", GAME), { phase: "lobby" });
    });
    await assertFails(
      updateDoc(doc(playerDb(), "games", GAME), { phase: "final" })
    );
    await assertSucceeds(
      updateDoc(doc(hostDb(), "games", GAME), { phase: "question" })
    );
  });

  it("rejects a signup with an injected score field", async () => {
    await assertFails(
      setDoc(doc(playerDb(), "games", GAME, "players", "player1"), {
        nickname: "Granny",
        team: "A",
        session: "s1",
        score: 9999,
      })
    );
  });

  it("accepts a valid signup", async () => {
    await assertSucceeds(
      setDoc(doc(playerDb(), "games", GAME, "players", "player1"), {
        nickname: "Granny",
        team: "A",
        session: "s1",
      })
    );
  });

  it("accepts the owner signing up again (new seed, new session)", async () => {
    await setDoc(doc(playerDb(), "games", GAME, "players", "player1"), {
      nickname: "Granny",
      team: "A",
      session: "s1",
    });
    await assertSucceeds(
      setDoc(doc(playerDb(), "games", GAME, "players", "player1"), {
        nickname: "Granny",
        team: "B",
        session: "s2",
      })
    );
  });

  it("rejects a signup for another uid", async () => {
    await assertFails(
      setDoc(doc(otherDb(), "games", GAME, "players", "player1"), {
        nickname: "Lookalike",
        team: "A",
        session: "s1",
      })
    );
  });

  it("rejects a player deleting a players entry", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "games", GAME, "players", "player1"), {
        nickname: "Granny",
        team: "A",
        session: "s1",
      });
    });
    await assertFails(deleteDoc(doc(playerDb(), "games", GAME, "players", "player1")));
    await assertFails(deleteDoc(doc(otherDb(), "games", GAME, "players", "player1")));
  });

  it("accepts the host deleting a players entry (kick)", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "games", GAME, "players", "troll"), {
        nickname: "Ghost", team: "B", session: "s1",
      });
    });
    await assertSucceeds(deleteDoc(doc(hostDb(), "games", GAME, "players", "troll")));
  });

  it("rejects an out of range choice", async () => {
    await assertFails(
      setDoc(answerRef(playerDb(), "s1_0_player1"), { ...validAnswer("player1"), choice: 4 })
    );
    await assertFails(
      setDoc(answerRef(playerDb(), "s1_0_player1"), { ...validAnswer("player1"), choice: -1 })
    );
  });

  it("rejects deleting an answer, even by the host", async () => {
    await setDoc(answerRef(playerDb(), "s1_0_player1"), validAnswer("player1"));
    await assertFails(deleteDoc(answerRef(playerDb(), "s1_0_player1")));
    await assertFails(deleteDoc(answerRef(hostDb(), "s1_0_player1")));
  });

  it("rejects a nickname made only of spaces", async () => {
    await assertFails(
      setDoc(doc(playerDb(), "games", GAME, "players", "player1"), {
        nickname: "   ",
        team: "A",
        session: "s1",
      })
    );
  });

  it("rejects a player reading players entries", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "games", GAME, "players", "player2"), {
        nickname: "Other", team: "B", session: "s1",
      });
    });
    await assertFails(getDoc(doc(playerDb(), "games", GAME, "players", "player2")));
  });

  it("rejects reading the game without auth", async () => {
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), "games", GAME)));
  });
});
