import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, type Page, type TestInfo } from '@playwright/test';
import { ENGINE_PAGE_FILES, fillKitPage, isUnpinned, KIT_PLACEHOLDER_TOKEN, readKitEngine, type KitEngine } from '@hcm/shared';

import { E2E_TOKEN, SITE_ORIGIN } from '../fixtures/world.js';

/**
 * The starter kit against the mock world (M5, behaviours V27 and V29; docs/research/M5-interfaces.md §3.6): the site
 * server serves `templates/starter-kit/` as committed at `/kit/`, and the mock CDN answers the pinned jsDelivr folder
 * from `cdn/engine/` once a release made it, else from `packages/engine/dist`. Until a release pins the template, its
 * engine block carries placeholder digests: the page is then served with its engine block pinned to the digests of
 * exactly what the mock CDN serves (`fillKitPage`), and the test says so in an annotation.
 */

const ROOT = resolve(import.meta.dirname, '../..');

/** Where the site server serves the template. */
export const KIT_PATH = '/kit/';

/** The template as committed. */
export const KIT_TEMPLATE = resolve(ROOT, 'templates/starter-kit');

/** What the mock CDN serves for a release's folder (e2e/mock-apis/main.ts makes the same choice). */
export function cdnEngineFolder(): string {
    return existsSync(resolve(ROOT, 'cdn/engine/release.json')) ? resolve(ROOT, 'cdn/engine') : resolve(ROOT, 'packages/engine/dist');
}

/** `sha384-…` of a file the mock CDN serves. */
function servedIntegrity(file: string): string {
    return `sha384-${createHash('sha384')
        .update(readFileSync(resolve(cdnEngineFolder(), file)))
        .digest('base64')}`;
}

/** The engine the served page pins: the template's, or (before a release) the template's folder with the served digests. */
export function servedEngine(page: string): KitEngine {
    const engine = readKitEngine(page);
    if (engine.kind !== 'cdn' || !isUnpinned(engine)) {
        return engine;
    }
    const files = Object.values(ENGINE_PAGE_FILES).map((path) => ({ path, integrity: servedIntegrity(path) }));
    return { kind: 'cdn', release: { base: engine.release.base, files } };
}

/**
 * A kit page as the browser gets it from `/kit/`: `page` (the template, by default) as it is when a release pinned it,
 * else with its engine block pinned to what the mock CDN serves (annotated on `testInfo`).
 */
export function servedKitPage(testInfo: TestInfo, page = readFileSync(resolve(KIT_TEMPLATE, 'index.html'), 'utf8')): string {
    const engine = readKitEngine(page);
    if (!isUnpinned(engine)) {
        return page;
    }
    testInfo.annotations.push({
        type: 'kit-pins',
        description: 'No release has pinned the kit yet: its engine block is pinned to the digests of the engine the mock CDN serves.',
    });
    return fillKitPage(page, { engine: servedEngine(page) });
}

/** Answers `path` of the site origin, whatever its query (`?lang=`), with `body`. */
async function serveAt(page: Page, path: string, body: string, contentType: string): Promise<void> {
    await page.route(
        (url) => url.origin === SITE_ORIGIN && url.pathname === path,
        (route) => route.fulfill({ contentType, body }),
    );
}

/** Serves the kit's page from `/kit/` as `servedKitPage` makes it (nothing is routed when the template is pinned). */
export async function serveKit(page: Page, testInfo: TestInfo): Promise<void> {
    const template = readFileSync(resolve(KIT_TEMPLATE, 'index.html'), 'utf8');
    const html = servedKitPage(testInfo, template);
    if (html !== template) {
        await serveAt(page, KIT_PATH, html, 'text/html; charset=utf-8');
    }
}

/** The template's city.json with the owner's token in place of the placeholder (the README's token step done). */
export function kitManifestWithToken(): string {
    return readFileSync(resolve(KIT_TEMPLATE, 'city.json'), 'utf8').replace(KIT_PLACEHOLDER_TOKEN, E2E_TOKEN);
}

/** The delay engine.css gives the kit's troubleshooting sentence (`.hcm-note-late`) before it shows. */
export const LATE_NOTE_DELAY = '4s';

/**
 * The kit's troubleshooting sentences shown at once, without waiting for their delay (docs/LESSONS.md 248): once the
 * engine's stylesheet holds them back (their animation is named), their animations are finished from outside the page.
 */
export async function revealLateNotes(page: Page): Promise<void> {
    const late = page.locator('.hcm-note-late').first();
    await expect.poll(() => late.evaluate((element) => getComputedStyle(element).animationDelay)).toBe(LATE_NOTE_DELAY);
    await page.evaluate(() => {
        for (const animation of document.getAnimations()) {
            animation.finish();
        }
    });
}
