import type { LogRecord, LogSink } from '@hcm/shared';

export interface RecordingSink {
    /** Pass this to createLogger / boot options. */
    readonly sink: LogSink;
    /** Every record the sink received, oldest first. */
    readonly records: readonly LogRecord[];
}

/** A log sink that keeps records in memory so tests assert what was logged instead of spying on the console. */
export function createRecordingSink(): RecordingSink {
    const records: LogRecord[] = [];
    return {
        sink: (record) => {
            records.push(record);
        },
        records,
    };
}
