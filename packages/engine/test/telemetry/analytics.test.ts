import { describe, expect, it } from 'vitest';

import { gaParams } from '../../src/telemetry/analytics.js';
import { CONSENT_DENIED, CONSENT_GRANTED, ConsentStore, parseConsent } from '../../src/telemetry/consent.js';
import { brokenStorage, memoryStorage, recordingLog, settle } from '../core/support.js';
import { IDS, PAGE, fakeSdk, loader, withPage } from './support.js';

describe('analytics', () => {
    it('happyPath_eventsMapToGa4ParametersWithoutPii', () => {
        expect(gaParams({ name: 'page_view' })).toEqual({});
        expect(gaParams({ name: 'layer_toggle', layerId: 'kh4', visible: true })).toEqual({ layer_id: 'kh4', visible: true });
        expect(gaParams({ name: 'year_change', year: 1966 })).toEqual({ year: 1966 });
        expect(gaParams({ name: 'year_change', year: null })).toEqual({ year: 'today' });
        expect(gaParams({ name: 'photo_open', photoId: 'p' })).toEqual({ photo_id: 'p' });
        expect(gaParams({ name: 'poi_open', poiId: 'x' })).toEqual({ poi_id: 'x' });
        expect(gaParams({ name: 'story_open', storyId: 's' })).toEqual({ story_id: 's' });
        expect(gaParams({ name: 'locale_change', locale: 'en' })).toEqual({ locale: 'en' });
        expect(gaParams({ name: 'theme_change', theme: 'dark' })).toEqual({ theme: 'dark' });
        expect(gaParams({ name: 'exception', description: 'TypeError: x', fatal: false })).toEqual({
            description: 'TypeError: x',
            fatal: false,
        });
        expect(gaParams({ name: 'share' })).toEqual({});
        expect(gaParams({ name: 'compare_open' })).toEqual({});
    });

    it('badPath_nothingLoadsBeforeConsent', async () => {
        const sdk = fakeSdk();
        const { analytics, loads } = loader(sdk);
        analytics.configure('G-TEST1234', IDS);

        analytics.send({ name: 'page_view' });
        analytics.setConsent('unknown');
        analytics.send({ name: 'share' });
        await settle();

        expect(loads()).toBe(0);
        expect(sdk.events).toEqual([]);
    });

    it('badPath_withoutAMeasurementIdNothingLoadsEvenWithConsent', async () => {
        const { analytics, loads } = loader(fakeSdk());
        analytics.configure(undefined, IDS);
        analytics.setConsent('granted');

        analytics.send({ name: 'page_view' });
        await settle();

        expect(loads()).toBe(0);
    });

    it('badPath_withoutTheFirebaseAppIdsAnalyticsStaysOffAndSaysWhy', async () => {
        const log = recordingLog();
        const { analytics, loads } = loader(fakeSdk(), log);
        analytics.configure('G-TEST1234', undefined);
        analytics.setConsent('granted');

        analytics.send({ name: 'page_view' });
        await settle();

        expect(loads()).toBe(0);
        expect(log.messages()).toEqual(['analytics off: the manifest has no Firebase app ids']);
    });
});

