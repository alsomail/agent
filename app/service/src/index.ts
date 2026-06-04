import "./config.js"; // 启动时校验环境变量
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";

const port = Number.parseInt(process.env.PORT ?? "3001", 10);

const app = createApp();

console.log(`🚀 Agent Service 启动于 http://localhost:${port}`);
console.log(`   健康检查: http://localhost:${port}/api/health`);

serve({
  fetch: app.fetch,
  port,
});
