/**
 * The Invite dialog of the admins page (`docs/research/M2c-interfaces.md` §9.1): the Google account's address (the page
 * checks it with `cityInviteRequestSchema` before the call), the problem at the field (`aria-invalid`, described by its
 * message), M5's role in the city (Editor unless changed: `inviteToCity` is three inputs), Cancel and Invite. Enter submits.
 */
import type { CityRole, UiLocale } from '@hcm/shared';
import { css, html, nothing, type TemplateResult } from 'lit';

import type { AdminNoticeInputPort } from '../admin-port.js';
import { contentText, noticeOf, shellText } from '../shell/text.js';
import { roleField } from './roles.js';

export const adminsStyles = css`
    .rows.flush {
        padding: 0;
    }

    form {
        display: flex;
        flex-direction: column;
        gap: 16px;
    }

    .field input {
        inline-size: 100%;
    }
`;

export interface InviteDialogContext {
    readonly locale: UiLocale;
    readonly open: boolean;
    readonly busy: boolean;
    readonly issue: AdminNoticeInputPort | null;
    /** M5: the city the invitation is to. */
    readonly city: string;
    readonly submit: (email: string, role: CityRole) => Promise<void>;
    readonly close: () => void;
}

export function inviteDialog(context: InviteDialogContext): TemplateResult {
    const { locale, issue } = context;
    const submit = (event: SubmitEvent): void => {
        event.preventDefault();
        const form = event.currentTarget as HTMLFormElement;
        const input = form.elements.namedItem('email') as HTMLInputElement;
        const role = (form.elements.namedItem('role') as HTMLSelectElement).value === 'owner' ? 'owner' : 'editor';
        void context.submit(input.value, role);
    };
    // The kit's button is not a native submit button: its click submits the form it sits in.
    const press = (event: Event): void => {
        (event.currentTarget as HTMLElement).closest('hcm-dialog')?.querySelector('form')?.requestSubmit();
    };
    return html`<hcm-dialog
        .open=${context.open}
        .headline=${contentText(locale, 'adminContent.admins.inviteHeadline')}
        .closeLabel=${contentText(locale, 'adminContent.common.cancel')}
        @hcm-close=${context.close}
    >
        <form @submit=${submit} novalidate>
            <p>${shellText(locale, 'adminShell.admins.intro')}</p>
            <div class="field" ?data-invalid=${issue !== null}>
                <label for="email">${shellText(locale, 'adminShell.admins.email')}</label>
                <input
                    id="email"
                    name="email"
                    type="email"
                    autocomplete="off"
                    spellcheck="false"
                    maxlength="254"
                    aria-invalid=${issue === null ? 'false' : 'true'}
                    aria-describedby=${issue === null ? nothing : 'email-error'}
                />
                ${issue === null ? nothing : html`<p id="email-error" class="error" role="alert">${noticeOf(locale, issue)}</p>`}
            </div>
            ${roleField({
                ...{ locale, id: 'invite-role', value: 'editor', disabled: context.busy },
                label: shellText(locale, 'adminShell.admins.inviteAs', { city: context.city }),
            })}
        </form>
        <hcm-button slot="actions" variant="text" @click=${context.close}>${contentText(locale, 'adminContent.common.cancel')}</hcm-button>
        <hcm-button slot="actions" variant="filled" icon="person_add" ?disabled=${context.busy} @click=${press}
            >${shellText(locale, 'adminShell.admins.invite')}</hcm-button
        >
    </hcm-dialog>`;
}
