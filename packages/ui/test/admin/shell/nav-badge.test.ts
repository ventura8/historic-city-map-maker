/**
 * The Notifications item's badge (`packages/ui/src/admin/shell/hcm-admin-nav.ts`; `docs/research/M4-interfaces.md`
 * §5.5): the unread count beside the icon in the rail, at the row's end in the expanded rail and the More sheet, on the
 * More button of the compact bar, read with the item's name; `99+` above the badge's maximum; none at zero or unknown.
 */
import { html } from 'lit';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { AdminDestinationPort } from '../../../src/admin/admin-port.js';
import { badgeText, type HcmAdminNav } from '../../../src/admin/shell/hcm-admin-nav.js';
import { cleanup, deep, deepAll, defineAll, mount, updated } from './fake-app.js';

const DESTINATIONS: readonly AdminDestinationPort[] = [
    { id: 'photos', icon: 'photo_library', compact: true },
    { id: 'jobs', icon: 'pending_actions', compact: false },
    { id: 'inbox', icon: 'notifications', compact: false },
];

async function nav(variant: 'bar' | 'rail' | 'expanded', unread: number | null): Promise<HcmAdminNav> {
    return mount<HcmAdminNav>(
        html`<hcm-admin-nav
            .destinations=${DESTINATIONS}
            current="photos"
            variant=${variant}
            locale="ro"
            .unread=${unread}
        ></hcm-admin-nav>`,
        variant === 'bar' ? 360 : 1300,
    );
}

function accessibleText(element: HTMLElement): string {
    return element.textContent.replace(/\s+/g, ' ').trim();
}

describe('the notifications badge', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_theRailCountsTheUnreadInTheItemsName', async () => {
        const element = await nav('rail', 3);
        const item = deep(element, 'a[href="#/inbox"]');

        expect(deep(item, '[data-badge]').textContent).toBe('3');
        // The badge itself is hidden from assistive technology: the name reads "Notificări, necitite: 3" (no plural form
        // to agree with the count: "1 necitite" was wrong).
        expect(deep(item, '[data-badge]').getAttribute('aria-hidden')).toBe('true');
        expect(accessibleText(item)).toBe('Notificări 3, necitite: 3');
        const badge = deep(item, '[data-badge]').getBoundingClientRect();
        const icon = deep(item, 'hcm-icon').getBoundingClientRect();
        expect(badge.left).toBeGreaterThanOrEqual(icon.right);
    });

    it('happyPath_theExpandedRailEndsTheRowWithTheBadge', async () => {
        const element = await nav('expanded', 120);
        const item = deep(element, 'a[href="#/inbox"]');

        expect(deep(item, '[data-badge]').textContent).toBe('99+');
        expect(getComputedStyle(deep(item, '[data-badge]')).position).toBe('static');
    });

    it('happyPath_theCompactBarsMoreButtonCarriesTheBadge', async () => {
        const element = await nav('bar', 1);

        expect(accessibleText(deep(element, 'button.item'))).toContain('necitite: 1');
        deep(element, 'button.item').click();
        await updated(element);
        expect(deepAll(element, '.more-list [data-badge]')).toHaveLength(1);
    });

    it.each([
        [null, null],
        [0, null],
        [99, '99'],
        [100, '99+'],
    ])('badPath_unread_%s_shows_%s', async (unread, text) => {
        const element = await nav('rail', unread);

        expect(badgeText(unread)).toBe(text);
        expect(deepAll(element, '[data-badge]')).toHaveLength(text === null ? 0 : 1);
    });
});
