import { describe, expect, it } from "vitest";
import { getModelCapabilityBadgeViewModel } from "../ModelCapabilityBadge.js";

describe("getModelCapabilityBadgeViewModel", () => {
  it("unknown 状态提供手动探测入口", () => {
    const viewModel = getModelCapabilityBadgeViewModel(
      {
        identity: { provider: "ollama", name: "qwen3:8b" },
        tools: { status: "unknown", source: "none", confidence: 0 },
      },
      false,
    );

    expect(viewModel.title).toBe("Tools 状态未知");
    expect(viewModel.actionLabel).toBe("开始探测");
  });

  it("unsupported 状态提示纯文本模式且不提供探测按钮", () => {
    const viewModel = getModelCapabilityBadgeViewModel(
      {
        identity: { provider: "ollama", name: "qwen3:8b" },
        tools: { status: "unsupported", source: "cache", confidence: 0.8 },
      },
      false,
    );

    expect(viewModel.title).toBe("纯文本模式");
    expect(viewModel.actionLabel).toBeNull();
  });

  it("error 状态提供重试入口", () => {
    const viewModel = getModelCapabilityBadgeViewModel(
      {
        identity: { provider: "ollama", name: "qwen3:8b" },
        tools: {
          status: "error",
          source: "runtime_probe",
          confidence: 0,
          lastProbeError: "network down",
        },
      },
      false,
    );

    expect(viewModel.title).toBe("探测失败");
    expect(viewModel.actionLabel).toBe("重试探测");
  });
});
