import Link from "next/link";

import { CornerTip, cornerLink } from "@/components/corners";

/** The home page's top-right action: pick a master for a new deck. */
export function NewDeckButton() {
  return (
    <CornerTip tip="選母片，建立新簡報">
      <Link href="/new" className={cornerLink}>
        新增
      </Link>
    </CornerTip>
  );
}
