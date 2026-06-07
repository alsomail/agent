import { Hono } from "hono";
import { initDb } from "./db/index.js";
import { runMigrations } from "./db/migrate.js";
import { corsMiddleware } from "./middleware/cors.js";
import { errorHandler } from "./middleware/error-handler.js";
import { loggerMiddleware } from "./middleware/logger.js";
import { chatRoute } from "./routes/chat.js";
import { healthRoute } from "./routes/health.js";
import { providerRoute } from "./routes/provider.js";
import { sessionRoute } from "./routes/session.js";

export function createApp(): Hono {
  // 初始化数据库
  const db = initDb();
  runMigrations(db);
  console.log("[DB] 数据库已初始化");

  const app = new Hono();

  // 全局中间件
  app.use("*", corsMiddleware);
  app.use("*", loggerMiddleware);

  // 路由
  app.route("/api/health", healthRoute);
  app.route("/api/session", sessionRoute);
  app.route("/api/session", chatRoute);
  app.route("/api", providerRoute); // /api/providers, /api/models

  // 全局错误处理
  app.onError(errorHandler);

  return app;
}

// 导出 AppType 供前端 RPC 客户端使用
export type AppType = ReturnType<typeof createApp>;
