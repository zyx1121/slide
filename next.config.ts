import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Docker image runs the standalone server (see Dockerfile).
  output: "standalone",
  // resvg is a native module; load it from node_modules at run time.
  serverExternalPackages: ["@resvg/resvg-js"],
};

export default nextConfig;
