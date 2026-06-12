import { z } from "zod";
import type { ToolExecutor } from "../types.js";

const CurrentTimeInputSchema = z
  .object({
    timeZone: z.string().min(1).optional(),
    locale: z.string().min(1).optional(),
  })
  .strict();

export function createCurrentTimeTool(options?: {
  clock?: () => Date;
}): ToolExecutor {
  const clock = options?.clock ?? (() => new Date());

  return {
    name: "current_time",
    description: "Return the current date and time in a readable format.",
    inputSchema: {
      type: "object",
      properties: {
        timeZone: {
          type: "string",
          description: "Optional IANA time zone, for example Asia/Shanghai or UTC.",
        },
        locale: {
          type: "string",
          description: "Optional BCP 47 locale, for example en-US or zh-CN.",
        },
      },
      required: [],
      additionalProperties: false,
    },
    async execute(input) {
      const parsed = CurrentTimeInputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          content: `工具参数无效: ${parsed.error.issues[0]?.message ?? "invalid input"}`,
          isError: true,
        };
      }

      const { timeZone, locale } = parsed.data;
      try {
        return {
          content: formatCurrentTime(clock(), timeZone, locale),
          isError: false,
        };
      } catch (error) {
        return {
          content: error instanceof Error ? error.message : "无法格式化当前时间",
          isError: true,
        };
      }
    },
  };
}

function formatCurrentTime(date: Date, timeZone?: string, locale?: string): string {
  const formatter = new Intl.DateTimeFormat(locale ?? "en-GB", {
    timeZone: timeZone ?? "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const getValue = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${getValue("year")}-${getValue("month")}-${getValue("day")} ${getValue("hour")}:${getValue("minute")}:${getValue("second")} ${timeZone ?? "UTC"}`;
}
