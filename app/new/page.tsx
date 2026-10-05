import { MasterChoice } from "@/components/master-choice";
import { TaskShell } from "@/components/task-shell";
import { requireUser } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { layoutOf } from "@/lib/master/layout";
import { masterChoices } from "@/lib/master/store";

export const dynamic = "force-dynamic";

/**
 * A new deck starts by picking its master: the built-ins, then the masters
 * of the files the member imported. A deck keeps the master it is made on.
 */
export default async function NewDeck() {
  const user = await requireUser();
  const choices = await masterChoices(sql, user.sub);
  return (
    <TaskShell title="新增簡報" lang="zh-TW">
      <ul className="grid grid-cols-1 gap-x-5 gap-y-10 sm:grid-cols-2 2xl:grid-cols-3">
        {choices.map(({ ref, master }) => (
          <MasterChoice
            key={ref}
            masterRef={ref}
            name={master.name}
            layout={layoutOf({ master }, undefined)}
          />
        ))}
      </ul>
    </TaskShell>
  );
}
