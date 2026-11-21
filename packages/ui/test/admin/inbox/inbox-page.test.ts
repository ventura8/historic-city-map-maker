/**
 * `<hcm-inbox-page>` (`packages/ui/src/admin/inbox/hcm-inbox-page.ts`; `docs/research/M4-interfaces.md` §5.5): the
 * notifications as links in the admin's language, unread in bold and said, Mark all as read, the empty inbox, and the
 * push settings in every state of this browser. Text only, axe-clean. Every value is a generated test value.
 */
import { DEFAULT_PUSH_KINDS, NOTIFICATION_KINDS } from '@hcm/shared';
import { axeViolations } from '@hcm/test-support/axe';
import { html } from 'lit';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { AREA_ELEMENTS } from '../../../src/admin/areas/inbox.js';
import { notificationMessage } from '../../../src/admin/inbox/hcm-inbox-page.js';
import type { InboxIntentsPort, InboxRowPort, InboxViewState } from '../../../src/admin/inbox/inbox-port.js';
import { FakeArea } from '../editing/fake-area.js';
import { adminState, cleanup, deep, deepAll, deepText, defineAll, FakeAdminApp, mount, updated } from '../shell/fake-app.js';

function row(overrides: Partial<InboxRowPort> = {}): InboxRowPort {
    return {
        id: 'job.failed~bucharest~job-1~0',
        kind: 'job.failed',
        severity: 'error',
        params: { label: '<b>Corona</b> 1966', labelEn: '<b>Corona</b> 1966 (EN)' },
        link: '#/imagery/version/job-1',
        createdAt: '2026-10-24T08:00:00.000Z',
        read: false,
        ...overrides,
    };
}

function inboxState(overrides: Partial<InboxViewState> = {}): InboxViewState {
    return {
        list: {
            status: 'ready',
            items: [
                row(),
                row({
                    id: 'budget.paused~2026-10-01',
                    kind: 'budget.paused',
                    severity: 'warning',
                    read: true,
                    params: { cost: '5.20', budget: '5.00', currency: 'USD' },
                    link: '#/imagery',
                }),
            ],
            hasMore: true,
            reconnecting: false,
            failure: null,
        },
        settings: { status: 'ready', push: true, kinds: DEFAULT_PUSH_KINDS, saving: false },
        push: { device: 'off', failure: null, reason: null, testing: false },
        marking: false,
        ...overrides,
    };
}

async function inboxPage(state: InboxViewState, options: { readonly locale?: 'ro' | 'en'; readonly revoked?: boolean } = {}) {
    const area = new FakeArea<InboxViewState, InboxIntentsPort>(state, {
        markAllRead: Promise.resolve(),
        setKind: Promise.resolve(),
        turnOnPush: Promise.resolve(),
        turnOffPush: Promise.resolve(),
        sendTest: Promise.resolve(),
    });
    const app = new FakeAdminApp(
        adminState({ route: { id: 'inbox', params: [] }, locale: options.locale ?? 'en', revoked: options.revoked === true }),
    );
    app.areas.inbox = area;
    const host = await mount<HTMLElement>(html`<div class="box"></div>`, 1000);
    const element = document.createElement(AREA_ELEMENTS.tag) as HTMLElement & { app: unknown; state: unknown };
    element.app = app;
    element.state = app.state;
    host.append(element);
    await updated(element);
    return { area, element };
}

