import "./config.js"; // 启动时校验环境变量
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { config } from "./config.js";

const app = createApp();

console.log(`🚀 Agent Service 启动于 http://localhost:${config.port}`);
console.log(`   Provider: ${config.provider}`);
console.log(`   健康检查: http://localhost:${config.port}/api/health`);

serve({
  fetch: app.fetch,
  port: config.port,
});
