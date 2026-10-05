import { describe, expect, it } from "vitest";

import { sampleDocument } from "../deck/sample";
import type { Slide } from "../deck/schema";
import { BUILTIN_MASTERS, layoutOf } from "../master/layout";
import { renderBackdropSvg, renderSlideSvg } from "./svg";

const winlab = BUILTIN_MASTERS.winlab;
const options = {
  slideNumber: 1,
  layout: layoutOf({ master: winlab }, undefined),
};

describe("renderSlideSvg", () => {
  it("renders the sample slide as it is recorded", async () => {
    const svg = renderSlideSvg(sampleDocument().slides[0], {
      ...options,
      assetHref: (sha) => `/assets/${sha}`,
    });
    await expect(svg).toMatchFileSnapshot("__snapshots__/sample-slide.svg");
  });

  it("is a standalone 1920 x 1080 SVG with the layout, title and number", () => {
    const svg = renderSlideSvg(sampleDocument().slides[0], {
      ...options,
      assetHref: (sha) => `/assets/${sha}`,
    });
    expect(svg).toMatch(
      /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 1920 1080"/
    );
    // The layout's gradient background and its artwork's pictures.
    expect(svg).toMatch(/<linearGradient id="gr-[0-9a-z]+"/);
    expect(svg).toMatch(/href="\/assets\/[0-9a-f]{64}"/);
    expect(svg).toContain(">System overview</text>");
    expect(svg).toMatch(
      /font-size="28" fill="#ffffff" font-weight="700"[^>]*>1<\/text>/
    );
  });

  it("escapes text so a deck cannot inject markup", () => {
    const slide: Slide = {
      id: "sl_escape",
      title: '<script>alert(1)</script> & "quotes"',
      shapes: [],
    };
    const svg = renderSlideSvg(slide, { ...options, bare: true });
    expect(svg).not.toContain("<script>");
    expect(svg).toContain(
      "&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quotes&quot;"
    );
  });

  it("turns a rotated shape around its center and splits alpha colors", () => {
    const slide: Slide = {
      id: "sl_turn",
      title: "",
      shapes: [
        {
          id: "sh_turned",
          kind: "rect",
          x: 100,
          y: 100,
          w: 200,
          h: 100,
          rotation: 30,
          fill: "#ff000080",
        },
      ],
    };
    const svg = renderSlideSvg(slide, { ...options, bare: true });
    expect(svg).toContain('<g transform="rotate(30 200 150)">');
    expect(svg).toContain('fill="#ff0000" fill-opacity="0.5"');
  });

  it("draws a placeholder for an image whose bytes it cannot resolve", () => {
    const svg = renderSlideSvg(sampleDocument().slides[0], {
      ...options,
      assetHref: () => null,
    });
    expect(svg).not.toContain("/assets/");
    expect(svg).toContain('fill="#e5e5e5"');
  });

  it("drops characters XML forbids and breaks lines at vertical tabs", () => {
    const slide: Slide = {
      id: "sl_ctrl",
      title: "",
      shapes: [
        {
          id: "tx_ctrl",
          kind: "text",
          x: 100,
          y: 100,
          w: 800,
          h: 300,
          text: {
            paragraphs: [
              { runs: [{ text: "line one\u000bline two\u0001\ufffe" }] },
            ],
          },
        },
      ],
    };
    const svg = renderSlideSvg(slide, { ...options, bare: true });
    // eslint-disable-next-line no-control-regex
    expect(svg).not.toMatch(
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/
    );
    expect(svg).toContain(">line one</text>");
    expect(svg).toContain(">line two</text>");
  });

  it("escapes asset hrefs and draws arrowheads at both ends", () => {
    const doc = sampleDocument();
    const line = doc.slides[0].shapes.find((s) => s.id === "ln_capture_asr");
    if (!line || line.kind !== "line") throw new Error("fixture");
    line.startArrow = "oval";
    const svg = renderSlideSvg(doc.slides[0], {
      ...options,
      assetHref: () => 'x" onload="alert(1)',
    });
    expect(svg).toContain('href="x&quot; onload=&quot;alert(1)"');
    expect(svg).not.toContain('onload="alert');
    // The oval sits on the start site (640, 420) of ln_capture_asr.
    expect(svg).toMatch(
      /<ellipse cx="640" cy="420" rx="6" ry="6" fill="#4f81bd"\/>/
    );
  });

  it("never slants CJK text", () => {
    const slide: Slide = {
      id: "sl_italic",
      title: "",
      shapes: [
        {
          id: "tx_italic",
          kind: "text",
          x: 0,
          y: 0,
          w: 1000,
          h: 200,
          text: {
            paragraphs: [{ runs: [{ text: "語音 speech", italic: true }] }],
          },
        },
      ],
    };
    const svg = renderSlideSvg(slide, { ...options, bare: true });
    expect(svg).toMatch(
      /<text[^>]*class="cjk"(?![^>]*font-style)[^>]*>語音 <\/text>/
    );
    expect(svg).toMatch(/<text[^>]*font-style="italic"[^>]*>speech<\/text>/);
  });
});

