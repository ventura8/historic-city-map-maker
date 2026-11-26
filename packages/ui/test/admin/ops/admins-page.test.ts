import { axeViolations } from '@hcm/test-support/axe';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { AdminsIntentsPort, AdminsViewState } from '../../../src/admin/admins/admins-port.js';
import { FakeArea } from '../editing/fake-area.js';
import { cleanup, deep, deepAll, deepText, defineAll, updated } from '../shell/fake-app.js';
import { adminsState, page } from './fixtures.js';

/** What the shell hands the page after the state changed (the page reads its `state` property, not the app). */
function shellState(element: HTMLElement, state: unknown): void {
    (element as HTMLElement & { state: unknown }).state = state;
}

const INVITED = { inviteId: 'a'.repeat(64), expiresAt: '2026-10-24T10:00:00.000Z', signInUrl: 'https://demo-hcm.web.app/' };

function area(
    state: AdminsViewState,
    answers: Partial<Record<keyof AdminsIntentsPort, unknown>> = {},
): FakeArea<AdminsViewState, AdminsIntentsPort> {
    return new FakeArea<AdminsViewState, AdminsIntentsPort>(state, {
        invite: Promise.resolve({ ok: true, value: INVITED }),
        revoke: Promise.resolve({ ok: true, value: { revoked: true } }),
        setRole: Promise.resolve({ ok: true, value: { role: 'owner' } }),
        refresh: Promise.resolve(),
        ...answers,
    });
}

async function openInvite(element: HTMLElement): Promise<HTMLInputElement> {
    deep(element, '.list-head hcm-button').click();
    await updated(element);
    return deep(element, '#email') as HTMLInputElement;
}

