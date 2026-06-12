import * as fs from "node:fs";
import * as path from "node:path";

type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

function getProjectRoot(): string {
  const cwd = process.cwd();
  const serviceRootSuffix = path.join("app", "service");
  return cwd.endsWith(serviceRootSuffix) ? path.resolve(cwd, "../..") : cwd;
}

function getLogFilePath(): string {
  const projectRoot = getProjectRoot();
  return path.join(projectRoot, ".data", "logs", "service.log");
}

function ensureLogDir(): void {
  const logPath = getLogFilePath();
  const dir = path.dirname(logPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function serializeMeta(meta?: unknown): string {
  if (meta === undefined) {
    return "";
  }

  try {
    return ` ${JSON.stringify(meta)}`;
  } catch {
    return " [unserializable-meta]";
  }
}

function writeLog(level: LogLevel, message: string, meta?: unknown): void {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${level}] ${message}${serializeMeta(meta)}`;

  ensureLogDir();
  fs.appendFileSync(getLogFilePath(), `${line}\n`);

  if (level === "ERROR") {
    console.error(line);
    return;
  }

  if (level === "WARN") {
    console.warn(line);
    return;
  }

  console.log(line);
}

export const logger = {
  debug(message: string, meta?: unknown) {
    writeLog("DEBUG", message, meta);
  },
  info(message: string, meta?: unknown) {
    writeLog("INFO", message, meta);
  },
  warn(message: string, meta?: unknown) {
    writeLog("WARN", message, meta);
  },
  error(message: string, meta?: unknown) {
    writeLog("ERROR", message, meta);
  },
};
