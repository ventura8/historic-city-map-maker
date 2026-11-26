/**
 * `<hcm-inbox-page>`: `#/inbox` (`docs/research/M4-interfaces.md` §5.5; behaviours A46, A47). The admin's notifications,
 * newest first: the message in the admin's language (its parameters as plain text), the time, the severity's icon and
 * name, unread ones in bold; an item is a link to the page it is about, and opening it marks it read. **Mark all as read**;
 * More for older ones. Below, the push settings: **Notifications on this device** (the browser's own prompt first: a
 * refusal leaves the inbox working and says so), a switch per kind for this account's devices, and **Send a test
 * notification**. Text only: nothing of a notification is rendered as HTML.
 */
import { contentLocale, NOTIFICATION_KINDS, paramsIn, type UiLocale, type NotificationKind, type NotificationSeverity } from '@hcm/shared';
import { css, html, nothing, type TemplateResult } from 'lit';

import { visuallyHidden } from '../../components/styles.js';
import type { AdminRouteIdPort } from '../admin-port.js';
import type { AreaPort, ContentPort } from '../content-port.js';
import { AreaPage } from '../editing/area-page.js';
import { editingStyles } from '../editing/editing-styles.js';
import { formatWhen, listBody, reconnectingStatus } from '../editing/states.js';
import { EMPTY } from '../shell/empty.js';
import { contentText, noticeOf } from '../shell/text.js';
import type { InboxIntentsPort, InboxRowPort, InboxSettingsPort, InboxViewState } from './inbox-port.js';

export const HCM_INBOX_PAGE_TAG = 'hcm-inbox-page';

const SEVERITY_ICONS: Readonly<Record<NotificationSeverity, string>> = { info: 'info', warning: 'warning', error: 'error' };

/** A notification's message in `locale`, its parameters filled as text (`paramsIn`: the English ones in English). */
export function notificationMessage(locale: UiLocale, row: Pick<InboxRowPort, 'kind' | 'params'>): string {
    return contentText(locale, `adminContent.notify.event.${row.kind}`, paramsIn(contentLocale(locale), row.params));
}

const inboxStyles = css`
    section {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .head {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
    }

    .rows {
        padding: 0;
    }

    a.row {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        column-gap: 12px;
        align-items: start;
    }

    a.row hcm-icon {
        grid-row: span 2;
        margin-block-start: 2px;
    }

    a.row[data-severity='error'] hcm-icon {
        color: var(--md-sys-color-error, CanvasText);
    }

    a.row[data-severity='warning'] hcm-icon {
        color: var(--md-sys-color-tertiary, CanvasText);
    }

    a.row[data-unread] .row-title {
        font-weight: 700;
    }

    ul.kinds {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin: 0;
        padding: 0;
        list-style: none;
    }

    .setting {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        min-block-size: 48px;
    }
`;

class HcmInboxPage extends AreaPage<InboxViewState, InboxIntentsPort> {
    /** The inbox scrolls with the page area like a form; it has no panes. */
    static override readonly fillsPage: boolean = false;

    static override readonly styles = [...editingStyles, visuallyHidden, inboxStyles];

    protected readonly route: AdminRouteIdPort = 'inbox';

    protected storeOf(content: ContentPort): AreaPort<InboxViewState, InboxIntentsPort> | null {
        return content.inbox;
    }

    override render(): TemplateResult {
        const view = this.view;
        if (view === null) {
            return EMPTY;
        }
        const locale = this.locale;
        return html`<div class="pane">${this.#list(locale, view)} ${this.#settings(locale, view)}</div>`;
    }

