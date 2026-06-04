import { z } from "zod";

// 统一的 API 成功响应
export const ApiSuccessResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    success: z.literal(true),
    data: dataSchema,
  });

// 统一的 API 错误响应
export const ApiErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

// 错误码枚举
export const ErrorCodeEnum = z.enum([
  "VALIDATION_ERROR",
  "NOT_FOUND",
  "INTERNAL_ERROR",
  "STREAM_ERROR",
  "LLM_ERROR",
  "RATE_LIMIT",
  "AUTH_ERROR",
]);

export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;
export type ErrorCode = z.infer<typeof ErrorCodeEnum>;
