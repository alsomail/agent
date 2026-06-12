import { describe, expect, it } from "vitest";
import { createCurrentTimeTool } from "../current-time.js";

describe("current_time tool", () => {
  it("固定 clock 下输出稳定结果", async () => {
    const tool = createCurrentTimeTool({
      clock: () => new Date("2026-06-10T08:09:10.000Z"),
    });

    await expect(tool.execute({ timeZone: "UTC" }, { sessionId: "session-1" })).resolves.toEqual({
      content: "2026-06-10 08:09:10 UTC",
      isError: false,
    });
  });
});
