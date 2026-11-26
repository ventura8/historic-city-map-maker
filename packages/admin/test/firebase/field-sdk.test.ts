import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadFieldSdk } from '../../src/firebase/app.js';
// Imported up front, so the lazy import below finds the module loaded (a cold transform of web-vitals is slow under load).
import { fieldSdk } from '../../src/firebase/field-sdk.js';

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

describe("the admin's field chunk", () => {
    it('happyPath_itLoadsLazilyAndItsObserversRegisterWithoutReportingYet', async () => {
        const field = await loadFieldSdk();
        expect(field).toBe(fieldSdk);
        const listened = stubPage();
        const reported: unknown[] = [];

        field.observeVitals((params) => reported.push(params));

        expect(reported).toEqual([]);
        expect(listened.length).toBeGreaterThan(0);
    });

    it('badPath_itsGuardRefusesAnEventThatNamesAnEmailAddress', () => {
        expect(
            fieldSdk.createGuard().check('exception', { description: 'a@b.org', fatal: false, page_location: 'https://x.web.app/admin/' }),
        ).toEqual({
            ok: false,
            reason: 'privacy',
            first: true,
        });
    });
});
