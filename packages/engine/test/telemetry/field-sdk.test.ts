import { afterEach, describe, expect, it, vi } from 'vitest';

import { fieldSdk } from '../../src/telemetry/field-sdk.js';

/** What web-vitals reads of a page: a visible, loaded document and the window's listeners (Node has neither). */
function stubPage(): string[] {
    const listened: string[] = [];
    const listen = (type: string): void => {
        listened.push(type);
    };
    vi.stubGlobal('document', { visibilityState: 'visible', readyState: 'complete', prerendering: false, addEventListener: listen });
    vi.stubGlobal('addEventListener', listen);
    return listened;
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('the field chunk', () => {
    it('happyPath_theFiveObserversRegisterWithoutReportingYet', () => {
        const listened = stubPage();
        const reported: unknown[] = [];

        fieldSdk.observeVitals((params) => reported.push(params));

        expect(reported).toEqual([]);
        expect(listened.length).toBeGreaterThan(0);
    });

    it('badPath_theGuardOfTheChunkRefusesAnUnknownEvent', () => {
        expect(fieldSdk.createGuard().check('first_visit', {})).toEqual({ ok: false, reason: 'name', first: true });
    });
});
