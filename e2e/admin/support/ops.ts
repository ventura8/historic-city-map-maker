import { translateAdminContent, type AdminContentKey } from '@hcm/shared';
import { expect, type Locator, type Page } from '@playwright/test';

import type { CityWorld } from './content.js';
import { FUNCTIONS_TIMEOUT_MS } from './emulators.js';

/**
 * The operations screens' world for the admin tier (docs/research/M2c-interfaces.md §9; behaviours A02, A18, A22, A23 and
 * the dashboard): a city, its jobs and log lines as the raster pipeline would leave them, places whose writes the history
 * triggers record, and the editors' texts. Everything is written past the rules, as the server does.
 */

/** An editor text (`adminContent.*`) in the project's language. */
export function contentText(lang: 'ro' | 'en', key: AdminContentKey, params: Readonly<Record<string, string>> = {}): string {
    return translateAdminContent(lang, key, params);
}

/** The city document: bounds around Bucharest, published. */
export async function seedCity(world: CityWorld, at: Date): Promise<void> {
    await world.emulators.setDocument(`cities/${world.city}`, {
        name: { ro: 'București', en: 'Bucharest' },
        bounds: { west: 25.9, south: 44.3, east: 26.3, north: 44.6 },
        published: true,
        updatedBy: 'system:setup',
        updatedAt: at,
    });
}

/**
 * The lease a seeded running job is held by, far ahead: `imagery.tick` (which any test may run, over every city) takes a
 * running job whose lease lapsed for a lost execution and runs it again, and the stand-in runner then fails it for its
 * missing layer version, under a test that shows it running (`docs/LESSONS.md` 217). Since finding 58 the tick also
 * takes a running job whose last write is a few heartbeats old, whatever its lease, so the seeded job's last write is
 * the lease's end too (lesson 357).
 */
const HELD_LEASE = { owner: 'e2e-seeded-execution', until: new Date('2100-01-01T00:00:00.000Z') };

/**
 * A job of the city as the dispatcher and the pipeline keep it (`jobDocSchema`); a running one holds `HELD_LEASE` and
 * was last written at its end (no heartbeat is late).
 */
export async function seedJob(world: CityWorld, id: string, fields: Readonly<Record<string, unknown>>, at: Date): Promise<void> {
    await world.emulators.setDocument(`cities/${world.city}/jobs/${id}`, {
        params: {},
        createdAt: at,
        updatedBy: 'system:pipeline',
        updatedAt: at,
        ...(fields['status'] === 'running' ? { lease: HELD_LEASE, updatedAt: HELD_LEASE.until } : {}),
        ...fields,
    });
}

/** One redacted log line of a job (`jobLogDocSchema`, id: `seq` padded to six digits). */
export async function seedLogLine(world: CityWorld, jobId: string, seq: number, message: string, at: Date): Promise<void> {
    await world.emulators.setDocument(`cities/${world.city}/jobs/${jobId}/logs/${String(seq).padStart(6, '0')}`, {
        seq,
        level: 'info',
        step: 'fetch',
        message,
        updatedBy: 'system:pipeline',
        updatedAt: at,
    });
}

/** A place (`poiDocSchema`): its creation is recorded by `history.onPoiWrite`. */
export async function seedPlace(world: CityWorld, id: string, title: string, at: Date): Promise<void> {
    await world.emulators.setDocument(`cities/${world.city}/pois/${id}`, {
        category: 'monuments',
        geometry: { type: 'Point', point: { lat: 44.446, lng: 26.074 } },
        title: { ro: title },
        yearStart: 1890,
        published: false,
        createdAt: at,
        createdBy: 'system:bootstrap',
        updatedBy: 'system:bootstrap',
        updatedAt: at,
    });
}

/** Waits until the history triggers have recorded `count` entries of a place. */
export async function expectEntries(world: CityWorld, placeId: string, count: number): Promise<void> {
    await expect
        .poll(async () => Object.keys(await world.emulators.collection(`cities/${world.city}/pois/${placeId}/history`)).length, {
            timeout: FUNCTIONS_TIMEOUT_MS,
        })
        .toBe(count);
}

/**
 * The list and detail layout of the page: both panes side by side once its own area is 840 px wide (it says so with its
 * `split` attribute; the rail takes the rest of the window), never at a compact height; one pane otherwise, a phone's
 * (a compact width, or a landscape phone's compact height) as a full-screen editor without the navigation.
 */
export async function layoutOf(page: Page): Promise<{ readonly split: boolean; readonly phone: boolean; readonly closes: boolean }> {
    const { width, height } = page.viewportSize() ?? { width: 0, height: 0 };
    const split = (await page.locator('hcm-list-detail').getAttribute('split')) !== null;
    // A compact width's single pane has Close, any other's Back.
    return { split, phone: !split && (width < 600 || height < 480), closes: width < 600 };
}

/** From an open item back to its list where one pane shows at a time: Back, or Close on a phone (its full-screen editor). */
export async function backToList(page: Page, lang: 'ro' | 'en'): Promise<void> {
    const { split, closes } = await layoutOf(page);
    if (split) {
        return;
    }
    const name = contentText(lang, closes ? 'adminContent.common.close' : 'adminContent.common.back');
    await page.getByRole('button', { name, exact: true }).click();
}

/** The open dialog (its content is slotted into the kit's `hcm-dialog`, light DOM, so the element is the scope). */
export function dialog(page: Page): Locator {
    return page.locator('hcm-dialog[open]');
}