    /** The badge's count knows the items past the loaded page too. */
    get #unreadPastThePage(): boolean {
        return (this.state?.unread ?? 0) > 0;
    }

    #list(locale: UiLocale, view: InboxViewState): TemplateResult {
        const unread = view.list.items.some((row) => !row.read) || this.#unreadPastThePage;
        const markAll = (): void => {
            void this.intents?.markAllRead();
        };
        const handlers = {
            retry: () => this.intents?.retry(),
            more: () => this.intents?.more(),
            items: (rows: readonly InboxRowPort[]) =>
                html`<ul class="rows" data-inbox>
                    ${rows.map((row) => this.#row(locale, row))}
                </ul>`,
        };
        return html`<section aria-labelledby="inbox-list">
            <div class="head">
                <h2 id="inbox-list">${contentText(locale, 'adminContent.notify.list')}</h2>
                <hcm-button variant="tonal" icon="done_all" ?disabled=${!unread || view.marking || this.readOnly} @click=${markAll}
                    >${contentText(locale, 'adminContent.notify.markAllRead')}</hcm-button
                >
            </div>
            ${reconnectingStatus(locale, view.list.reconnecting)}
            ${listBody(locale, view.list, { empty: 'adminContent.notify.empty', icon: 'notifications' }, handlers)}
        </section>`;
    }

    #row(locale: UiLocale, row: InboxRowPort): TemplateResult {
        const open = (): void => {
            this.intents?.markRead(row.id);
        };
        const severity = contentText(locale, `adminContent.notify.severity.${row.severity}`);
        return html`<li>
            <a class="row" href=${row.link} data-item=${row.id} data-severity=${row.severity} ?data-unread=${!row.read} @click=${open}>
                <hcm-icon name=${SEVERITY_ICONS[row.severity]}></hcm-icon>
                <span class="row-title">${notificationMessage(locale, row)}</span>
                <span class="row-detail"
                    ><span class="visually-hidden">${severity}. </span>${formatWhen(locale, row.createdAt)}${
                        row.read
                            ? nothing
                            : html`<span class="visually-hidden">, ${contentText(locale, 'adminContent.notify.unreadMark')}</span>`
                    }</span
                >
            </a>
        </li>`;
    }

    #settings(locale: UiLocale, view: InboxViewState): TemplateResult {
        return html`<section aria-labelledby="inbox-settings" data-settings>
            <h2 id="inbox-settings">${contentText(locale, 'adminContent.notify.settings.title')}</h2>
            <p class="note">${contentText(locale, 'adminContent.notify.settings.intro')}</p>
            ${this.#device(locale, view)} ${this.#kinds(locale, view.settings)}
        </section>`;
    }

    #device(locale: UiLocale, view: InboxViewState): TemplateResult {
        const { push } = view;
        if (push.device === 'unsupported') {
            return html`<p class="note" data-push=${push.device}>${contentText(locale, 'adminContent.notify.push.unsupported')}</p>`;
        }
        const label = contentText(locale, 'adminContent.notify.push.turnOn');
        const change = (event: CustomEvent<{ readonly checked: boolean }>): void => {
            void (event.detail.checked ? this.intents?.turnOnPush() : this.intents?.turnOffPush());
        };
        return html`<div class="setting" data-push=${push.device}>
                <span>${label}</span>
                <hcm-switch
                    .label=${label}
                    .checked=${push.device === 'on'}
                    ?disabled=${push.device === 'working' || this.readOnly}
                    @hcm-change=${change}
                ></hcm-switch>
            </div>
            ${this.#deviceState(locale, view)}`;
    }

    #deviceState(locale: UiLocale, view: InboxViewState): TemplateResult {
        const { push } = view;
        if (push.device === 'denied') {
            return html`<p class="alert" role="alert">
                <hcm-icon name="info"></hcm-icon><span>${contentText(locale, 'adminContent.notify.push.denied')}</span>
            </p>`;
        }
        if (push.device === 'failed') {
            const reason = noticeOf(locale, push.failure);
            return html`<p class="alert" role="alert">
                    <hcm-icon name="error"></hcm-icon><span>${contentText(locale, 'adminContent.notify.push.failed', { reason })}</span>
                </p>
                ${this.#reasonLine(locale, view)}`;
        }
        return push.device === 'on'
            ? this.#test(locale, view)
            : html`<p class="note status" role="status">${this.#working(locale, view)}</p>`;
    }

    /** The failure's reason with its code (finding 46 of 2026-11-01), when it has one. */
    #reasonLine(locale: UiLocale, view: InboxViewState): TemplateResult | typeof nothing {
        const { reason } = view.push;
        return reason === null ? nothing : html`<p class="note reason">${noticeOf(locale, reason)}</p>`;
    }

    #working(locale: UiLocale, view: InboxViewState): string {
        return view.push.device === 'working' ? contentText(locale, 'adminContent.notify.push.working') : '';
    }

    #test(locale: UiLocale, view: InboxViewState): TemplateResult {
        const test = (): void => {
            void this.intents?.sendTest();
        };
        return html`<p class="note">${contentText(locale, 'adminContent.notify.push.on')}</p>
            <div class="actions">
                <hcm-button variant="text" icon="send" ?disabled=${view.push.testing || this.readOnly} @click=${test}
                    >${contentText(locale, 'adminContent.notify.push.test')}</hcm-button
                >
            </div>`;
    }

    #kinds(locale: UiLocale, settings: InboxSettingsPort): TemplateResult {
        return html`<h3 id="inbox-kinds">${contentText(locale, 'adminContent.notify.settings.kinds')}</h3>
            <ul class="kinds" aria-labelledby="inbox-kinds">
                ${NOTIFICATION_KINDS.map((kind) => this.#kind(locale, settings, kind))}
            </ul>`;
    }

    #kind(locale: UiLocale, settings: InboxSettingsPort, kind: NotificationKind): TemplateResult {
        const label = contentText(locale, `adminContent.notify.kind.${kind}`);
        const change = (event: CustomEvent<{ readonly checked: boolean }>): void => {
            void this.intents?.setKind(kind, event.detail.checked);
        };
        return html`<li class="setting" data-kind=${kind}>
            <span>${label}</span>
            <hcm-switch
                .label=${label}
                .checked=${settings.kinds.includes(kind)}
                ?disabled=${settings.status !== 'ready' || settings.saving || this.readOnly}
                @hcm-change=${change}
            ></hcm-switch>
        </li>`;
    }
}

/** Registers `<hcm-inbox-page>` once; calling it again is a no-op. */
export function defineHcmInboxPage(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_INBOX_PAGE_TAG) === undefined) {
        registry.define(HCM_INBOX_PAGE_TAG, HcmInboxPage);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-inbox-page': HcmInboxPage;
    }
}
