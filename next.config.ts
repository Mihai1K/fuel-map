import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // standalone: самодостаточная сборка для Docker-деплоя (reg.ru VPS);
  // tracing root = само приложение, а не корень монорепо — иначе
  // server.js уезжает в standalone/fullbak/apps/polnyybak/
  output: "standalone",
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
