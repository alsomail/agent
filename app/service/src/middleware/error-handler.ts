import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export function errorHandler(err: Error, c: Context) {
  if (err instanceof HTTPException) {
    return c.json(
      { success: false, error: { code: "HTTP_ERROR", message: err.message } },
      err.status as ContentfulStatusCode,
    );
  }

  console.error("[Error]", err);
  return c.json(
    {
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    },
    500,
  );
}
