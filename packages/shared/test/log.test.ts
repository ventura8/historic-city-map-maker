import { afterEach, describe, expect, it, vi } from 'vitest';

import { REDACTED, consoleSink, createLogger, redact, type LogRecord } from '../src/log.js';

function recorder(): { records: LogRecord[]; sink: (record: LogRecord) => void } {
    const records: LogRecord[] = [];
    return { records, sink: (record) => records.push(record) };
}

describe('createLogger', () => {
    it('happyPath_emitsRecordsAtOrAboveInfoByDefault', () => {
        const { records, sink } = recorder();
        const log = createLogger('engine', { sink });

        log.debug('hidden');
        log.info('ready');
        log.warn('slow', { ms: 1200 });
        log.error('failed');

        expect(records).toEqual([
            { level: 'info', scope: 'engine', message: 'ready' },
            { level: 'warn', scope: 'engine', message: 'slow', data: { ms: 1200 } },
            { level: 'error', scope: 'engine', message: 'failed' },
        ]);
    });

    it('happyPath_debugLevelEmitsEverything', () => {
        const { records, sink } = recorder();

        createLogger('admin', { sink, minLevel: 'debug' }).debug('trace');

        expect(records).toEqual([{ level: 'debug', scope: 'admin', message: 'trace' }]);
    });

    it('happyPath_childLoggerNestsScopeAndKeepsOptions', () => {
        const { records, sink } = recorder();
        const child = createLogger('engine', { sink, minLevel: 'warn' }).child('map');

        child.info('dropped');
        child.warn('kept');

        expect(child.scope).toBe('engine:map');
        expect(records).toEqual([{ level: 'warn', scope: 'engine:map', message: 'kept' }]);
    });

    it('badPath_secretValuesNeverReachTheSink', () => {
        const { records, sink } = recorder();

        createLogger('setup', { sink }).error('mapbox rejected', { accessToken: 'sk.e2e-trial', status: 401 });

        expect(records[0]?.data).toEqual({ accessToken: REDACTED, status: 401 });
    });
});

describe('redact', () => {
    it.each(['token', 'X-Auth-Token', 'clientSecret', 'password', 'Authorization', 'signature', 'apiKey', 'api_key'])(
        'badPath_redacts_%s',
        (key) => {
            expect(redact({ [key]: 'value' })).toEqual({ [key]: REDACTED });
        },
    );

    it('happyPath_keepsOrdinaryKeys', () => {
        expect(redact({ city: 'bucharest', year: 1977 })).toEqual({ city: 'bucharest', year: 1977 });
    });
});

describe('consoleSink', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('happyPath_writesScopedLineToTheMatchingConsoleMethod', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        consoleSink({ level: 'warn', scope: 'engine', message: 'slow tiles' });

        expect(warn).toHaveBeenCalledWith('[engine] slow tiles');
    });

    it('happyPath_appendsDataWhenPresent', () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        consoleSink({ level: 'error', scope: 'admin', message: 'upload failed', data: { size: 3 } });

        expect(error).toHaveBeenCalledWith('[admin] upload failed', { size: 3 });
    });

    it('happyPath_isTheDefaultSink', () => {
        const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

        createLogger('viewer').info('hello');

        expect(info).toHaveBeenCalledWith('[viewer] hello');
    });
});
