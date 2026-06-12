import type { ToolInputSchema } from "@myagent/protocol";
import { describe, expect, it } from "vitest";
import { createToolRegistry } from "../registry.js";
import type { ToolExecutor } from "../types.js";

function createTestTool(name: string): ToolExecutor {
  const inputSchema: ToolInputSchema = {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  };

  return {
    name,
    description: `${name} description`,
    inputSchema,
    async execute() {
      return { content: `${name} result`, isError: false };
    },
  };
}

describe("Tool Registry", () => {
  it("注册后可按名称查找工具", () => {
    const calculator = createTestTool("calculator");
    const registry = createToolRegistry([calculator]);

    expect(registry.get("calculator")).toBe(calculator);
    expect(registry.list()).toEqual([calculator]);
  });

  it("导出 protocol 工具定义", () => {
    const registry = createToolRegistry([createTestTool("current_time")]);

    expect(registry.definitions()).toEqual([
      {
        name: "current_time",
        description: "current_time description",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
          additionalProperties: false,
        },
      },
    ]);
  });

  it("重复工具名直接失败", () => {
    expect(() =>
      createToolRegistry([createTestTool("calculator"), createTestTool("calculator")]),
    ).toThrow(/重复|duplicate/i);
  });

  it("非法工具名直接失败", () => {
    expect(() => createToolRegistry([createTestTool("Bad-Tool")])).toThrow(/工具名/i);
  });
});