describe('<hcm-admins-page>', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_theAdminsAndInvitationsAsLinksToTheirDetail', async () => {
        const admins = area(adminsState());
        const { element } = await page('admins', admins);

        const rows = deepAll(element, 'a.row');
        expect(rows.map((row) => row.getAttribute('href'))).toEqual([
            '#/admins/owner-uid',
            '#/admins/admin-uid',
            '#/admins/quiet-uid',
            `#/admins/invite/${'a'.repeat(64)}`,
        ]);
        expect(rows[0]?.textContent).toContain('Owner · The project’s owner · You');
        expect(rows[1]?.textContent).toContain('Editor');
        expect(rows[2]?.textContent).toContain('Google account without an address');
        expect(rows[3]?.textContent).toContain('Expires on Oct 24, 2026');
        expect(deepText(element)).toContain('Choose an admin or an invitation to see its details.');
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_anAdminsDetailAndRemovingTheirAccessAfterTheQuestion', async () => {
        const admins = area(adminsState({ selected: { kind: 'admin', uid: 'admin-uid' } }));
        const { element, app } = await page('admins', admins, { params: ['admin-uid'] });

        expect(deep(element, 'h2[data-detail-heading]').textContent).toBe('ana@e2e.test');
        expect(deepText(deep(element, '.facts'))).toContain('Editor');
        deep(element, '.pane > .actions hcm-button').click();
        await updated(element);
        const dialog = deep(element, 'hcm-confirm-dialog') as HTMLElement & { headline: string; open: boolean };
        expect([dialog.open, dialog.headline]).toEqual([true, 'Remove access for ana@e2e.test?']);
        expect(await axeViolations(element)).toEqual([]);
        deep(dialog, '.confirm').click();
        await updated(element);

        expect(admins.named('revoke')).toEqual(['revoke {"kind":"admin","uid":"admin-uid"}']);
        expect(app.named('navigate')).toEqual(['navigate {"id":"admins","params":[]}']);
    });

    it('badPath_aReadOnlyPageNeitherInvitesNorRemoves', async () => {
        const admins = area(adminsState({ selected: { kind: 'admin', uid: 'admin-uid' } }));
        const { element } = await page('admins', admins, { params: ['admin-uid'], revoked: true });
        const off = (target: HTMLElement): boolean => (target as HTMLElement & { disabled: boolean }).disabled;

        expect(off(deep(element, '.pane > .actions hcm-button'))).toBe(true);
        // The list's Invite (the dialog's own Invite cannot open without it).
        const invite = deepAll(element, 'hcm-button').find((button) => button.textContent.includes('Invite'));
        expect(invite === undefined ? false : off(invite)).toBe(true);
    });

    it('badPath_cancellingTheQuestionKeepsTheAdmin', async () => {
        const admins = area(adminsState({ selected: { kind: 'admin', uid: 'admin-uid' } }));
        const { element } = await page('admins', admins, { params: ['admin-uid'] });

        deep(element, '.pane > .actions hcm-button').click();
        await updated(element);
        deep(deep(element, 'hcm-confirm-dialog'), '.cancel').click();
        await updated(element);

        expect(admins.named('revoke')).toEqual([]);
    });

    it('badPath_oneselfOffersNoRemovalAndSaysWhy', async () => {
        // The project's owner, oneself here: the map always keeps its owner.
        const admins = area(adminsState({ selected: { kind: 'admin', uid: 'owner-uid' } }));
        const { element } = await page('admins', admins, { params: ['owner-uid'] });

        expect(deepText(element)).toContain("The owner's access cannot be removed");
        expect(deepAll(element, '.pane > .actions hcm-button')).toHaveLength(0);

        // Any other admin, oneself: not one's own access, editor or owner of the city alike.
        const list = adminsState().list;
        const others = list === null ? [] : list.admins.map((admin) => ({ ...admin, self: admin.uid === 'quiet-uid' }));
        admins.set({ selected: { kind: 'admin', uid: 'quiet-uid' }, list: list === null ? null : { ...list, admins: others } });
        await updated(element);
        expect(deepText(element)).toContain('You cannot remove your own access');
    });

    it('badPath_theProjectsOwnerSeenByAnotherOwnerHasNoRemovalAndNoRoleChange @S-A51-BAD-PROJECT-OWNER-STAYS', async () => {
        // docs/LESSONS.md 243: the server keeps the project's owner an owner of every city they belong to.
        const list = adminsState().list;
        const seenByAnother = list === null ? [] : list.admins.map((admin) => ({ ...admin, self: admin.uid === 'admin-uid' }));
        const admins = area(
            adminsState({
                selected: { kind: 'admin', uid: 'owner-uid' },
                list: list === null ? null : { ...list, admins: seenByAnother },
            }),
        );
        const { element } = await page('admins', admins, { params: ['owner-uid'] });

        expect(deepText(element)).toContain("The owner's access cannot be removed");
        expect(deepAll(element, '.pane > .actions hcm-button')).toHaveLength(0);
        expect((deep(element, '.pane select#role') as HTMLSelectElement).disabled).toBe(true);
    });

    it('badPath_aRefusedRemovalShowsTheServersReason', async () => {
        const admins = area(adminsState({ selected: { kind: 'admin', uid: 'admin-uid' } }), {
            revoke: Promise.resolve({ ok: false, error: { key: 'apiError.revoke.self' } }),
        });
        const { element, app } = await page('admins', admins, { params: ['admin-uid'] });

        deep(element, '.pane > .actions hcm-button').click();
        await updated(element);
        deep(deep(element, 'hcm-confirm-dialog'), '.confirm').click();
        await updated(element);

        expect(deep(element, '.pane [role="alert"]').textContent).toContain('You cannot remove yourself');
        expect(app.named('navigate')).toEqual([]);
    });
});

