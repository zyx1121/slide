import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

import type { McpEnv } from "./oauth";
import { bearer, verifyAccessToken } from "./token";

const env: McpEnv = {
  appUrl: new URL("https://slide.example.org"),
  issuer: new URL("https://auth.example.org/realms/lab"),
  clientId: "slide-mcp",
  audience: "slide-mcp",
  secret: "s".repeat(64),
};

let privateKey: CryptoKey;
let keys: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256" };
  keys = createLocalJWKSet({ keys: [jwk] });
});

async function tokenWith(
  claims: Record<string, unknown>,
  expires = "5m",
  audience = "slide-mcp"
) {
  return new SignJWT({ azp: "slide-mcp", name: "Alice", ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer("https://auth.example.org/realms/lab")
    .setAudience(audience)
    .setSubject("alice-sub")
    .setIssuedAt()
    .setExpirationTime(expires)
    .sign(privateKey);
}

describe("verifyAccessToken", () => {
  it("names the member of a valid token", async () => {
    expect(
      await verifyAccessToken(env, await tokenWith({}), keys)
    ).toMatchObject({
      sub: "alice-sub",
      name: "Alice",
    });
  });

  it("refuses a token of another client, audience, issuer or time", async () => {
    expect(
      await verifyAccessToken(env, await tokenWith({ azp: "slide" }), keys)
    ).toBeNull();
    const other = await new SignJWT({ azp: "slide-mcp" })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer("https://auth.example.org/realms/other")
      .setAudience("slide-mcp")
      .setSubject("alice-sub")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    expect(await verifyAccessToken(env, other, keys)).toBeNull();
    expect(
      await verifyAccessToken(env, await tokenWith({}, "5m", "account"), keys)
    ).toBeNull();
    expect(
      await verifyAccessToken(env, await tokenWith({}, "-1m"), keys)
    ).toBeNull();
    expect(await verifyAccessToken(env, "not.a.token", keys)).toBeNull();
  });

  it("refuses the ID token Keycloak issues alongside", async () => {
    expect(
      await verifyAccessToken(env, await tokenWith({ typ: "ID" }), keys)
    ).toBeNull();
    expect(
      await verifyAccessToken(env, await tokenWith({ typ: "Bearer" }), keys)
    ).not.toBeNull();
  });

  it("reads only a well-formed bearer header", () => {
    const at = (value: string) =>
      new Request("https://x/", { headers: { authorization: value } });
    expect(bearer(at("Bearer abc.def"))).toBe("abc.def");
    expect(bearer(at("Basic abc"))).toBeNull();
    expect(bearer(at("Bearer a b"))).toBeNull();
  });
});
