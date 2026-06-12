import { z } from "zod";
import type { ToolExecutor } from "../types.js";

const CalculatorInputSchema = z
  .object({
    a: z.number().finite(),
    b: z.number().finite(),
    operator: z.enum(["+", "-", "*", "/"]),
  })
  .strict();

export function createCalculatorTool(): ToolExecutor {
  return {
    name: "calculator",
    description: "Perform deterministic arithmetic on two numbers.",
    inputSchema: {
      type: "object",
      properties: {
        a: { type: "number", description: "The left operand." },
        b: { type: "number", description: "The right operand." },
        operator: {
          type: "string",
          description: "The arithmetic operator to apply.",
          enum: ["+", "-", "*", "/"],
        },
      },
      required: ["a", "b", "operator"],
      additionalProperties: false,
    },
    async execute(input) {
      const parsed = CalculatorInputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          content: `工具参数无效: ${parsed.error.issues[0]?.message ?? "invalid input"}`,
          isError: true,
        };
      }

      const { a, b, operator } = parsed.data;
      if (operator === "/" && b === 0) {
        return {
          content: "除数不能为 0",
          isError: true,
        };
      }

      const result = calculate(a, b, operator);
      return {
        content: String(result),
        isError: false,
      };
    },
  };
}

function calculate(a: number, b: number, operator: "+" | "-" | "*" | "/"): number {
  switch (operator) {
    case "+":
      return a + b;
    case "-":
      return a - b;
    case "*":
      return a * b;
    case "/":
      return a / b;
  }
}
