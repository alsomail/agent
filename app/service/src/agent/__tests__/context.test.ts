import { describe, expect, it } from "vitest";
import { estimateTokenCount } from "../token.js";

describe("estimateTokenCount", () => {
  it("纯中文按每字 1 token 计算", () => {
    expect(estimateTokenCount("你好世界")).toBe(4);
  });

  it("空字符串返回 0", () => {
    expect(estimateTokenCount("")).toBe(0);
  });

  it("纯英文按 4 字符 1 token 计算", () => {
    // "hello world" = 11 chars → ceil(11/4) = 3
    expect(estimateTokenCount("hello world")).toBe(3);
  });

  it("中英混合正确计算", () => {
    // "你好hello" = 2 中文 + 5 英文 → 2 + ceil(5/4) = 2 + 2 = 4
    expect(estimateTokenCount("你好hello")).toBe(4);
  });

  it("含日语假名按 CJK 处理", () => {
    // "こんにちは" = 5 CJK chars → 5
    expect(estimateTokenCount("こんにちは")).toBe(5);
  });
});
