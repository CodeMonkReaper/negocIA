import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import type { NextConfig } from "next";

const baseDir = process.env.INIT_CWD ?? process.cwd();
loadDotenv({ path: resolve(baseDir, ".env"), quiet: true });

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_API_URL: apiUrl,
  },
};

export default nextConfig;