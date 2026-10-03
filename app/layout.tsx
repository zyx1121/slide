import type { Metadata } from "next";

import { ThemeProvider } from "@/components/theme-provider";
import { fontVariables } from "@/lib/fonts";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: "slide", template: "%s · slide" },
  description: "在瀏覽器裡畫 WinLab 投影片，讓 agent 透過 MCP 幫你改。",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // Dark is rendered on the server, so the first paint and pages without
    // JavaScript are dark too; next-themes takes over on the client.
    <html
      lang="zh-TW"
      className={`${fontVariables} dark antialiased`}
      suppressHydrationWarning
    >
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
