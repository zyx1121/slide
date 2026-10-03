import { EncryptJWT, jwtDecrypt, type JWTPayload } from "jose";

const keys = new Map<string, Promise<Uint8Array>>();

// AES-256-GCM needs exactly 32 bytes; SHA-256 turns any secret into that.
function keyFor(secret: string): Promise<Uint8Array> {
  let key = keys.get(secret);
  if (!key) {
    key = crypto.subtle
      .digest("SHA-256", new TextEncoder().encode(secret))
      .then((digest) => new Uint8Array(digest));
    keys.set(secret, key);
  }
  return key;
}

/** Encrypts and authenticates a payload (JWE, dir + A256GCM) that expires after `ttlSeconds`. */
export async function seal(
  payload: JWTPayload,
  secret: string,
  ttlSeconds: number
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new EncryptJWT(payload)
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt(now)
    .setExpirationTime(now + ttlSeconds)
    .encrypt(await keyFor(secret));
}

/** The payload, or null when the token is tampered with, expired, or sealed with another secret. */
export async function unseal<T extends JWTPayload>(
  token: string,
  secret: string
): Promise<T | null> {
  try {
    const { payload } = await jwtDecrypt(token, await keyFor(secret), {
      keyManagementAlgorithms: ["dir"],
      contentEncryptionAlgorithms: ["A256GCM"],
    });
    return payload as T;
  } catch {
    return null;
  }
}