describe('analytics after consent', () => {
    it('happyPath_consentLoadsTheSdkOnceInConsentModeAndSendsEventsWithoutTheHash', async () => {
        const sdk = fakeSdk();
        const { analytics, loads } = loader(sdk);
        analytics.configure('G-TEST1234', IDS);
        analytics.configure('G-OTHER999', IDS);
        analytics.setConsent('granted');

        analytics.send({ name: 'page_view' });
        analytics.send({ name: 'photo_open', photoId: 'p' });
        await settle();

        expect(loads()).toBe(1);
        const config = {
            send_page_view: false,
            page_location: PAGE,
            page_path: '/bucuresti/',
            allow_google_signals: false,
            allow_ad_personalization_signals: false,
        };
        expect(sdk.log).toEqual([
            `initializeApp hcm-viewer ${JSON.stringify({ ...IDS, measurementId: 'G-TEST1234' })}`,
            `initializeAnalytics ${JSON.stringify({ config })}`,
            'collection true',
        ]);
        expect(sdk.consents).toEqual([CONSENT_GRANTED]);
        expect(sdk.events).toEqual([
            ['page_view', withPage()],
            ['photo_open', withPage({ photo_id: 'p' })],
        ]);
    });

    it('happyPath_withdrawingStopsCollectionAndLaterEventsAndExpiresTheCookiesTwice', async () => {
        const sdk = fakeSdk();
        const { analytics, cookieClears } = loader(sdk);
        analytics.configure('G-TEST1234', IDS);
        analytics.setConsent('granted');
        analytics.send({ name: 'page_view' });
        await settle();

        analytics.setConsent('denied');
        expect(cookieClears(), 'at once').toBe(1);
        analytics.send({ name: 'share' });
        await settle();

        expect(sdk.consents.at(-1)).toEqual(CONSENT_DENIED);
        expect(sdk.log.at(-1)).toBe('collection false');
        expect(sdk.events).toEqual([['page_view', withPage()]]);
        expect(cookieClears(), 'and again once the SDK has stopped').toBe(2);
    });

    it('happyPath_grantingAgainTurnsCollectionBackOn', async () => {
        const sdk = fakeSdk();
        const { analytics, cookieClears } = loader(sdk);
        analytics.configure('G-TEST1234', IDS);
        analytics.setConsent('granted');
        analytics.send({ name: 'page_view' });
        await settle();
        analytics.setConsent('denied');

        analytics.setConsent('granted');
        analytics.send({ name: 'share' });
        await settle();

        expect(sdk.log.at(-1)).toBe('collection true');
        expect(sdk.events.at(-1)).toEqual(['share', withPage()]);
        expect(cookieClears()).toBe(2);
    });

    it('badPath_anEventQueuedBeforeAWithdrawalIsDroppedAndGa4NeverStartsGranted', async () => {
        const sdk = fakeSdk();
        const { analytics, cookieClears } = loader(sdk);
        analytics.configure('G-TEST1234', IDS);
        analytics.setConsent('granted');

        analytics.send({ name: 'page_view' });
        analytics.setConsent('denied');
        await settle();

        expect(sdk.events).toEqual([]);
        // The visitor withdrew while the chunk loaded: GA4 starts denied, so gtag.js never writes a cookie.
        expect(sdk.consents).toEqual([CONSENT_DENIED, CONSENT_DENIED]);
        expect(sdk.log.filter((entry) => entry.startsWith('collection'))).toEqual(['collection false', 'collection false']);
        expect(cookieClears()).toBe(2);
    });

    it('badPath_aFirstDeclineOrAWithdrawalWithoutAnalyticsLeavesTheCookiesAlone', async () => {
        // The page's own cookies (an embedding page may run its own GA4) are not the viewer's to expire.
        const configured = loader(fakeSdk());
        configured.analytics.configure('G-TEST1234', IDS);
        configured.analytics.setConsent('denied');
        const unconfigured = loader(fakeSdk());
        unconfigured.analytics.setConsent('granted');
        unconfigured.analytics.setConsent('denied');
        await settle();

        expect([configured.cookieClears(), unconfigured.cookieClears()]).toEqual([0, 0]);
        expect([configured.loads(), unconfigured.loads()]).toEqual([0, 0]);
    });

    it('badPath_anUnsupportedBrowserOrAFailedLoadSendsNothing', async () => {
        const unsupported = fakeSdk({ supported: false });
        const quiet = loader(unsupported);
        const log = recordingLog();
        const failing = loader(new Error('chunk 404'), log);
        for (const { analytics } of [quiet, failing]) {
            analytics.configure('G-TEST1234', IDS);
            analytics.setConsent('granted');
            analytics.send({ name: 'page_view' });
            analytics.send({ name: 'share' });
        }
        await settle();

        expect(unsupported.events).toEqual([]);
        expect(quiet.loads()).toBe(1);
        expect(log.messages()).toEqual(['analytics failed to load']);
        expect(log.records[0]?.data).toEqual({ error: 'Error: chunk 404' });
    });

    it('badPath_aThrowingSdkCallIsLoggedNotThrown', async () => {
        const log = recordingLog();
        const { analytics } = loader(fakeSdk({ throwOnLog: true }), log);
        analytics.configure('G-TEST1234', IDS);
        analytics.setConsent('granted');

        analytics.send({ name: 'page_view' });
        await settle();

        expect(log.messages()).toEqual(['analytics call failed']);
    });
});

describe('ConsentStore', () => {
    it('happyPath_theAnswerIsStoredPerCityAndAnnounced', () => {
        const storage = memoryStorage();
        const consent = new ConsentStore(storage, recordingLog().log, 'bucuresti');
        const heard: string[] = [];
        consent.onChange((state) => heard.push(state));

        consent.set('granted');
        consent.set('granted');
        consent.set('denied');

        expect(consent.state).toBe('denied');
        expect(storage.get('hcm:bucuresti:consent')).toBe('denied');
        expect(heard).toEqual(['granted', 'denied']);
    });

    it('happyPath_aStoredAnswerIsReadBackForItsCity', () => {
        const storage = memoryStorage({ 'hcm:bucuresti:consent': 'granted', 'hcm:cluj:consent': 'denied' });
        const consent = new ConsentStore(storage, recordingLog().log, undefined);
        const heard: string[] = [];
        consent.onChange((state) => heard.push(state));

        expect(consent.state).toBe('unknown');
        consent.setCity('bucuresti');
        consent.setCity('bucuresti');
        consent.setCity('cluj');

        expect(heard).toEqual(['granted', 'denied']);
    });

    it('happyPath_anAnswerGivenBeforeTheCityIsKnownIsStoredForIt', () => {
        const storage = memoryStorage();
        const consent = new ConsentStore(storage, recordingLog().log, undefined);

        consent.set('granted');
        consent.setCity('bucuresti');

        expect(consent.state).toBe('granted');
        expect(storage.get('hcm:bucuresti:consent')).toBe('granted');
    });

    it('badPath_aPrivacySignalDeclinesUntilAStoredOrGivenAnswer', () => {
        const storage = memoryStorage({ 'hcm:cluj:consent': 'granted' });
        const consent = new ConsentStore(storage, recordingLog().log, undefined, true);
        const heard: string[] = [];
        consent.onChange((state) => heard.push(state));

        expect(consent.state).toBe('denied');
        consent.setCity('bucuresti');
        expect(consent.state).toBe('denied');
        expect(storage.has('hcm:bucuresti:consent')).toBe(false);
        consent.setCity('cluj');

        expect(heard).toEqual(['granted']);
    });

    it('badPath_aBrokenStorageMeansNoAnswerYet', () => {
        const log = recordingLog();
        const consent = new ConsentStore(brokenStorage, log.log, 'bucuresti');
        consent.onChange(() => {
            throw new Error('listener bug');
        });

        consent.set('denied');

        expect(consent.state).toBe('denied');
        expect(log.messages()).toEqual(['preference not stored', 'consent listener failed']);
        expect(parseConsent('maybe')).toBe('unknown');
        consent.destroy();
    });
});
