// Минимальный структурный логгер: одна JSON-строка на событие.
// CLAUDE.md: в логи НЕ попадают секреты и персональные данные — следит вызывающий код,
// сюда передаём только безопасные поля.

export type LogLevel = 'info' | 'warn' | 'error';

export interface Logger {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export interface LogEntry {
  level: LogLevel;
  scope: string;
  msg: string;
  ts: number;
  fields?: Record<string, unknown>;
}

/** Сериализует событие в одну JSON-строку с ISO-меткой времени. */
export function formatLogLine(entry: LogEntry): string {
  return JSON.stringify({
    ts: new Date(entry.ts).toISOString(),
    level: entry.level,
    scope: entry.scope,
    msg: entry.msg,
    ...entry.fields,
  });
}

/** Логгер с привязанным scope. info → stdout, warn/error → stderr. */
export function createLogger(scope: string): Logger {
  const emit = (level: LogLevel, msg: string, fields?: Record<string, unknown>): void => {
    const line = formatLogLine({ level, scope, msg, ts: Date.now(), fields });
    if (level === 'info') console.log(line);
    else console.error(line);
  };
  return {
    info: (msg, fields) => emit('info', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    error: (msg, fields) => emit('error', msg, fields),
  };
}
