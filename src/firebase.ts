import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, initializeFirestore } from "firebase/firestore";
import { firebaseConfig, GAME_ID } from "./firebase-config";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
// Safari can freeze the WebChannel stream after the first snapshot.
export const db = initializeFirestore(app, { experimentalAutoDetectLongPolling: true });

export { GAME_ID };

// Also a LAN address, to test from a real phone on the same wifi.
export const onEmulator =
  /^(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|.+\.local)$/.test(
    location.hostname
  );

if (onEmulator) {
  connectAuthEmulator(auth, `http://${location.hostname}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(db, location.hostname, 8180);
}
