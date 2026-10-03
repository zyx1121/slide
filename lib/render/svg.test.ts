import { describe, expect, it } from "vitest";

import { sampleDocument } from "../deck/sample";
import type { Slide } from "../deck/schema";
import { renderSlideSvg } from "./svg";

const options = {
  slideNumber: 1,
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
});
