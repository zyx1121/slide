import Link from "next/link";

import { CornerTip, cornerLink } from "@/components/corners";
import type { SessionUser } from "@/lib/auth/session";

/**
 * The top-right corner for a signed-in member: the deck list and sign-out.
 * Sign-out's tip names who is signed in, which its label leaves out.
 */
export function AccountActions({
  user,
  current,
}: {
  user: SessionUser;
  current?: "decks";
}) {
  return (
    <>
      <Link
        href="/"
        aria-current={current === "decks" ? "page" : undefined}
        className={cornerLink}
      >
        簡報
      </Link>
      <form action="/auth/logout" method="post" className="flex">
        <CornerTip tip={`已登入：${user.name || user.email}`}>
          <button type="submit" className={cornerLink}>
            登出
          </button>
        </CornerTip>
      </form>
    </>
  );
}
