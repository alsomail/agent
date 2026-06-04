import type { Session } from "@myagent/protocol";

export const sessionStore = new Map<string, Session>();
export const systemPromptStore = new Map<string, string>();
