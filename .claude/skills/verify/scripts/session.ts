// Prints a session cookie value for the verification member, sealed with the
// run's SESSION_SECRET by the app's own sealSession. The secret comes from
// the run's .env and never reaches argv. Needs this checkout's node_modules.
//
//   bun .claude/skills/verify/scripts/session.ts <run dir>
import { readFileSync } from "node:fs";

import { sealSession } from "../../../../lib/auth/session";

const run = process.argv[2];
if (!run) throw new Error("usage: session.ts <run dir>");
const env = readFileSync(`${run}/.env`, "utf8");
const secret = env.match(/^SESSION_SECRET=(.+)$/m)?.[1];
if (!secret) throw new Error(`${run}/.env has no SESSION_SECRET`);

process.stdout.write(
  await sealSession(
    {
      sub: "verify-member",
      name: "Verify Member",
      email: "verify@example.test",
    },
    secret
  )
);