describe("renderSlideSvg on the plain master", () => {
  it("draws a black title and a gray number on white, with no background", () => {
    const plain = BUILTIN_MASTERS.plain;
    const svg = renderSlideSvg(sampleDocument().slides[0], {
      slideNumber: 4,
      layout: plain.layouts[plain.layout],
    });
    expect(svg).not.toContain("<image");
    expect(svg).toMatch(
      /fill="#000000" font-weight="700"[^>]*>System overview</
    );
    expect(svg).toMatch(
      /font-size="28" fill="#7f7f7f"(?![^>]*font-weight)[^>]*>4<\/text>/
    );
  });
});

describe("renderBackdropSvg", () => {
  it("draws a layout's background and artwork, and no title or number", () => {
    const svg = renderBackdropSvg(layoutOf({ master: winlab }, undefined), {
      assetHref: (sha) => `/assets/${sha}`,
    });
    expect(svg).toMatch(/<linearGradient id="gr-[0-9a-z]+"/);
    expect(svg).toContain(">NYCU CS</text>");
    expect(svg).not.toContain("System overview");
  });

  it("names gradients by what they hold, so pages of several masters agree", () => {
    const a = renderBackdropSvg(layoutOf({ master: winlab }, { layout: 0 }), {
      assetHref: () => null,
    });
    const b = renderBackdropSvg(layoutOf({ master: winlab }, { layout: 0 }), {
      assetHref: () => null,
    });
    expect(a).toBe(b);
    const ids = (svg: string) =>
      [...svg.matchAll(/id="(gr-[0-9a-z]+)"/g)].map((m) => m[1]);
    expect(new Set(ids(a)).size).toBe(ids(a).length);
  });
});

describe("backgrounds and path gradients", () => {
  const plain = layoutOf({ master: BUILTIN_MASTERS.plain }, undefined);

  it("stretches a picture background, through the asset href", () => {
    const svg = renderBackdropSvg(
      { ...plain, background: { image: "a".repeat(64) } },
      { assetHref: (sha) => `/assets/${sha}` }
    );
    expect(svg).toContain(
      `<image href="/assets/${"a".repeat(64)}" width="1920" height="1080" preserveAspectRatio="none"/>`
    );
    expect(
      renderBackdropSvg(
        { ...plain, background: { image: "a".repeat(64) } },
        { assetHref: () => null }
      )
    ).not.toContain("<image");
  });

  it("draws a path gradient as a circle from its focus", () => {
    const svg = renderBackdropSvg(
      {
        ...plain,
        background: {
          path: "circle",
          focus: { x: 0.5, y: 0.5 },
          stops: [
            { at: 0, color: "#ffffff" },
            { at: 1, color: "#000000" },
          ],
        },
      },
      { assetHref: () => null }
    );
    expect(svg).toMatch(
      /<radialGradient id="gr-[0-9a-z]+" gradientUnits="userSpaceOnUse" cx="960" cy="540" r="1101.45">/
    );
  });
});
