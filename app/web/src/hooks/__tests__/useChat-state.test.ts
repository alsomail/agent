import type { StreamEvent } from "@myagent/protocol";
import { describe, expect, it } from "vitest";
import { applyStreamEvent, createStreamingState } from "../useChat.js";

describe("applyStreamEvent state transitions", () => {
  it("进入 tool_executing 时将 pending tool 状态切到 executing", () => {
    const events: StreamEvent[] = [
      { type: "tool_call_start", toolCallId: "toolu_1", toolName: "calculator" },
      {
        type: "tool_call_delta",
        toolCallId: "toolu_1",
        partialJson: '{"a":8,"b":9,"operator":"*"}',
      },
      { type: "state_change", state: "tool_executing" },
    ];

    const finalState = events.reduce(
      (state, event) => applyStreamEvent(state, event),
      createStreamingState(),
    );

    expect(finalState.pendingToolCalls).toEqual([
      {
        toolCallId: "toolu_1",
        toolName: "calculator",
        partialJson: '{"a":8,"b":9,"operator":"*"}',
        status: "executing",
      },
    ]);
    expect(finalState.agentState).toBe("tool_executing");
  });
});
