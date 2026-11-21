import { createLogger } from '@hcm/shared';
import type { LogEntry } from 'firebase-functions/logger';
import { describe, expect, it } from 'vitest';

import { createFunctionsLogSink } from '../../src/adapters/functions-log-sink.js';

function capture(): { readonly entries: LogEntry[]; readonly write: (entry: LogEntry) => void } {
    const entries: LogEntry[] = [];
    return { entries, write: (entry) => entries.push(entry) };
}

describe('createFunctionsLogSink', () => {
    it('happyPath_writesStructuredEntriesWithCloudLoggingSeverities', () => {
        const { entries, write } = capture();
        const log = createLogger('setup', { sink: createFunctionsLogSink(write), minLevel: 'debug' });

        log.debug('d');
        log.info('i', { uid: 'ana' });
        log.warn('w');
        log.error('e');

        expect(entries).toEqual([
            { severity: 'DEBUG', message: '[setup] d', scope: 'setup' },
            { severity: 'INFO', message: '[setup] i', scope: 'setup', uid: 'ana' },
            { severity: 'WARNING', message: '[setup] w', scope: 'setup' },
            { severity: 'ERROR', message: '[setup] e', scope: 'setup' },
        ]);
    });

    it('badPath_dataCannotOverrideSeverityOrMessageAndSecretsStayRedacted', () => {
        const { entries, write } = capture();

        createLogger('setup', { sink: createFunctionsLogSink(write) }).error('rejected', {
            severity: 'DEBUG',
            message: 'x',
            token: 'sk.e2e',
        });

        expect(entries).toEqual([{ severity: 'ERROR', message: '[setup] rejected', scope: 'setup', token: '[redacted]' }]);
    });
});
