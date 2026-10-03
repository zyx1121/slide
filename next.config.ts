import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Docker image runs the standalone server (see Dockerfile).
  output: "standalone",
  // resvg is a native module; load it from node_modules at run time.
  serverExternalPackages: ["@resvg/resvg-js"],
  // lib/render/png.ts reads fonts/slide and public/ through paths built at
  // run time, which makes the tracer pull in the whole project. The image
  // copies both folders itself (Dockerfile), so keep sources out of the trace.
  outputFileTracingExcludes: {
    "/*": [
      "./app/**/*",
      "./components/**/*",
      "./lib/**/*",
      "./scripts/**/*",
      "./template/**/*",
      "./fonts/**/*",
      "./public/**/*",
      "./migrations/**/*",
      "./types/**/*",
      "./*.md",
    ],
  },
};

export default nextConfig;
