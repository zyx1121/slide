import type { DeckDocument } from "./schema";

/**
 * A small deck in the shape WinLab slides take: boxes with text, connectors
 * glued to them, a text box and a picture. Tests and renderer snapshots use it.
 */
export function sampleDocument(): DeckDocument {
  return {
    schema: 1,
    title: "Agent Sense",
    slides: [
      {
        id: "sl_overview",
        title: "System overview",
        shapes: [
          {
            id: "sh_capture",
            kind: "roundRect",
            x: 160,
            y: 320,
            w: 480,
            h: 200,
            corner: 0.16,
            fill: "#e8f1fe",
            stroke: { color: "#4f81bd", width: 3 },
            text: {
              anchor: "middle",
              paragraphs: [
                {
                  align: "center",
                  runs: [{ text: "Audio capture", size: 48, bold: true }],
                },
              ],
            },
          },
          {
            id: "sh_asr",
            kind: "roundRect",
            x: 1280,
            y: 320,
            w: 480,
            h: 200,
            fill: "#e8f1fe",
            stroke: { color: "#4f81bd", width: 3 },
            text: {
              anchor: "middle",
              paragraphs: [
                { align: "center", runs: [{ text: "語音辨識", size: 48 }] },
              ],
            },
          },
          {
            id: "sh_router",
            kind: "ellipse",
            x: 1280,
            y: 720,
            w: 480,
            h: 200,
            fill: null,
            stroke: { color: "#4f81bd", width: 3, dash: "dash" },
          },
          {
            id: "ln_capture_asr",
            kind: "line",
            route: "straight",
            start: { shape: "sh_capture", site: 3 },
            end: { shape: "sh_asr", site: 1 },
            stroke: { color: "#4f81bd", width: 4 },
            endArrow: "triangle",
          },
          {
            id: "ln_capture_router",
            kind: "line",
            route: "elbow",
            start: { shape: "sh_capture", site: 2 },
            end: { shape: "sh_router", site: 1 },
            stroke: { color: "#4f81bd", width: 4 },
            endArrow: "triangle",
          },
          {
            id: "tx_note",
            kind: "text",
            x: 160,
            y: 900,
            w: 900,
            h: 80,
            text: {
              paragraphs: [
                {
                  bullet: "bullet",
                  runs: [
                    { text: "ASR: ", bold: true },
                    { text: "Automatic Speech Recognition" },
                  ],
                },
              ],
            },
          },
          {
            id: "im_demo",
            kind: "image",
            x: 760,
            y: 600,
            w: 400,
            h: 225,
            asset:
              "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
          },
        ],
      },
    ],
  };
}
