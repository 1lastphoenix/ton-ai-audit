type LogLevel = "info" | "warn" | "error";

function serializeError(error: unknown) {
  if (!(error instanceof Error)) {
    return error;
  }

  return {
    name: error.name,
    message: error.message,
    stack: error.stack
  };
}

function safeStringify(value: unknown) {
  const seen = new WeakSet<object>();

  return JSON.stringify(value, (_key, current) => {
    if (typeof current === "bigint") {
      return current.toString();
    }

    if (current instanceof Error) {
      return serializeError(current);
    }

    if (typeof current === "object" && current !== null) {
      if (seen.has(current)) {
        return "[Circular]";
      }
      seen.add(current);
    }

    return current;
  });
}

function writeLog(level: LogLevel, event: string, context: Record<string, unknown> = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    service: "worker",
    event,
    ...context
  };

  const line = safeStringify(entry);

  if (level === "error") {
    console.error(line);
    return;
  }

  if (level === "warn") {
    console.warn(line);
    return;
  }

  console.log(line);
}

export const workerLogger = {
  info(event: string, context?: Record<string, unknown>) {
    writeLog("info", event, context);
  },
  warn(event: string, context?: Record<string, unknown>) {
    writeLog("warn", event, context);
  },
  error(event: string, context?: Record<string, unknown>) {
    writeLog("error", event, context);
  }
};
