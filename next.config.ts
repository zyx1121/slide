import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Docker image runs the standalone server (see Dockerfile).
  output: "standalone",
  // No framework banner in responses.
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Browsers keep to https for a year once they have seen the site
          // over https (they ignore the header over plain http). Not for
          // subdomains: the parent domain's other sites are not this app's.
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
        ],
      },
      {
        // The MCP consent page is never shown inside another site's frame.
        source: "/oauth/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        ],
      },
    ];
  },
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
