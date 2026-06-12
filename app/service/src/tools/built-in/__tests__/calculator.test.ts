import { describe, expect, it } from "vitest";
import { createCalculatorTool } from "../calculator.js";

describe("calculator tool", () => {
  const tool = createCalculatorTool();
  const context = { sessionId: "session-1" };

  it("执行四则运算", async () => {
    await expect(tool.execute({ a: 17, b: 23, operator: "*" }, context)).resolves.toEqual({
      content: "391",
      isError: false,
    });
  });

  it("非法参数返回可见错误", async () => {
    await expect(tool.execute({ a: 1, operator: "*" }, context)).resolves.toEqual({
      content: expect.stringMatching(/参数|invalid/i),
      isError: true,
    });
  });

  it("不执行任意代码表达式", async () => {
    await expect(
      tool.execute(
        {
          a: "globalThis.process.exit(1)",
          b: 1,
          operator: "+",
        },
        context,
      ),
    ).resolves.toEqual({
      content: expect.stringMatching(/参数|invalid/i),
      isError: true,
    });
  });
});
