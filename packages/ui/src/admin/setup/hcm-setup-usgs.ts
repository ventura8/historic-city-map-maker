/**
 * The USGS card's body (step f, `docs/research/M2b-interfaces.md` §3.3 f): the registration answers and the M2M
 * access request to copy, the ERS username (one fill), "Open the USGS token page" (one click: the paste box is focused
 * and the 60 s countdown starts, then the link opens ERS in a new tab), and the paste box (`type=password`): a paste
 * with the username filled saves at once (no Save click); Enter does the same for a typed token. The token's optional
 * expiry is typed in the admin's language (`zz.ll.aaaa`, `dd/mm/yyyy`). A countdown that ends
 * says so and the box stays open. After saving: the role, the next check of a pending approval, the expiry reminder.
 * M6 (setup-ux, finding 16 of 2026-10-25): **Do it later** (one input) postpones the step, which then says so; a token
 * waiting for USGS's approval says since when.
 */
import { USGS_ACCESS_PENDING, type AdminSetupKey, type UsgsRole } from '@hcm/shared';
import { css, html, nothing, type TemplateResult } from 'lit';

import { defineHcmButton } from '../../components/button.js';
import { defineOnce } from '../../components/internal.js';
import { defineHcmProgress } from '../../components/progress.js';
import { visuallyHidden } from '../../components/styles.js';
import { formatDateInput, parseDateInput } from '../editing/date-text.js';
import { EMPTY } from '../shell/empty.js';
import { contentText } from '../shell/text.js';
import { SetupBody, defineSetupBodyParts } from './setup-body.js';
import type { SetupViewState } from './setup-port.js';
import { copyStyles, fieldStyles, linkButtonStyles, setupTextStyles } from './setup-styles.js';
import { formatDate, formatDateTime } from './setup-text.js';

const HCM_SETUP_USGS_TAG = 'hcm-setup-usgs';

/** ERS shows a new token for about this long (the countdown's full length). */
const TOKEN_SECONDS = 60;

/** The username (trimmed) and the expiry date the card's fields hold, from the state. */
function typedFields(view: SetupViewState | null): { readonly username: string; readonly expiresOn: string } {
    return view === null ? { username: '', expiresOn: '' } : { username: view.usgs.username.trim(), expiresOn: view.usgs.expiresOn };
}

export class HcmSetupUsgs extends SetupBody {
    static override readonly properties = { ...SetupBody.properties, needsUsername: { state: true }, expiryUnread: { state: true } };

    static override readonly styles = [
        setupTextStyles,
        fieldStyles,
        copyStyles,
        visuallyHidden,
        linkButtonStyles,
        css`
            .countdown {
                font-family: var(--md-sys-typescale-title-medium-font);
                font-size: var(--md-sys-typescale-title-medium-size);
            }
        `,
    ];

    /** A token was pasted before the username: the hint says to fill it first. */
    declare needsUsername: boolean;
    /** The expiry date typed does not read as a date: said at the field, nothing kept. */
    declare expiryUnread: boolean;

    constructor() {
        super();
        this.needsUsername = false;
        this.expiryUnread = false;
    }

    protected override renderBody(state: SetupViewState): TemplateResult {
        return html`<div class="body">
            ${this.renderLater(state)} ${this.renderRequest(state)}
            <div class="field">
                <label for="usgs-username">${this.t('adminSetup.usgs.username')}</label>
                <input
                    id="usgs-username"
                    autocomplete="username"
                    spellcheck="false"
                    .value=${state.usgs.username}
                    @input=${this.onUsername}
                    @change=${this.onFilled}
                />
            </div>
            ${this.renderExpiryField(state)}
            <div class="actions">
                <a
                    class="link-button"
                    href=${state.usgs.tokenPageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    @click=${this.onOpenTokenPage}
                    >${this.t('adminSetup.usgs.openTokenPage')}<span class="visually-hidden"> ${this.t('adminSetup.newTab')}</span></a
                >
            </div>
            ${this.renderTokenBox(state)} ${this.renderStatus(state)}
        </div>`;
    }

