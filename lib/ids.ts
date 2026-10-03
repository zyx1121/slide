// Lowercase letters and digits without look-alikes (0/o, 1/l/i), so ids stay
// easy to read back and to type into an agent prompt.
const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
// The largest multiple of the alphabet size below 256: bytes at or above it
// are drawn again, so every character is equally likely.
const LIMIT = 256 - (256 % ALPHABET.length);

/** A random id such as `sh_k4m9x2qa`. 8 characters give 31^8, about 8.5e11, values. */
export function newId(prefix: string, length = 8): string {
  let body = "";
  while (body.length < length) {
    for (const byte of crypto.getRandomValues(new Uint8Array(length))) {
      if (byte < LIMIT && body.length < length) {
        body += ALPHABET[byte % ALPHABET.length];
      }
    }
  }
  return `${prefix}_${body}`;
}
