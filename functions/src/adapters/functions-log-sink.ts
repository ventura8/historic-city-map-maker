import type { LogLevel, LogSink } from '@hcm/shared';
import type { LogEntry, LogSeverity } from 'firebase-functions/logger';

const SEVERITY: Readonly<Record<LogLevel, LogSeverity>> = { debug: 'DEBUG', info: 'INFO', warn: 'WARNING', error: 'ERROR' };

/**
 * Sends @hcm/shared log records to Cloud Logging as structured entries through
 * firebase-functions/logger `write`. The record's data is already redacted by createLogger; its
 * fields become jsonPayload fields, and `severity`, `message` and `scope` always win over them.
 */
export function createFunctionsLogSink(write: (entry: LogEntry) => void): LogSink {
    return (record) => {
        write({ ...record.data, severity: SEVERITY[record.level], message: `[${record.scope}] ${record.message}`, scope: record.scope });
    };
}
