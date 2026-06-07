import type { NormalizedMessage } from "../llm/types/message.js";

// 中文/日文/韩文 Unicode 范围
const CJK_RE = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g;

export function estimateTokenCount(text: string): number {
  const cjkChars = (text.match(CJK_RE) || []).length;
  const otherChars = text.length - cjkChars;
  return Math.ceil(cjkChars + otherChars / 4);
}

export function estimateMessageTokens(msg: NormalizedMessage): number {
  let total = 0;
  total += estimateTokenCount(msg.role);
  for (const block of msg.content) {
    if (block.type === "text") {
      total += estimateTokenCount(block.text);
    } else {
      total += estimateTokenCount(JSON.stringify(block));
    }
  }
  return total || 1; // 至少 1 token
}