    /**
     * The token's expiry as an M3 date input field in the admin's language (`zz.ll.aaaa`, `dd/mm/yyyy`), never the browser's
     * date input, whose pattern follows the browser's language (`../editing/date-text.ts`).
     */
    private renderExpiryField(state: SetupViewState): TemplateResult {
        const pattern = contentText(this.locale, 'adminContent.common.datePattern');
        const hint = this.expiryUnread ? 'adminContent.common.dateUnread' : 'adminContent.common.dateHint';
        return html`<div class="field">
            <label for="usgs-expires">${this.t('adminSetup.usgs.expiresOn')}</label>
            <input
                id="usgs-expires"
                type="text"
                autocomplete="off"
                placeholder=${pattern}
                aria-describedby="usgs-expires-hint"
                aria-invalid=${this.expiryUnread ? 'true' : 'false'}
                .value=${formatDateInput(this.locale, state.usgs.expiresOn)}
                @change=${this.onExpiry}
            />
            <p id="usgs-expires-hint" class="hint">${contentText(this.locale, hint, { pattern })}</p>
        </div>`;
    }

    /**
     * Do it later while the step is to do; once postponed, what that means. Not while a saved token waits for USGS's
     * approval: Setup is done already, and postponing would only turn Home's "waiting since" into "not set up" (finding 8
     * of the M6 review).
     */
    private renderLater(state: SetupViewState): TemplateResult {
        const step = this.step(state, 'usgs');
        if (step.state === 'ok' || step.detail?.key === USGS_ACCESS_PENDING) {
            return EMPTY;
        }
        if (state.usgs.postponedAt !== null) {
            return html`<p class="note postponed">${this.t('adminSetup.usgs.postponed')}</p>`;
        }
        return html`<div class="later">
            <p class="note">${this.t('adminSetup.usgs.laterWhy')}</p>
            <div class="actions">
                <hcm-button
                    variant="outlined"
                    icon="pending_actions"
                    ?disabled=${step.busy}
                    @click=${() => {
                        this.act((intents) => {
                            intents.postponeUsgs();
                        });
                    }}
                    >${this.t('adminSetup.usgs.later')}</hcm-button
                >
            </div>
        </div>`;
    }

    private renderRequest(state: SetupViewState): TemplateResult {
        const area = state.usgs.area === null ? '' : this.t('adminSetup.usgs.area', { area: state.usgs.area });
        const request = [this.t('adminSetup.usgs.justification'), this.t('adminSetup.usgs.datasets'), area].filter((line) => line !== '');
        return html`<p class="note">${this.t('adminSetup.usgs.answers')}</p>
            <div class="copy-row">
                <span>${request.map((line) => html`<span>${line}</span>`)}</span>
                ${this.copyButton('request', this.t('adminSetup.usgs.copyRequest'), request.join(' '))}
            </div>`;
    }

    private renderTokenBox(state: SetupViewState): TemplateResult {
        const { secondsLeft, expired } = state.usgs;
        return html`<div class="field">
            <label for="usgs-token">${this.t('adminSetup.usgs.token')}</label>
            <input
                id="usgs-token"
                type="password"
                autocomplete="off"
                spellcheck="false"
                aria-describedby="usgs-hint"
                @paste=${this.onPaste}
                @input=${this.onTokenInput}
                @keydown=${this.onTokenKey}
            />
            <p id="usgs-hint" class="hint">${this.t(this.needsUsername ? 'adminSetup.usgs.needsUsername' : 'adminSetup.usgs.pasteHint')}</p>
            ${secondsLeft === null ? nothing : this.renderCountdown(secondsLeft)}
            <div role="alert">${expired ? html`<p class="alert">${this.t('adminSetup.usgs.expired')}</p>` : nothing}</div>
        </div>`;
    }

    private renderCountdown(secondsLeft: number): TemplateResult {
        const text = this.t('adminSetup.usgs.countdown', { seconds: String(secondsLeft) });
        return html`<p class="countdown" role="timer">${text}</p>
            <hcm-progress .value=${secondsLeft / TOKEN_SECONDS} label=${text}></hcm-progress>`;
    }

