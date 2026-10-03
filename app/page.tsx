import Link from "next/link";

import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { listDecks } from "@/lib/deck/store";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await requireUser();
  const decks = await listDecks(sql, user.sub);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 p-8">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">slide</h1>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">
            {user.name || user.email}
          </span>
          <form action="/auth/logout" method="post">
            <Button type="submit" variant="ghost">
              登出
            </Button>
          </form>
        </div>
      </header>

      {decks.length === 0 ? (
        <p className="text-muted-foreground">還沒有簡報。</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {decks.map((deck) => (
            <li key={deck.id}>
              <Link href={`/decks/${deck.id}`} className="hover:underline">
                {deck.title}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
