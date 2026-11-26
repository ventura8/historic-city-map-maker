import { VIEWER_EVENT_PARAMS, eventProblem, eventSchemas, type GaParamValue, type GaParams } from '@hcm/shared';
import type { Page } from '@playwright/test';

import { siteManifestData, type Json } from '../fixtures/manifest.js';
import { E2E_FIREBASE_APP } from '../fixtures/world.js';
import { mockedHostKind } from '../mock-apis/hosts.js';
import type { RecordedCall } from '../mock-apis/server.js';
import type { MockApis } from './site.js';

/**
 * GA4 as the e2e world records it (PLAN Addendum 2, V19; `docs/ARCHITECTURE.md` → *Field measurements*): the viewer's
 * real Firebase Analytics SDK logs through the stand-in gtag.js of `mock-apis/gtag.ts`, which turns every event into a
 * `POST region1.google-analytics.com/g/collect?en=<event>&ep.<param>=…&dl=<page>` the mock APIs record.
 */

/** A manifest with analytics configured: the measurement id and the Firebase web app ids (CR-9). */
export function analyticsManifest(manifest: Json = siteManifestData({ analytics: true })): Json {
    const city = manifest['city'] as Json;
    city['analytics'] = { ...(city['analytics'] as Json), firebase: { ...E2E_FIREBASE_APP } };
    return manifest;
}

/** Every request of this test that reached Google Analytics or Firebase (the mock APIs' record). */
export async function analyticsCalls(mockApis: MockApis): Promise<RecordedCall[]> {
    return (await mockApis.calls()).filter((call) => mockedHostKind(call.host) === 'analytics');
}

export interface GaEvent {
    readonly name: string;
    readonly params: URLSearchParams;
}

/** The GA4 events the mock received, by name, with their parameters. */
export async function gaEvents(mockApis: MockApis): Promise<GaEvent[]> {
    return (await analyticsCalls(mockApis))
        .filter((call) => call.path === '/g/collect')
        .map((call) => {
            const params = new URLSearchParams(call.query);
            return { name: params.get('en') ?? '', params };
        });
}

/** A beacon's text value back as GA4 got it from the viewer (`true`, `12.5`, `LCP`): the beacon writes each as text. */
const BOOLEANS: Readonly<Record<string, boolean>> = { true: true, false: false };

function valueOf(text: string): GaParamValue {
    const number = /^-?\d+(?:\.\d+)?$/.test(text) ? Number(text) : null;
    return BOOLEANS[text] ?? number ?? text;
}

/** An event's parameters (`ep.<name>`) as the viewer sent them, with its page location (`dl`). */
export function eventParams(event: GaEvent): GaParams {
    const entries: [string, GaParamValue][] = [...event.params.entries()]
        .filter(([key]) => key.startsWith('ep.'))
        .map(([key, value]) => [key.slice(3), valueOf(value)]);
    return { ...Object.fromEntries(entries), page_location: event.params.get('dl') ?? '' };
}

const VIEWER_SCHEMAS = eventSchemas(VIEWER_EVENT_PARAMS);

/** Why the viewer's guard would refuse the event GA4 received (null: it is one of its events, valid and private). */
export function viewerEventProblem(event: GaEvent): string | null {
    return eventProblem(VIEWER_SCHEMAS, event.name, eventParams(event));
}

/** The URLs of the scripts the page fetched (Resource Timing): the consented chunks show here once loaded. */
export async function fetchedScripts(page: Page): Promise<string[]> {
    return page.evaluate(() => performance.getEntriesByType('resource').map((entry) => entry.name));
}

/**
 * The page goes to the background as when the visitor switches tabs (the browser's event bubbles to the window): web-vitals
 * reports CLS and INP then, and the viewer sends the map errors it counted since the last report.
 */
export async function hidePage(page: Page): Promise<void> {
    await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
    });
}
