import { ToolNameSchema } from "@myagent/protocol";
import type { ToolDefinition } from "@myagent/protocol";
import { type ToolExecutor, toToolDefinition } from "./types.js";

export interface ToolRegistry {
  list(): ToolExecutor[];
  get(name: string): ToolExecutor | undefined;
  definitions(): ToolDefinition[];
}

class InMemoryToolRegistry implements ToolRegistry {
  readonly #tools: ToolExecutor[];
  readonly #toolMap: Map<string, ToolExecutor>;

  constructor(tools: ToolExecutor[]) {
    this.#toolMap = new Map<string, ToolExecutor>();

    for (const tool of tools) {
      ToolNameSchema.parse(tool.name);
      if (this.#toolMap.has(tool.name)) {
        throw new Error(`重复工具名: ${tool.name}`);
      }
      this.#toolMap.set(tool.name, tool);
    }

    this.#tools = [...tools];
  }

  list(): ToolExecutor[] {
    return [...this.#tools];
  }

  get(name: string): ToolExecutor | undefined {
    return this.#toolMap.get(name);
  }

  definitions(): ToolDefinition[] {
    return this.#tools.map(toToolDefinition);
  }
}

export function createToolRegistry(tools: ToolExecutor[]): ToolRegistry {
  return new InMemoryToolRegistry(tools);
}