describe('<hcm-inbox-page>', () => {
    beforeAll(() => {
        defineAll();
        AREA_ELEMENTS.define(customElements);
    });
    afterEach(cleanup);

    it('happyPath_markAllIsOfferedForUnreadItemsPastTheLoadedPage @S-A46-HAPPY-MARK-ALL-READ', async () => {
        const read = inboxState().list.items.map((row) => ({ ...row, read: true }));
        const { element } = await inboxPage(inboxState({ list: { ...inboxState().list, items: read } }));
        const button = (): HTMLElement => deep(deep(element, '.head'), 'hcm-button');
        expect(button().hasAttribute('disabled')).toBe(true);

        (element as HTMLElement & { state: object }).state = { ...(element as HTMLElement & { state: object }).state, unread: 3 };
        await updated(element);

        expect(button().hasAttribute('disabled')).toBe(false);
    });

    it('happyPath_eachNotificationIsALinkToItsPageAndOpeningItMarksItRead', async () => {
        const { area, element } = await inboxPage(inboxState());

        const links = deepAll(element, 'a.row');
        expect(links.map((link) => [link.getAttribute('href'), link.hasAttribute('data-unread')])).toEqual([
            ['#/imagery/version/job-1', true],
            ['#/imagery', false],
        ]);
        expect(links[0]?.textContent).toContain('Processing “<b>Corona</b> 1966 (EN)” failed. Open it to see why.');
        expect(links[0]?.textContent).toContain('Problem.');
        expect(links[0]?.textContent).toContain(', unread');
        expect(deepAll(element, 'a.row b')).toHaveLength(0);
        links[0]?.addEventListener('click', (event) => {
            event.preventDefault();
        });
        links[0]?.click();
        deep(deep(element, '.head'), 'hcm-button').click();
        deep(deep(element, '.more'), 'hcm-button').click();

        expect(area.calls.filter((call) => !call.startsWith('open'))).toEqual([
            'markRead "job.failed~bucharest~job-1~0"',
            'markAllRead',
            'more',
        ]);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_romanianReadersReadRomanianParameters', () => {
        expect(notificationMessage('ro', row())).toBe('Procesarea „<b>Corona</b> 1966” a eșuat. Deschide-o ca să vezi de ce.');
    });

    it('badPath_anEmptyInboxSaysSoAndMarksNothing', async () => {
        const { element } = await inboxPage(
            inboxState({ list: { status: 'ready', items: [], hasMore: false, reconnecting: false, failure: null } }),
            {
                locale: 'ro',
            },
        );

        expect(deepText(element)).toContain('Nicio notificare deocamdată.');
        expect(deep(deep(element, '.head'), 'hcm-button').hasAttribute('disabled')).toBe(true);
    });

    it('happyPath_thePushSwitchesTurnKindsAndThisDeviceOnAndOff', async () => {
        const { area, element } = await inboxPage(inboxState());
        const kinds = deepAll(element, 'li[data-kind]');
        expect(kinds.map((kind) => kind.getAttribute('data-kind'))).toEqual([...NOTIFICATION_KINDS]);

        deep(kinds[2] ?? element, 'hcm-switch').dispatchEvent(new CustomEvent('hcm-change', { detail: { checked: true } }));
        deep(deep(element, '[data-push="off"]'), 'hcm-switch').dispatchEvent(new CustomEvent('hcm-change', { detail: { checked: true } }));
        area.set({ push: { device: 'on', failure: null, reason: null, testing: false } });
        await updated(element);
        deep(deep(element, '[data-push="on"]'), 'hcm-switch').dispatchEvent(new CustomEvent('hcm-change', { detail: { checked: false } }));
        deep(deep(element, '[data-settings] .actions'), 'hcm-button').click();

        expect(area.calls.filter((call) => !call.startsWith('open'))).toEqual([
            'setKind "order.imported" true',
            'turnOnPush',
            'turnOffPush',
            'sendTest',
        ]);
        expect(deepText(element)).toContain('Notifications are on for this device.');
        expect(await axeViolations(element)).toEqual([]);
    });

    it.each([
        ['denied', null, 'The browser refused notifications'],
        ['failed', { key: 'apiError.unavailable' }, 'Notifications did not start: The service is unavailable right now.'],
        ['unsupported', null, 'This browser cannot show notifications'],
        ['working', null, 'Turning notifications on…'],
    ] as const)('badPath_thisBrowser_%s_saysSo', async (device, failure, text) => {
        const { element } = await inboxPage(inboxState({ push: { device, failure, reason: null, testing: false } }));

        expect(deepText(element)).toContain(text);
    });

    it('badPath_aFailureSaysWhyWithItsCode', async () => {
        // Finding 46 of 2026-11-01: the failure's reason line names the SDK's or FCM's code.
        const failure = { key: 'apiError.notify.deviceInvalid' } as const;
        const reason = { key: 'adminContent.notify.push.reason.fcmRefused', params: { code: 'fcm/UNREGISTERED' } } as const;
        const { element } = await inboxPage(inboxState({ push: { device: 'failed', failure, reason, testing: false } }));

        expect(deep(element, '.reason').textContent).toBe("Why: Google's messaging service refused this browser, even registered again.");
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_aRevokedAdminsSwitchesAndButtonsAreOff', async () => {
        const { element } = await inboxPage(inboxState({ push: { device: 'on', failure: null, reason: null, testing: false } }), {
            revoked: true,
        });

        expect(deepAll(element, 'hcm-switch').every((control) => control.hasAttribute('disabled'))).toBe(true);
        expect(deep(deep(element, '[data-settings] .actions'), 'hcm-button').hasAttribute('disabled')).toBe(true);
    });
});
