/**
 * The only logging API in the monorepo: product code never calls `console.*` directly
 * (ESLint `no-console`). A logger has a scope, a minimum level and a sink; tests pass a
 * recording sink (@hcm/test-support) and assert what was logged.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogData = Readonly<Record<string, unknown>>;

export interface LogRecord {
    readonly level: LogLevel;
    readonly scope: string;
    readonly message: string;
    readonly data?: LogData;
}

export type LogSink = (record: LogRecord) => void;

export interface Logger {
    readonly scope: string;
    debug(message: string, data?: LogData): void;
    info(message: string, data?: LogData): void;
    warn(message: string, data?: LogData): void;
    error(message: string, data?: LogData): void;
    child(scope: string): Logger;
}

export interface LoggerOptions {
    readonly sink?: LogSink;
    readonly minLevel?: LogLevel;
}

const LEVEL_RANK: Readonly<Record<LogLevel, number>> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Keys whose values never reach a sink (tokens pasted in the admin, signed URLs, credentials). */
const SECRET_KEY = /token|secret|password|authorization|signature|api[-_]?key/i;

export const REDACTED = '[redacted]';

/** Returns a copy of `data` with the value of every secret-looking key replaced by {@link REDACTED}. */
export function redact(data: LogData): LogData {
    return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, SECRET_KEY.test(key) ? REDACTED : value]));
}

/** Default sink: one console line per record, `[scope] message`, plus the redacted data object when present. */
export const consoleSink: LogSink = (record) => {
    const line = `[${record.scope}] ${record.message}`;
    if (record.data === undefined) {
        console[record.level](line);
        return;
    }
    console[record.level](line, record.data);
};

export function createLogger(scope: string, options: LoggerOptions = {}): Logger {
    const sink = options.sink ?? consoleSink;
    const minRank = LEVEL_RANK[options.minLevel ?? 'info'];
    const emit = (level: LogLevel, message: string, data?: LogData): void => {
        if (LEVEL_RANK[level] < minRank) {
            return;
        }
        sink(data === undefined ? { level, scope, message } : { level, scope, message, data: redact(data) });
    };
    return {
        scope,
        debug: (message, data) => {
            emit('debug', message, data);
        },
        info: (message, data) => {
            emit('info', message, data);
        },
        warn: (message, data) => {
            emit('warn', message, data);
        },
        error: (message, data) => {
            emit('error', message, data);
        },
        child: (childScope) => createLogger(`${scope}:${childScope}`, options),
    };
}
