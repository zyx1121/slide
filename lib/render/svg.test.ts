import { describe, expect, it } from "vitest";

import { sampleDocument } from "../deck/sample";
import type { Slide } from "../deck/schema";
import { renderSlideSvg } from "./svg";

const options = {
  slideNumber: 1,
  template: "winlab" as const,
  background: "/template/winlab-background.png",
};

describe("renderSlideSvg", () => {
  it("renders the sample slide as it is recorded", async () => {
    const svg = renderSlideSvg(sampleDocument().slides[0], {
      ...options,
      assetHref: (sha) => `/assets/${sha}`,
    });
    await expect(svg).toMatchFileSnapshot("__snapshots__/sample-slide.svg");
  });

  it("is a standalone 1920 x 1080 SVG with the template, title and number", () => {
    const svg = renderSlideSvg(sampleDocument().slides[0], options);
    expect(svg).toMatch(
      /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 1920 1080"/
    );
    expect(svg).toContain('href="/template/winlab-background.png"');
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
    const svg = renderSlideSvg(slide, { ...options, background: null });
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
    const svg = renderSlideSvg(slide, { ...options, background: null });
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
    const svg = renderSlideSvg(slide, { ...options, background: null });
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
    const svg = renderSlideSvg(slide, { ...options, background: null });
    expect(svg).toMatch(
      /<text[^>]*class="cjk"(?![^>]*font-style)[^>]*>語音 <\/text>/
    );
    expect(svg).toMatch(/<text[^>]*font-style="italic"[^>]*>speech<\/text>/);
  });
});

describe("renderSlideSvg on the plain template", () => {
  it("draws a black title and a gray number on white, with no background", () => {
    const svg = renderSlideSvg(sampleDocument().slides[0], {
      slideNumber: 4,
      template: "plain",
      background: null,
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
