import { serve } from "@hono/node-server";
import { createApp } from "./app.js";

const PORT = Number.parseInt(process.env.PORT || "3001", 10);

const app = createApp();

console.log(`🚀 Agent Service 启动于 http://localhost:${PORT}`);
console.log(`   健康检查: http://localhost:${PORT}/api/health`);

serve({
  fetch: app.fetch,
  port: PORT,
});
