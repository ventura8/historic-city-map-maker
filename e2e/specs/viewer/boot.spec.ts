import type { Route } from '@playwright/test';
import { validateManifest } from '@hcm/shared';

import { siteManifestData, type Json } from '../../fixtures/manifest.js';
import { E2E_CITY_ID } from '../../fixtures/world.js';
import { mapFacts, renderedFeatureIds } from '../../support/map.js';
import { sitePath } from '../../support/site.js';
import { expect, test } from '../../support/test.js';
import {
    BUCHAREST_MANIFEST,
    engineEvents,
    manifestIssues,
    openViewer,
    serveManifest,
    t,
    viewer,
    waitForEngineEvent,
} from '../../support/viewer.js';

/**
 * Boot (behaviour V01) and WebGL (V02, happy path): the built Bucharest site fetches its manifest, validates it and
 * shows the map, the timeline and the photo markers; every failure (404, an invalid or too new manifest, a slow
 * server) shows a localized Material 3 error card, in plain words, with a filled tonal Retry where a retry can help,
 * never a blank map.
 */

/** Words a visitor should never have to know (the M1 UX review found "manifestul" and "WebGL" on the card). */
const JARGON = /manifest|webgl|json|schema|engine|motor|basemap|tile/i;

interface ErrorCardFacts {
    readonly background: string;
    readonly text: string;
    readonly retryVariant: string;
    readonly retryBackground: string;
    readonly tokens: Readonly<Record<'errorContainer' | 'onErrorContainer' | 'secondaryContainer', string>>;
}

/** Runs in the page: the error card's painted colours, Retry's variant and colour, and the theme tokens, as `#rrggbb`. */
function errorCardFacts(): ErrorCardFacts {
    const context = document.createElement('canvas').getContext('2d');
    const hex = (colour: string): string => {
        if (context === null) {
            return colour;
        }
        context.fillStyle = '#000000';
        context.fillStyle = colour.trim();
        return context.fillStyle;
    };
    const host = document.querySelector('hcm-map-viewer');
    const card = host?.shadowRoot?.querySelector('hcm-error-card')?.shadowRoot ?? null;
    const box = card?.querySelector('.card') ?? null;
    const retry = card?.querySelector('hcm-button') ?? null;
    const button = retry?.shadowRoot?.querySelector('button') ?? null;
    const tokens = host === null ? null : getComputedStyle(host);
    const token = (name: string): string => hex(tokens?.getPropertyValue(`--md-sys-color-${name}`) ?? '');
    return {
        background: box === null ? '' : hex(getComputedStyle(box).backgroundColor),
        text: box === null ? '' : hex(getComputedStyle(box).color),
        retryVariant: retry?.getAttribute('variant') ?? '',
        retryBackground: button === null ? '' : hex(getComputedStyle(button).backgroundColor),
        tokens: {
            errorContainer: token('error-container'),
            onErrorContainer: token('on-error-container'),
            secondaryContainer: token('secondary-container'),
        },
    };
}

test(
    'The manifest becomes a map with its timeline and photo markers',
    { tag: ['@S-V01-HAPPY', '@S-V02-HAPPY'] },
    async ({ page, lang }) => {
        await openViewer(page, { lang });

        await expect(viewer(page).locator('canvas.mapboxgl-canvas')).toBeVisible();
        await expect(
            page.getByRole('region', {
                name: t(lang, 'viewer.mapLabel', { city: lang === 'ro' ? 'București dispărut' : 'Lost Bucharest' }),
            }),
        ).toBeVisible();
        const timeline = page.getByRole('slider', { name: t(lang, 'timeline.label'), exact: true });
        await expect(timeline).toBeVisible();
        await expect(timeline).toHaveAttribute('aria-valuetext', t(lang, 'timeline.present'));
        const [ready] = await engineEvents(page, 'hcm-ready');
        expect(ready).toEqual({ cityId: E2E_CITY_ID, engineVersion: expect.any(String) as unknown, layers: 2, photos: 45 });
        await expect
            .poll(async () => (await mapFacts(page)).visibleLayers)
            .toEqual(expect.arrayContaining(['hcm-photos-marker', 'hcm-photos-cluster']));
        await expect(page.getByRole('alert')).toHaveCount(0);
        expect(await renderedFeatureIds(page, 'hcm-photos-')).toContain('cluster');
    },
);

