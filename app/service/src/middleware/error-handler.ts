import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { logger } from "../utils/logger.js";

export function errorHandler(err: Error, c: Context) {
  if (err instanceof HTTPException) {
    logger.warn("HTTP exception", { path: c.req.path, status: err.status, message: err.message });
    return c.json(
      { success: false, error: { code: "HTTP_ERROR", message: err.message } },
      err.status as ContentfulStatusCode,
    );
  }

  logger.error("Unhandled service error", {
    path: c.req.path,
    message: err.message,
    stack: err.stack,
  });
  return c.json(
    {
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    },
    500,
  );
}
