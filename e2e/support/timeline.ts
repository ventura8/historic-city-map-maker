import type { Locale } from '@hcm/shared';
import { expect, type CDPSession, type Page } from '@playwright/test';

import { siteManifestData } from '../fixtures/manifest.js';
import { E2E_XYZ_LAYER } from '../fixtures/world.js';
import { t, viewer } from './viewer.js';

/**
 * The timeline under a mouse and a finger (the year chip, the owner 2026-11-13): a city of many layer years, where each
 * stop and the chip are on screen, and Chromium's own touch events (CDP `Input.dispatchTouchEvent`).
 */

/** The fixture with a layer for each of `years` it lacks (the 1980 tiles), and `dated` years given two layers of two dates. */
export function manyYearsManifest(years: readonly number[], dated: readonly number[] = []): Record<string, unknown> {
    const manifest = siteManifestData();
    const served = manifest['layers'] as Record<string, unknown>[];
    const xyz = served.find((layer) => layer['id'] === E2E_XYZ_LAYER.id) ?? {};
    const layerOf = (year: number, suffix = ''): Record<string, unknown> => ({
        ...xyz,
        id: `e2e-${String(year)}${suffix}`,
        year,
        label: { ro: `Strat ${String(year)}${suffix} (e2e)`, en: `Layer ${String(year)}${suffix} (e2e)` },
    });
    const extra = years.filter((year) => !served.some((layer) => layer['year'] === year)).map((year) => layerOf(year));
    const twice = dated.flatMap((year) => [
        { ...layerOf(year, 'a'), date: `${String(year)}-05-01` },
        { ...layerOf(year, 'b'), date: `${String(year)}-06-02` },
    ]);
    const layers = [...served, ...extra, ...twice].map((layer, order) => ({ ...layer, order: order + 1 }));
    return { ...manifest, layers };
}

export interface Point {
    readonly x: number;
    readonly y: number;
}

export interface Rect extends Point {
    readonly width: number;
    readonly height: number;
}

/** The centre of stop `index` on the track (its tick, or its label's place standing). */
export async function stopCentre(page: Page, index: number): Promise<Point> {
    return viewer(page)
        .locator('hcm-timeline')
        .evaluate((element, at) => {
            const box = element.shadowRoot?.querySelectorAll('.stop')[at]?.getBoundingClientRect() ?? new DOMRect();
            const vertical = element.getAttribute('orientation') === 'vertical';
            return vertical ? { x: box.left + 26, y: box.top + box.height / 2 } : { x: box.left + box.width / 2, y: box.top + 4 };
        }, index);
}

/**
 * Puts the year pill on stop `index` with the keyboard and gives its centre: on a scrolling card a finger scrubs only
 * from the pill (elsewhere it scrolls the card or taps a year).
 */
export async function pillOn(page: Page, lang: Locale, index: number): Promise<Point> {
    const slider = page.getByRole('slider', { name: t(lang, 'timeline.label'), exact: true });
    await slider.focus();
    await page.keyboard.press('Home');
    for (let step = 0; step < index; step += 1) {
        await page.keyboard.press('ArrowRight');
    }
    await expect(slider).toHaveAttribute('aria-valuenow', String(index));
    const box = await viewer(page).locator('hcm-timeline .thumb').boundingBox();
    return { x: (box?.x ?? 0) + (box?.width ?? 0) / 2, y: (box?.y ?? 0) + (box?.height ?? 0) / 2 };
}

/** The chip's text and box, or null when none is shown. */
export async function yearChip(page: Page): Promise<{ readonly text: string; readonly box: Rect } | null> {
    return viewer(page)
        .locator('hcm-timeline')
        .evaluate((element) => {
            const tip = element.shadowRoot?.querySelector('.tip');
            if (tip === null || tip === undefined) {
                return null;
            }
            const box = tip.getBoundingClientRect();
            return { text: tip.textContent, box: { x: box.x, y: box.y, width: box.width, height: box.height } };
        });
}

/** The timeline card's box. */
export async function timelineCard(page: Page): Promise<Rect> {
    return viewer(page)
        .locator('hcm-timeline')
        .evaluate((element) => {
            const box = element.getBoundingClientRect();
            return { x: box.x, y: box.y, width: box.width, height: box.height };
        });
}

/** Chromium with touch events, for `touch`. */
export async function fingers(page: Page): Promise<CDPSession> {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    return cdp;
}

/** A finger down at `from`, then moved through `path` (each point one move); lifted only with `lift`. */
export async function touch(cdp: CDPSession, from: Point, path: readonly Point[], lift: boolean): Promise<void> {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
    for (const point of path) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x, y: point.y }] });
    }
    if (lift) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    }
}

/** Lifts the finger. */
export async function lift(cdp: CDPSession): Promise<void> {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

/** Whether two boxes share more than a pixel. */
export function meet(a: Rect, b: Rect): boolean {
    return a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1;
}