test(
    'A missing manifest shows a localized error with Retry, and Retry recovers',
    { tag: '@S-V01-BAD-MANIFEST404' },
    async ({ page, lang, consoleErrors }) => {
        await page.route(BUCHAREST_MANIFEST, (route) => route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not found' }));
        await page.goto(sitePath('bucharest', { lang }));

        const card = page.getByRole('alert');
        await expect(card).toContainText(t(lang, 'error.manifest.notFound'));
        const retry = card.getByRole('button', { name: t(lang, 'action.retry') });
        await expect(retry).toBeVisible();
        expect(await engineEvents(page, 'hcm-error')).toEqual([{ code: 'error.manifest.notFound', retryable: true, detail: '404' }]);
        expect(consoleErrors.take()).toEqual([expect.stringContaining('404')]);

        await page.unroute(BUCHAREST_MANIFEST);
        await retry.click();
        await waitForEngineEvent(page, 'hcm-ready');
        await expect(page.getByRole('alert')).toHaveCount(0);
        await expect(viewer(page).locator('canvas.mapboxgl-canvas')).toBeVisible();
    },
);

test(
    'An invalid manifest shows the error card with its issue count, not a blank map',
    { tag: '@S-V01-BAD-INVALID-MANIFEST' },
    async ({ page, lang }) => {
        const broken = siteManifestData();
        const [photo] = broken['photos'] as [Json, ...Json[]];
        photo['location'] = { lat: 'north', lng: 26.1 };
        (broken['city'] as Json)['zoom'] = 99;
        const result = validateManifest(broken);
        expect(result.ok).toBe(false);
        const count = manifestIssues(result).length;
        await serveManifest(page, broken);
        await page.goto(sitePath('bucharest', { lang }));

        const card = page.getByRole('alert');
        await expect(card).toContainText(t(lang, 'error.manifest.invalid', { count: String(count) }));
        await expect(card.getByRole('button', { name: t(lang, 'action.retry') })).toHaveCount(0);
        await expect(viewer(page).locator('canvas.mapboxgl-canvas')).toHaveCount(0);
        const [error] = await engineEvents(page, 'hcm-error');
        expect(error).toMatchObject({ code: 'error.manifest.invalid', retryable: false });
    },
);

test('A slow manifest shows the loading skeleton, then a localized timeout', { tag: '@S-V01-BAD-SLOW-STORAGE' }, async ({ page, lang }) => {
    await page.clock.install();
    const held: Route[] = [];
    await page.route(BUCHAREST_MANIFEST, (route) => {
        held.push(route);
    });
    await page.goto(sitePath('bucharest', { lang }));

    const skeleton = page.getByRole('status').filter({ hasText: t(lang, 'viewer.loading') });
    await expect(skeleton).toBeVisible();
    // UX review: the skeleton's progress bar had no width and never showed; the loading indicator must be seen.
    await expect(skeleton.getByRole('progressbar', { name: t(lang, 'viewer.loading') })).toBeVisible();
    await expect.poll(() => held.length).toBe(1);
    await page.clock.runFor(15_000);

    const card = page.getByRole('alert');
    await expect(card).toContainText(t(lang, 'error.manifest.timeout'));
    await expect(card.getByRole('button', { name: t(lang, 'action.retry') })).toBeVisible();
    await expect(skeleton).toHaveCount(0);
});

test('A manifest that needs a newer engine names the version it needs', { tag: '@S-V01-BAD-ENGINE-TOO-OLD' }, async ({ page, lang }) => {
    const manifest = siteManifestData();
    (manifest['city'] as Json)['engine'] = { minVersion: '99.0.0' };
    await serveManifest(page, manifest);
    await page.goto(sitePath('bucharest', { lang }));

    await expect(page.getByRole('alert')).toContainText(t(lang, 'error.manifest.engineTooOld', { version: '99.0.0' }));
    await expect(viewer(page).locator('canvas.mapboxgl-canvas')).toHaveCount(0);
    expect(await engineEvents(page, 'hcm-error')).toEqual([expect.objectContaining({ code: 'error.manifest.engineTooOld' })]);
});

test(
    'A failed load shows a Material 3 error card with a filled tonal Retry',
    { tag: '@S-V01-HAPPY-ERROR-CARD' },
    async ({ page, lang, consoleErrors, axe }) => {
        await page.route(BUCHAREST_MANIFEST, (route) => route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not found' }));
        await page.goto(sitePath('bucharest', { lang }));
        const card = page.getByRole('alert');
        await expect(card.getByRole('button', { name: t(lang, 'action.retry') })).toBeVisible();
        expect(consoleErrors.take()).toEqual([expect.stringContaining('404')]);

        const facts = await page.evaluate(errorCardFacts);
        expect(facts.tokens.errorContainer, 'the city theme has an error container').toMatch(/^#[\da-f]{6}$/);
        expect([facts.background, facts.text]).toEqual([facts.tokens.errorContainer, facts.tokens.onErrorContainer]);
        expect([facts.retryVariant, facts.retryBackground]).toEqual(['tonal', facts.tokens.secondaryContainer]);
        expect(await axe.violations(), 'readable (WCAG 2.2 AA)').toEqual([]);
    },
);

test('No error card a visitor meets speaks jargon', { tag: '@S-V01-BAD-PLAIN-WORDS' }, async ({ page, lang, consoleErrors }) => {
    await page.route(BUCHAREST_MANIFEST, (route) => route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not found' }));
    await page.goto(sitePath('bucharest', { lang }));
    const card = page.getByRole('alert');
    await expect(card).toContainText(t(lang, 'error.manifest.notFound'));
    await expect(card).not.toContainText(JARGON);
    expect(consoleErrors.take()).toEqual([expect.stringContaining('404')]);

    await page.unroute(BUCHAREST_MANIFEST);
    const manifest = siteManifestData();
    (manifest['city'] as Json)['engine'] = { minVersion: '99.0.0' };
    await serveManifest(page, manifest);
    await page.goto(sitePath('bucharest', { lang }));
    await expect(card).toContainText(t(lang, 'error.manifest.engineTooOld', { version: '99.0.0' }));
    await expect(card).not.toContainText(JARGON);
});
