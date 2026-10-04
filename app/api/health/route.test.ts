import { afterEach, describe, expect, it } from "vitest";

import { GET } from "./route";

const KEYS = [
  "APP_URL",
  "OIDC_ISSUER",
  "OIDC_CLIENT_ID",
  "OIDC_CLIENT_SECRET",
  "SESSION_SECRET",
  "ALLOWED_EMAILS",
];
const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("GET /api/health", () => {
  it("is unhealthy when the sign-in settings are missing", async () => {
    for (const key of KEYS) delete process.env[key];
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: "error",
      config: "sign-in settings are missing",
    });
  });
});
