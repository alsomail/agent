import { createMiddleware } from "hono/factory";
import { logger } from "../utils/logger.js";

export const loggerMiddleware = createMiddleware(async (c, next) => {
  const start = Date.now();
  const method = c.req.method;
  const path = c.req.path;

  await next();

  const duration = Date.now() - start;
  logger.info("HTTP request completed", {
    method,
    path,
    status: c.res.status,
    durationMs: duration,
  });
});
