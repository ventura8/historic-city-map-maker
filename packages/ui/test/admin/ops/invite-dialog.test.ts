/**
 * The Invite dialog of the admins page (`packages/ui/src/admin/admins/invite-dialog.ts`): open/closed state,
 * email and role submission (editor by default, owner when chosen), cancel and `hcm-close`, field validation
 * errors (`aria-invalid`, `aria-describedby`, `#email-error`), and busy state disabling the role select and submit button.
 */
import { render } from 'lit';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { adminsStyles, inviteDialog, type InviteDialogContext } from '../../../src/admin/admins/invite-dialog.js';
import { defineAll } from '../shell/fake-app.js';

const hosts: HTMLElement[] = [];

function must(root: ParentNode, selector: string): HTMLElement {
    const element = root.querySelector<HTMLElement>(selector);
    if (element === null) {
        throw new Error(`Missing element: ${selector}`);
    }
    return element;
}

function mountDialog(overrides: Partial<InviteDialogContext> = {}): {
    host: HTMLElement;
    submit: ReturnType<typeof vi.fn<InviteDialogContext['submit']>>;
    close: ReturnType<typeof vi.fn<InviteDialogContext['close']>>;
} {
    const submit = vi.fn<InviteDialogContext['submit']>(() => Promise.resolve());
    const close = vi.fn<InviteDialogContext['close']>();
    const host = document.body.appendChild(document.createElement('div'));
    hosts.push(host);
    render(
        inviteDialog({
            locale: 'en',
            open: true,
            busy: false,
            issue: null,
            city: 'Bucharest',
            submit,
            close,
            ...overrides,
        }),
        host,
    );
    return { host, submit, close };
}

describe('inviteDialog', () => {
    beforeAll(defineAll);

    afterEach(() => {
        for (const host of hosts.splice(0)) {
            host.remove();
        }
    });

    it('happyPath_rendersOpenDialogAndSubmitsEmailWithSelectedRole', () => {
        expect(adminsStyles.cssText).toContain('.rows.flush');
        const { host, submit } = mountDialog();
        const dialog = must(host, 'hcm-dialog') as HTMLElement & { open: boolean };
        const input = must(host, '#email') as HTMLInputElement;
        const role = must(host, '#invite-role') as HTMLSelectElement;
        const inviteButton = must(host, 'hcm-button[icon="person_add"]') as HTMLElement & { disabled: boolean };

        expect(dialog.open).toBe(true);
        expect(input.getAttribute('aria-invalid')).toBe('false');
        expect(input.getAttribute('aria-describedby')).toBeNull();
        expect(host.querySelector('#email-error')).toBeNull();
        expect(role.disabled).toBe(false);
        expect(inviteButton.disabled).toBe(false);

        input.value = 'editor@e2e.test';
        inviteButton.click();
        expect(submit).toHaveBeenLastCalledWith('editor@e2e.test', 'editor');

        input.value = 'owner@e2e.test';
        role.value = 'owner';
        inviteButton.click();
        expect(submit).toHaveBeenLastCalledWith('owner@e2e.test', 'owner');
    });

    it('happyPath_cancelButtonAndDialogCloseInvokeClose', () => {
        const { host, close } = mountDialog();
        const cancelButton = must(host, 'hcm-button[variant="text"]');
        const dialog = must(host, 'hcm-dialog');

        cancelButton.click();
        dialog.dispatchEvent(new CustomEvent('hcm-close'));

        expect(close).toHaveBeenCalledTimes(2);
    });

    it('badPath_showsFieldIssueAndDisablesControlsWhenBusy', () => {
        const { host } = mountDialog({
            open: false,
            busy: true,
            issue: { key: 'apiError.invite.alreadyAdmin' },
        });
        const dialog = must(host, 'hcm-dialog') as HTMLElement & { open: boolean };
        const field = must(host, '.field');
        const input = must(host, '#email') as HTMLInputElement;
        const error = must(host, '#email-error');
        const role = must(host, '#invite-role') as HTMLSelectElement;
        const inviteButton = must(host, 'hcm-button[icon="person_add"]') as HTMLElement & { disabled: boolean };

        expect(dialog.open).toBe(false);
        expect(field.hasAttribute('data-invalid')).toBe(true);
        expect(input.getAttribute('aria-invalid')).toBe('true');
        expect(input.getAttribute('aria-describedby')).toBe('email-error');
        expect(error.getAttribute('role')).toBe('alert');
        expect(error.textContent).toContain('already');
        expect(role.disabled).toBe(true);
        expect(inviteButton.disabled).toBe(true);
    });

    it('badPath_ignoresInviteClickWhenFormOrDialogIsMissing', () => {
        const { host, submit } = mountDialog();
        const inviteButton = must(host, 'hcm-button[icon="person_add"]');

        must(host, 'form').remove();
        inviteButton.click();

        host.append(inviteButton);
        inviteButton.click();

        expect(submit).not.toHaveBeenCalled();
    });
});
