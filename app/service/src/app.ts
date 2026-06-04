import { Hono } from "hono";
import { corsMiddleware } from "./middleware/cors.js";
import { errorHandler } from "./middleware/error-handler.js";
import { loggerMiddleware } from "./middleware/logger.js";
import { chatRoute } from "./routes/chat.js";
import { healthRoute } from "./routes/health.js";
import { sessionRoute } from "./routes/session.js";

export function createApp(): Hono {
  const app = new Hono();

  // 全局中间件
  app.use("*", corsMiddleware);
  app.use("*", loggerMiddleware);

  // 路由
  app.route("/api/health", healthRoute);
  app.route("/api/session", sessionRoute);
  app.route("/api/session", chatRoute);

  // 全局错误处理
  app.onError(errorHandler);

  return app;
}

// 导出 AppType 供前端 RPC 客户端使用
export type AppType = ReturnType<typeof createApp>;
