// CJK characters (ideographs, kana, Hangul), the scripts written family name first.
const CJK = /^[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]+$/;

const text = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

/**
 * A member's display name. Keycloak sends a first name, a last name, and a
 * `name` of "first last", which reads 詠翔 詹 for a Chinese name; when both
 * parts are CJK the name is written as Taiwan does, last name first with no
 * space (詹詠翔). Other names keep Keycloak's own form.
 */
export function displayName(claims: Record<string, unknown>): string {
  const given = text(claims.given_name);
  const family = text(claims.family_name);
  if (given && family && CJK.test(given) && CJK.test(family)) {
    return `${family}${given}`;
  }
  return (
    text(claims.name) ||
    [given, family].filter(Boolean).join(" ") ||
    text(claims.preferred_username)
  );
}
