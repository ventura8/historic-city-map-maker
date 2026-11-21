import { notificationEventId, translateAdminContent, type AdminContentKey } from '@hcm/shared';
import type { Locator, Page } from '@playwright/test';

import type { CityWorld } from '../../support/content.js';
import { seedJob } from '../../support/ops.js';

/**
 * The notifications' world in the admin tier (behaviours A46, A47; docs/research/M4-interfaces.md §5): the owner's inbox,
 * filled by the real chain (a job written as failed → `imagery.onJobWrite` emits `job.failed` → `notify.onEvent` fans it
 * out to every admin, and pushes it to their devices). The specs hold the admin tier's lock, whose reset empties the
 * inboxes, the events and the server's fake FCM before each test; a content spec may still fail a job of its own city
 * meanwhile, so the specs look for their own items and never count the inbox exactly.
 */

/** A job of the city written as the pipeline leaves a failed import: the job's type names it (no layer version). */
export async function failJob(city: CityWorld, jobId: string, at: Date): Promise<void> {
    await seedJob(
        city,
        jobId,
        {
            type: 'usgs-import',
            params: { entityId: 'DS1035-1057DA023', dataset: 'corona2', sensor: 'KH-4A' },
            status: 'failed',
            attempt: 1,
            createdBy: city.uid,
            error: { code: 'apiError.imagery.archiveCorrupt', message: 'the archive could not be read' },
        },
        at,
    );
}

/** The id of the inbox item a failed job's event gives (one per attempt). */
export function failedItemId(city: CityWorld, jobId: string): string {
    return notificationEventId('job.failed', city.city, jobId, '1');
}

/** An admin text (`adminContent.notify.*`). */
export function notifyText(lang: 'ro' | 'en', key: AdminContentKey, params: Readonly<Record<string, string>> = {}): string {
    return translateAdminContent(lang, key, params);
}

/** The inbox row of item `id`. */
export function inboxRow(page: Page, id: string): Locator {
    return page.locator(`hcm-inbox-page a.row[data-item="${id}"]`);
}

/** The navigation's unread badge (on Notifications, or on More when the bar holds it). */
export function navBadge(page: Page): Locator {
    return page.locator('hcm-admin-nav [data-badge]');
}

/**
 * A name that ends with the unread count as the badge reads it (`, 3 unread`), whatever the count. Chromium joins the
 * label and the visually hidden count with a space (`Notifications , 3 unread`): the hidden text is positioned, so a block.
 */
export function unreadName(lang: 'ro' | 'en'): RegExp {
    const [before, after] = notifyText(lang, 'adminContent.notify.badge', { count: '#' }).split('#');
    const escape = (text: string | undefined): string => (text ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(` ?, ${escape(before)}\\d+\\+?${escape(after)}$`);
}
