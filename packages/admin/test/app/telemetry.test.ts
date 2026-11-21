import { describe, expect, it, vi } from 'vitest';

import { AdminTelemetry, CONSENT_KEY, MAX_PENDING, eventParams, expireAnalyticsCookies, parseConsent } from '../../src/app/telemetry.js';
import type { AnalyticsPort } from '../../src/firebase/analytics.js';
import { MemoryStore, testLog } from './fakes.js';

function telemetry(stored: string | null, configured = true, privacySignal = false) {
    const local = new MemoryStore();
    if (stored !== null) {
        local.set(CONSENT_KEY, stored);
    }
    const setConsent = vi.fn<(granted: boolean) => void>();
    const logEvent = vi.fn<AnalyticsPort['log']>();
    const field = vi.fn<AnalyticsPort['field']>();
    const analytics: AnalyticsPort = { setConsent, log: logEvent, field };
    const report = vi.fn();
    const clearCookies = vi.fn();
    const subject = new AdminTelemetry({
        local,
        analytics: configured ? analytics : null,
        errors: { report },
        clearCookies,
        log: testLog().log,
        privacySignal,
    });
    return { local, setConsent, logEvent, field, report, clearCookies, subject };
}

describe('AdminTelemetry', () => {
    it('badPath_doNotTrackDeclinesUntilTheAdminAcceptsAndHoldsNothing', () => {
        // @S-A150-BAD-NO-EVENTS-BEFORE-CONSENT: a browser asking not to be tracked: no banner, no event, nothing held.
        const t = telemetry(null, true, true);
        t.subject.measure({ name: 'wizard_start', params: { wizard_id: 'setup' } });
        expect(t.subject.consent).toBe('denied');
        expect(t.field).not.toHaveBeenCalled();
        expect(t.local.get(CONSENT_KEY)).toBeNull();
        t.subject.setConsent('granted');
        expect(t.field).not.toHaveBeenCalled();
        expect(telemetry('granted', true, true).subject.consent).toBe('granted');
    });

    it('happyPath_aStoredGrantTurnsCollectionOnAndEventsFlow', () => {
        const t = telemetry('granted');

        t.subject.track({ name: 'setup_step', step: 'billing', state: 'ok' });

        expect(t.subject.consent).toBe('granted');
        expect(t.subject.available).toBe(true);
        expect(t.setConsent).toHaveBeenCalledWith(true);
        expect(t.logEvent).toHaveBeenCalledWith('setup_step', { step: 'billing', state: 'ok' });
    });

    it('happyPath_theAnswerIsStoredAndAWithdrawalExpiresTheCookies', () => {
        const t = telemetry(null);

        t.subject.setConsent('denied');
        expect(t.clearCookies).not.toHaveBeenCalled();
        t.subject.setConsent('granted');
        t.subject.setConsent('denied');

        expect(t.local.get(CONSENT_KEY)).toBe('denied');
        expect(t.clearCookies).toHaveBeenCalledTimes(1);
        expect(t.setConsent.mock.calls.map(([granted]) => granted)).toEqual([false, false, true, false]);
    });

    it('badPath_withoutAMeasurementIdNothingIsAskedOrSent', () => {
        const t = telemetry(null, false);

        t.subject.track({ name: 'page_view', route: 'setup' });
        t.subject.setConsent('granted');

        expect(t.subject.available).toBe(false);
        expect(t.logEvent).not.toHaveBeenCalled();
    });

    it('happyPath_aMeasurementBeforeTheAnswerIsSentOnceTheAdminConsents', () => {
        const t = telemetry(null);
        t.subject.measure({ name: 'admin_ready', params: { duration_ms: 900, restored: true } });
        expect(t.field).not.toHaveBeenCalled();

        t.subject.setConsent('granted');
        t.subject.measure({ name: 'setup_check', params: { step: 'billing', outcome: 'ok', duration_ms: 40 } });

        expect(t.field.mock.calls.map(([name]) => name)).toEqual(['admin_ready', 'setup_check']);
    });

    it('badPath_aRefusalForgetsTheHeldMeasurementsAndAtMost30AreHeld', () => {
        const refused = telemetry(null);
        refused.subject.measure({ name: 'admin_ready', params: { duration_ms: 900, restored: true } });
        refused.subject.setConsent('denied');
        refused.subject.measure({ name: 'admin_ready', params: { duration_ms: 900, restored: true } });
        refused.subject.setConsent('granted');
        expect(refused.field).not.toHaveBeenCalled();

        const many = telemetry(null);
        for (let index = 0; index < MAX_PENDING + 5; index += 1) {
            many.subject.measure({
                name: 'editor_save',
                params: { area: 'photos', operation: 'update', outcome: 'ok', duration_ms: index },
            });
        }
        many.subject.setConsent('granted');
        expect(many.field).toHaveBeenCalledTimes(MAX_PENDING);

        const unconfigured = telemetry(null, false);
        unconfigured.subject.measure({ name: 'admin_ready', params: { duration_ms: 1, restored: false } });
        unconfigured.subject.setConsent('granted');
        expect(unconfigured.field).not.toHaveBeenCalled();
    });

    it('happyPath_errorsGoToTheReporter', () => {
        const t = telemetry(null);
        const error = new Error('x');

        t.subject.reportError(error, { fatal: true, source: 'boundary' });

        expect(t.report).toHaveBeenCalledWith(error, { fatal: true, source: 'boundary' });
    });
});

describe('eventParams and parseConsent', () => {
    it('happyPath_eventsCarryIdsAndCountsOnly', () => {
        expect(eventParams({ name: 'legacy_import', imported: 44, failed: 1 })).toEqual({ imported: 44, failed: 1 });
        expect(eventParams({ name: 'page_view', route: 'admins' })).toEqual({ route: 'admins' });
    });

    it('badPath_anythingButAnAnswerIsUnknown', () => {
        expect([parseConsent('granted'), parseConsent('denied'), parseConsent('yes'), parseConsent(null)]).toEqual([
            'granted',
            'denied',
            'unknown',
            'unknown',
        ]);
    });
});

describe('expireAnalyticsCookies', () => {
    it('happyPath_expiresTheAdminsGa4CookiesHostOnlyAndForTheHost', () => {
        const writes: string[] = [];
        const jar = {
            get cookie(): string {
                return 'hcm_admin_ga=GA1.1.1; theme=dark; hcm_admin_ga_E2E0000000=GS1; _gac_x=1; hcm_admin_ga=again';
            },
            set cookie(value: string) {
                writes.push(value);
            },
        };

        expect(expireAnalyticsCookies(jar, 'demo-hcm.web.app')).toEqual(['hcm_admin_ga', 'hcm_admin_ga_E2E0000000']);
        expect(writes).toEqual([
            'hcm_admin_ga=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/',
            'hcm_admin_ga=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; Domain=demo-hcm.web.app',
            'hcm_admin_ga_E2E0000000=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/',
            'hcm_admin_ga_E2E0000000=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; Domain=demo-hcm.web.app',
        ]);
    });

    it('badPath_theViewersGa4CookiesOnTheSameOriginAreNeverTouched', () => {
        // M6 (docs/research/M6-interfaces.md §2.3): the public map at the root shares the admin's origin and its cookies.
        const writes: string[] = [];
        const jar = {
            get cookie(): string {
                return '_ga=GA1.1.2; _ga_VIEWER0001=GS1; hcm:bucharest:theme=dark';
            },
            set cookie(value: string) {
                writes.push(value);
            },
        };

        expect(expireAnalyticsCookies(jar, 'demo-hcm.web.app')).toEqual([]);
        expect(writes).toEqual([]);
    });
});
