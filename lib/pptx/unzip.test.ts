import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { unzip, ZipError } from "./unzip";

const LIMITS = {
  entries: 10,
  entryBytes: 1024 * 1024,
  totalBytes: 2 * 1024 * 1024,
};
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return (error as ZipError).code;
  }
  return "ok";
};

/** Offsets of every central directory entry in a zip. */
function centrals(zip: Uint8Array): number[] {
  const view = new DataView(zip.buffer);
  const out: number[] = [];
  for (let i = 0; i + 4 <= zip.length; i++) {
    if (view.getUint32(i, true) === 0x02014b50) out.push(i);
  }
  return out;
}

describe("unzip", () => {
  it("reads the entries of an ordinary zip", () => {
    const files = unzip(
      zipSync({ "a.xml": strToU8("<a/>"), "b.bin": new Uint8Array(5000) }),
      LIMITS
    );
    expect(new TextDecoder().decode(files.get("a.xml"))).toBe("<a/>");
    expect(files.get("b.bin")?.length).toBe(5000);
  });

  it("stops an entry that inflates past its declared size", () => {
    // 50 MB of zeros, declared as 100 bytes in both headers.
    const zip = zipSync(
      { "bomb.xml": new Uint8Array(50 * 1024 * 1024) },
      { level: 9 }
    );
    const view = new DataView(zip.buffer);
    for (const at of centrals(zip)) view.setUint32(at + 24, 100, true);
    const started = Date.now();
    expect(code(() => unzip(zip, LIMITS))).toBe("malformed");
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("refuses entries that share their data", () => {
    const zip = zipSync(
      { "a.xml": strToU8("<a/>"), "b.xml": strToU8("<b/>") },
      { level: 0 }
    );
    const view = new DataView(zip.buffer);
    const [first, second] = centrals(zip);
    view.setUint32(second + 42, view.getUint32(first + 42, true), true);
    expect(code(() => unzip(zip, LIMITS))).toBe("malformed");
  });

  it("refuses more entries, or more bytes, than the limits", () => {
    const many = Object.fromEntries(
      Array.from({ length: 11 }, (_, i) => [`f${i}.xml`, strToU8("x")])
    );
    expect(code(() => unzip(zipSync(many), LIMITS))).toBe("too-large");
    expect(
      code(() =>
        unzip(
          zipSync({ "big.bin": new Uint8Array(LIMITS.entryBytes + 1) }),
          LIMITS
        )
      )
    ).toBe("too-large");
  });

  it("refuses what is not a zip", () => {
    expect(code(() => unzip(strToU8("not a zip at all, sorry"), LIMITS))).toBe(
      "not-zip"
    );
  });
});
