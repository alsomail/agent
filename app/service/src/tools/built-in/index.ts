import type { ToolExecutor } from "../types.js";
import { createCalculatorTool } from "./calculator.js";
import { createCurrentTimeTool } from "./current-time.js";

export function createBuiltInTools(): ToolExecutor[] {
  return [createCalculatorTool(), createCurrentTimeTool()];
}