/** M5 (docs/research/M5-interfaces.md §1.7): each admin's role in the city, which only the city's owners change. */
describe('<hcm-admins-page>: roles in the city', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_anOwnerMakesAnEditorAnOwnerAfterTheQuestion @S-A51-HAPPY-ROLE', async () => {
        const admins = area(adminsState({ selected: { kind: 'admin', uid: 'admin-uid' } }));
        const { element } = await page('admins', admins, { params: ['admin-uid'] });
        const select = deep(element, '#role') as HTMLSelectElement;
        expect(deepText(element)).toContain('Role of ana@e2e.test in Bucharest');

        select.value = 'editor';
        select.dispatchEvent(new Event('change'));
        await updated(element);
        expect((deep(element, 'hcm-confirm-dialog') as HTMLElement & { open: boolean }).open).toBe(false);
        select.value = 'owner';
        select.dispatchEvent(new Event('change'));
        await updated(element);
        const dialog = deep(element, 'hcm-confirm-dialog') as HTMLElement & { headline: string; open: boolean };
        expect([dialog.open, dialog.headline]).toEqual([true, 'Make ana@e2e.test owner of Bucharest?']);
        deep(dialog, '.confirm').click();
        await updated(element);

        expect(admins.named('setRole')).toEqual(['setRole "admin-uid" "owner"']);
        expect(admins.named('revoke')).toEqual([]);
    });

    it('badPath_aRefusedRoleChangeShowsWhy @S-A51-BAD-LAST-OWNER', async () => {
        const admins = area(adminsState({ selected: { kind: 'admin', uid: 'admin-uid' } }), {
            setRole: Promise.resolve({ ok: false, error: { key: 'apiError.city.lastOwner' } }),
        });
        const { element } = await page('admins', admins, { params: ['admin-uid'] });
        const select = deep(element, '#role') as HTMLSelectElement;

        select.value = 'owner';
        select.dispatchEvent(new Event('change'));
        await updated(element);
        deep(deep(element, 'hcm-confirm-dialog'), '.confirm').click();
        await updated(element);

        expect(deep(element, '.pane [role="alert"]').textContent).toContain('at least one owner');
    });

    it('badPath_anEditorOfTheCitySeesTheListOnly @S-A51-BAD-EDITOR-INVITES', async () => {
        const admins = area(adminsState({ selected: { kind: 'invite', inviteId: 'a'.repeat(64) } }));
        const { element, app } = await page('admins', admins, { params: ['invite', 'a'.repeat(64)] });
        app.set({ cities: [{ id: 'bucharest', role: 'editor', name: { ro: 'București' } }], projectOwner: false });
        shellState(element, app.state);
        await updated(element);

        expect(deepText(element)).toContain('Only the city’s owners invite, remove and change roles.');
        expect(deepAll(element, '.list-head hcm-button')).toHaveLength(0);
        expect(deepAll(element, '.pane > .actions hcm-button')).toHaveLength(0);

        admins.set({ selected: { kind: 'admin', uid: 'admin-uid' } });
        app.set({ route: { id: 'admins', params: ['admin-uid'] } });
        shellState(element, app.state);
        await updated(element);
        expect(deepAll(element, '#role')).toHaveLength(0);
        expect(deepAll(element, '.pane > .actions hcm-button')).toHaveLength(0);
    });
});

