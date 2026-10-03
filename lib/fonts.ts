import { Geist_Mono, Noto_Sans_JP, Noto_Sans_TC } from "next/font/google";
import localFont from "next/font/local";

// The fonts behind the theme's --font-sans and --font-mono stacks, as the
// ui.zyx.tw design contract names them (DESIGN.md, Fonts). The root layout
// puts `fontVariables` on <html>.

// Inter 4.1, self-hosted and subset to Latin (fonts/, copied from the
// task-web starter, which takes them from zyx1121/www.zyx.tw). The Google
// Fonts build lacks the ss01 and zero features the theme turns on.
export const inter = localFont({
  src: "../fonts/InterVariable.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  adjustFontFallback: "Arial",
  variable: "--font-inter",
});

// A second call only so the italic is not preloaded; its declaration moves it
// into the family above.
export const interItalic = localFont({
  src: "../fonts/InterVariable-Italic.woff2",
  weight: "100 900",
  style: "italic",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: "font-family", value: "'inter'" }],
});

// CJK after Inter: Noto Sans JP first, Noto Sans TC for the glyphs JP lacks.
// Unicode-range slices without preload, so a page fetches only what it uses.
export const notoSansJp = Noto_Sans_JP({
  display: "swap",
  preload: false,
  variable: "--font-noto-sans-jp",
});

export const notoSansTc = Noto_Sans_TC({
  display: "swap",
  preload: false,
  variable: "--font-noto-sans-tc",
});

// Code only, so it is not preloaded.
export const geistMono = Geist_Mono({
  preload: false,
  variable: "--font-geist-mono",
});

export const fontVariables = [
  inter.variable,
  notoSansJp.variable,
  notoSansTc.variable,
  geistMono.variable,
].join(" ");