    private renderStatus(state: SetupViewState): TemplateResult {
        const { role, nextCheckAt, expiresSoon, tokenExpiresAt } = state.usgs;
        return html`${this.renderRole(role)} ${this.renderSince(state)}
        ${nextCheckAt === null ? nothing : html`<p class="note">${this.t('adminSetup.usgs.nextCheck', { time: formatDateTime(this.locale, nextCheckAt) })}</p>`}
        ${expiresSoon && tokenExpiresAt !== null ? this.renderExpiry(tokenExpiresAt) : nothing}`;
    }

    /** M6 (A59): a token waiting for USGS's approval says since when. */
    private renderSince(state: SetupViewState): TemplateResult {
        const since = this.step(state, 'usgs').state === 'pending' ? state.usgs.pendingSince : null;
        return since === null
            ? EMPTY
            : html`<p class="note since">${this.t('adminSetup.usgs.pendingSince', { date: formatDate(this.locale, since) })}</p>`;
    }

    private renderRole(role: UsgsRole | null): TemplateResult {
        if (role === null) {
            return EMPTY;
        }
        const key: AdminSetupKey = `adminSetup.usgs.role.${role}`;
        return html`<p class="role">${this.t(key)}</p>`;
    }

    private renderExpiry(tokenExpiresAt: string): TemplateResult {
        return html`<p class="alert expiring">
            ${this.t('adminSetup.usgs.expiresSoon', { date: formatDate(this.locale, tokenExpiresAt) })}
        </p>`;
    }

    private readonly onUsername = (event: Event): void => {
        const username = (event.target as HTMLInputElement).value;
        this.needsUsername = false;
        this.act((intents) => {
            intents.draftUsgs({ username });
        });
    };

    private readonly onFilled = (): void => {
        this.act((intents) => {
            intents.noteInput('usgs');
        });
    };

    private readonly onExpiry = (event: Event): void => {
        const expiresOn = parseDateInput((event.target as HTMLInputElement).value);
        this.expiryUnread = expiresOn === null;
        if (expiresOn !== null) {
            this.act((intents) => {
                intents.draftUsgs({ expiresOn });
            });
        }
        this.onFilled();
    };

    /** The paste box first, then the countdown; the link's own default action then opens ERS in a new tab. */
    private readonly onOpenTokenPage = (): void => {
        this.renderRoot.querySelector<HTMLInputElement>('#usgs-token')?.focus();
        this.act((intents) => {
            intents.startUsgsCountdown();
        });
    };

    private readonly onPaste = (): void => {
        this.onFilled();
    };

    private readonly onTokenInput = (event: Event): void => {
        if ((event as InputEvent).inputType === 'insertFromPaste') {
            this.submit(event.target as HTMLInputElement);
        }
    };

    private readonly onTokenKey = (event: KeyboardEvent): void => {
        if (event.key === 'Enter') {
            this.submit(event.target as HTMLInputElement);
        }
    };

    /** Saves the token in the box with the username (and the optional expiry), then clears the box. */
    private submit(box: HTMLInputElement): void {
        const applicationToken = box.value.trim();
        const { username, expiresOn } = typedFields(this.view);
        if (applicationToken === '') {
            return;
        }
        if (username === '') {
            this.needsUsername = true;
            return;
        }
        box.value = '';
        const request = { username, applicationToken, ...(expiresOn === '' ? {} : { expiresOn }) };
        this.act((intents) => {
            intents.saveUsgs(request);
        });
    }
}

/** Registers `<hcm-setup-usgs>` and what it renders. */
export function defineHcmSetupUsgs(registry: CustomElementRegistry = customElements): void {
    defineSetupBodyParts(registry);
    defineHcmButton(registry);
    defineHcmProgress(registry);
    defineOnce(registry, HCM_SETUP_USGS_TAG, HcmSetupUsgs);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-setup-usgs': HcmSetupUsgs;
    }
}
