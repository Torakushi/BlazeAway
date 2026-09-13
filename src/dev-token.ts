// Emulator only: it takes unsigned tokens, so the dev host gets a fixed UID. Prod rejects them.
export const DEV_HOST_UID = "dev-host-fixed-uid";

function b64url(s: string): string {
  const b = typeof btoa === "function" ? btoa(s) : Buffer.from(s).toString("base64");
  return b.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function devHostToken(): string {
  const header = b64url(JSON.stringify({ alg: "none", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(
    JSON.stringify({
      uid: DEV_HOST_UID,
      iat: now,
      exp: now + 3600,
      aud: "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit",
      iss: "firebase-auth-emulator@example.com",
      sub: "firebase-auth-emulator@example.com",
    })
  );
  return `${header}.${payload}.`;
}