describe('<hcm-admins-page>: invitations and failures', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_anInvitationIsMadeItsLinkCopiedAtOnceAndAgainAndThenCancelled', async () => {
        const admins = area(adminsState());
        const { element, app } = await page('admins', admins);
        const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
        const input = await openInvite(element);
        input.value = 'new.admin@e2e.test';
        deep(element, 'hcm-dialog hcm-button[icon="person_add"]').click();
        await updated(element);

        expect(admins.named('invite')).toEqual(['invite "new.admin@e2e.test" "editor"']);
        expect(app.named('navigate')).toEqual([`navigate {"id":"admins","params":["invite","${'a'.repeat(64)}"]}`]);
        await vi.waitFor(() => {
            expect(writeText.mock.calls).toEqual([['https://demo-hcm.web.app/']]);
        });

        admins.set({ selected: { kind: 'invite', inviteId: 'a'.repeat(64) }, invited: INVITED });
        await updated(element);
        expect(deepAll(element, '[role="status"]').map((status) => status.textContent.trim())).toContain('The link was copied.');
        deepAll(element, '.pane .actions hcm-button')[0]?.click();
        await updated(element);
        expect(writeText).toHaveBeenCalledTimes(2);

        deepAll(element, '.pane .actions hcm-button')[1]?.click();
        await updated(element);
        deep(deep(element, 'hcm-confirm-dialog'), '.confirm').click();
        await updated(element);
        expect(admins.named('revoke')).toEqual([`revoke {"kind":"invite","inviteId":"${'a'.repeat(64)}"}`]);
    });

    it('badPath_anInvalidAddressIsShownAtTheFieldAndARefusalToo', async () => {
        const admins = area(adminsState(), { invite: Promise.resolve({ ok: false, error: { key: 'apiError.invite.alreadyAdmin' } }) });
        const { element } = await page('admins', admins);
        const input = await openInvite(element);

        input.value = 'not an address';
        input.closest('form')?.requestSubmit();
        await updated(element);
        expect(input.getAttribute('aria-invalid')).toBe('true');
        expect(deep(element, '#email-error').textContent).toBe('Enter a valid e-mail address.');
        expect(admins.named('invite')).toEqual([]);

        input.value = 'ana@e2e.test';
        input.closest('form')?.requestSubmit();
        await updated(element);
        expect(deep(element, '#email-error').textContent).toContain('already');
        const role = deep(element, '#invite-role') as HTMLSelectElement;
        role.value = 'owner';
        input.closest('form')?.requestSubmit();
        await updated(element);
        expect(admins.named('invite').at(-1)).toBe('invite "ana@e2e.test" "owner"');
        deep(element, 'hcm-dialog hcm-button[variant="text"]').click();
        await updated(element);
        expect((deep(element, 'hcm-dialog') as HTMLElement & { open: boolean }).open).toBe(false);
    });

    it('badPath_aClipboardThatRefusesTheNewLinkLeavesItWithCopy', async () => {
        const admins = area(adminsState());
        const { element } = await page('admins', admins);
        const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
        const input = await openInvite(element);
        input.value = 'new.admin@e2e.test';
        input.closest('form')?.requestSubmit();
        await updated(element);
        await vi.waitFor(() => {
            expect(writeText).toHaveBeenCalledTimes(1);
        });

        admins.set({ selected: { kind: 'invite', inviteId: 'a'.repeat(64) }, invited: INVITED });
        await updated(element);
        expect(deepAll(element, '[role="status"]').map((status) => status.textContent.trim())).not.toContain('The link was copied.');
        expect(deepAll(element, '.pane .actions hcm-button')).toHaveLength(2);
    });

    it('badPath_anOlderInvitationExplainsTheLinkAndAClipboardRefusalSelectsIt', async () => {
        const admins = area(adminsState({ selected: { kind: 'invite', inviteId: 'a'.repeat(64) } }));
        const { element } = await page('admins', admins, { params: ['invite', 'a'.repeat(64)] });
        expect(deepText(element)).toContain('opens the admin');

        admins.set({ invited: INVITED });
        await updated(element);
        vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
        deepAll(element, '.pane .actions hcm-button')[0]?.click();
        await updated(element);
        const link = deep(element, '#link') as HTMLInputElement;

        expect([link.selectionStart, link.selectionEnd]).toEqual([0, 'https://demo-hcm.web.app/'.length]);
    });

    it('badPath_withoutAStoreThePageIsEmptyAndAnInvitationWithoutAnAnswerKeepsTheDialog', async () => {
        const { element } = await page('admins', null);
        expect(element.shadowRoot?.childElementCount).toBe(0);
        cleanup();

        const silent = new FakeArea<AdminsViewState, AdminsIntentsPort>(adminsState());
        const second = await page('admins', silent);
        const input = await openInvite(second.element);
        input.value = 'new.admin@e2e.test';
        input.closest('form')?.requestSubmit();
        await updated(second.element);

        expect(silent.named('invite')).toEqual(['invite "new.admin@e2e.test" "editor"']);
        expect((deep(second.element, 'hcm-dialog') as HTMLElement & { open: boolean }).open).toBe(true);
    });

    it('badPath_loadingAFailedListWithTryAgainAndAnUnknownAddress', async () => {
        const admins = area(adminsState({ status: 'loading', list: null, selected: { kind: 'admin', uid: 'x' } }));
        const { element } = await page('admins', admins, { params: ['x'] });
        expect(deepAll(element, 'hcm-loading-indicator')).toHaveLength(2);

        admins.set({ status: 'error', failure: { key: 'apiError.unavailable' } });
        await updated(element);
        deep(element, '.pane .actions hcm-button').click();
        expect(admins.named('refresh')).toEqual(['refresh']);
        expect(deepAll(element, '[role="alert"]')).toHaveLength(1);

        admins.set({ status: 'ready', list: { admins: [], invites: [] }, failure: null });
        await updated(element);
        expect(deep(element, 'h2[data-detail-heading]').textContent).toBe('This admin or invitation no longer exists.');
        expect(deepText(element)).toContain('No pending invitations.');
    });
});
