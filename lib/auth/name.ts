// CJK characters (ideographs including extensions B to F, the iteration marks
// 々〆〇, kana, Hangul), the scripts written family name first.
const CJK =
  /^[\u3005-\u3007\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af\u{20000}-\u{3ffff}]+$/u;

const text = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

/**
 * A member's display name. A provider sends a first name, a last name, and
 * often a `name` of "first last", which reads 詠翔 詹 for a Chinese name;
 * when both parts are CJK the name is written as Taiwan does, last name
 * first with no space (詹詠翔). Other names keep the provider's own form.
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
