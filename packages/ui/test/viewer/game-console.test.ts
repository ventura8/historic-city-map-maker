import { describe, expect, it, vi } from 'vitest';

import { reportConsole } from '../../src/viewer/game-console.js';

describe('reportConsole', () => {
    it('happyPath_aConsolesBrowserIsReportedAsAnInputDevice', () => {
        const store = { logInput: vi.fn() };
        reportConsole('Mozilla/5.0 (Windows NT 10.0; Win64; x64; Xbox; Xbox One) Edge/44.18363.8131', store);
        expect(store.logInput).toHaveBeenCalledWith('console');
    });

    it('badPath_anotherBrowserOrAStoreWithoutItReportsNothing', () => {
        const store = { logInput: vi.fn() };
        reportConsole('Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0', store);
        expect(store.logInput).not.toHaveBeenCalled();
        expect(() => {
            reportConsole('PlayStation 5', {});
        }).not.toThrow();
    });
});
