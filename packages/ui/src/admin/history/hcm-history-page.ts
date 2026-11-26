/**
 * `<hcm-history-page>`: `#/history` and `#/history/<entity>/<id>` (`docs/research/M2c-interfaces.md` §9.2; behaviour
 * A23). The city's recent changes, newest first, filtered by what changed and how (the **Deleted** filter offers
 * Restore on each); a document's versions, with the selected entry's fields before and after as text and **Revert**
 * (asked first). A refused revert stays as an alert with the server's reason and changes nothing.
 */
import type { UiLocale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import type { AdminRouteIdPort } from '../admin-port.js';
import type { AreaPort, ContentPort } from '../content-port.js';
import { AreaPage } from '../editing/area-page.js';
import { editingStyles } from '../editing/editing-styles.js';
import { listBody, reconnectingStatus } from '../editing/states.js';
import { EMPTY } from '../shell/empty.js';
import { contentText, noticeOf } from '../shell/text.js';
import { entryDetail, historyStyles } from './history-detail.js';
import type { HistoryDocumentPort, HistoryIntentsPort, HistoryItemPort, HistoryViewState } from './history-port.js';
import {
    ACTION_FILTERS,
    actionFilterText,
    currentName,
    ENTITY_FILTERS,
    entityFilterText,
    fieldsText,
    nameText,
    summaryText,
} from './history-text.js';

export const HCM_HISTORY_PAGE_TAG = 'hcm-history-page';

/** The entry whose changes show: the selected one, else the newest. */
function shownEntry(entries: readonly HistoryItemPort[], selected: string | null): HistoryItemPort | null {
    return entries.find((entry) => entry.entryId === selected) ?? entries[0] ?? null;
}

/** "Deleted now" when the document no longer exists (an address that names no document says nothing). */
function deletedTag(locale: UiLocale, document: HistoryDocumentPort): TemplateResult {
    const deleted = document.current.status === 'ready' && document.current.doc === null && document.document !== null;
    return deleted
        ? html`<div class="chips">
              <span class="tag" data-tone="error">${contentText(locale, 'adminContent.history.deletedNow')}</span>
          </div>`
        : EMPTY;
}

export class HcmHistoryPage extends AreaPage<HistoryViewState, HistoryIntentsPort> {
    static override readonly properties = { ...AreaPage.properties, confirming: { state: true } };

    static override readonly styles = [...editingStyles, historyStyles];

    protected readonly route: AdminRouteIdPort = 'history';
    /** The entry whose revert (or restore) is being asked about. */
    declare confirming: HistoryItemPort | null;

    constructor() {
        super();
        this.confirming = null;
    }

    protected storeOf(content: ContentPort): AreaPort<HistoryViewState, HistoryIntentsPort> | null {
        return content.history;
    }

    override render(): TemplateResult {
        const view = this.view;
        if (view === null) {
            return EMPTY;
        }
        const locale = this.locale;
        return html`${view.document === null ? this.#recent(locale, view) : this.#document(locale, view, view.document)}
        ${this.#confirm(locale)}`;
    }

    #frame(
        locale: UiLocale,
        parts: { readonly detail: boolean; readonly key: string; readonly list: TemplateResult; readonly body: TemplateResult },
    ): TemplateResult {
        const back = (): void => {
            this.intents?.select(null);
        };
        return html`<hcm-list-detail
            ?detail=${parts.detail}
            .detailKey=${parts.key}
            .listLabel=${contentText(locale, 'adminContent.history.listLabel')}
            .detailLabel=${contentText(locale, 'adminContent.history.detailLabel')}
            .backLabel=${contentText(locale, 'adminContent.common.back')}
            .closeLabel=${contentText(locale, 'adminContent.common.close')}
            @hcm-back=${back}
        >
            <div slot="list">${parts.list}</div>
            <div slot="detail">${parts.body}</div>
        </hcm-list-detail>`;
    }

    #recent(locale: UiLocale, view: HistoryViewState): TemplateResult {
        const intents = this.intents;
        const list = html`<div class="list-head">
                <div class="filters">${this.#entitySelect(locale, view)} ${this.#actionSelect(locale, view)}</div>
                ${reconnectingStatus(locale, view.recent.reconnecting)} ${this.#refusal(locale, view)}
            </div>
            ${listBody(
                locale,
                view.recent,
                { empty: 'adminContent.history.empty', icon: 'history' },
                {
                    retry: () => intents?.retry(),
                    more: () => intents?.more(),
                    items: (items) =>
                        html`<ul class="rows">
                            ${items.map((item) => this.#recentRow(locale, view, item))}
                        </ul>`,
                },
            )}`;
        const body = html`<hcm-empty-state icon="history" .text=${contentText(locale, 'adminContent.history.choose')}></hcm-empty-state>`;
        return this.#frame(locale, { detail: false, key: '', list, body });
    }

    #entitySelect(locale: UiLocale, view: HistoryViewState): TemplateResult {
        const change = (event: Event): void => {
            this.intents?.setFilter({ entity: (event.currentTarget as HTMLSelectElement).value as HistoryViewState['filter']['entity'] });
        };
        return html`<div class="field">
            <label for="entity">${contentText(locale, 'adminContent.history.entityLabel')}</label>
            <select id="entity" @change=${change}>
                ${ENTITY_FILTERS.map((entity) => html`<option value=${entity} ?selected=${entity === view.filter.entity}>${entityFilterText(locale, entity)}</option>`)}
            </select>
        </div>`;
    }

    #actionSelect(locale: UiLocale, view: HistoryViewState): TemplateResult {
        const change = (event: Event): void => {
            this.intents?.setFilter({ action: (event.currentTarget as HTMLSelectElement).value as HistoryViewState['filter']['action'] });
        };
        return html`<div class="field">
            <label for="action">${contentText(locale, 'adminContent.history.actionLabel')}</label>
            <select id="action" @change=${change}>
                ${ACTION_FILTERS.map((action) => html`<option value=${action} ?selected=${action === view.filter.action}>${actionFilterText(locale, action)}</option>`)}
            </select>
        </div>`;
    }

    #recentRow(locale: UiLocale, view: HistoryViewState, item: HistoryItemPort): TemplateResult {
        const self = this.state?.user?.uid ?? null;
        const open = (): void => {
            this.intents?.select(item.entryId);
        };
        return html`<li class="with-action">
            <a class="row" href=${this.href([item.entity, item.entityId])} @click=${open}>
                <span class="row-title">${nameText(locale, item)}</span>
                <span class="row-detail">${summaryText(locale, item, self, view.people)}</span>
            </a>
            ${item.action === 'delete' ? this.#restoreButton(locale, view, item) : EMPTY}
        </li>`;
    }

    #restoreButton(locale: UiLocale, view: HistoryViewState, item: HistoryItemPort): TemplateResult {
        const ask = (): void => {
            this.confirming = item;
        };
        return html`<hcm-button variant="tonal" icon="restore" ?disabled=${view.reverting !== null || this.readOnly} @click=${ask}
            >${contentText(locale, 'adminContent.history.restore')}</hcm-button
        >`;
    }

    #document(locale: UiLocale, view: HistoryViewState, document: HistoryDocumentPort): TemplateResult {
        const shown = shownEntry(document.entries.items, view.selected);
        const explicit = view.selected !== null && shown?.entryId === view.selected;
        const list = html`<div class="list-head">
                <p><a href=${this.href([])}>${contentText(locale, 'adminContent.history.allChanges')}</a></p>
                <h2>${this.#documentTitle(locale, document)}</h2>
                ${deletedTag(locale, document)}
                ${reconnectingStatus(locale, document.entries.reconnecting || document.current.reconnecting)}
            </div>
            ${listBody(
                locale,
                document.entries,
                { empty: 'adminContent.history.notFound', icon: 'history' },
                {
                    retry: () => this.intents?.retry(),
                    more: () => this.intents?.more(),
                    items: (items) =>
                        html`<ul class="rows">
                            ${items.map((entry) => this.#versionRow(locale, view, entry, entry === shown))}
                        </ul>`,
                },
            )}`;
        return this.#frame(locale, { detail: explicit, key: explicit ? shown.entryId : '', list, body: this.#shown(locale, view, shown) });
    }

    #shown(locale: UiLocale, view: HistoryViewState, shown: HistoryItemPort | null): TemplateResult {
        return shown === null
            ? html`<hcm-empty-state icon="history" .text=${contentText(locale, 'adminContent.history.notFound')}></hcm-empty-state>`
            : this.#entry(locale, view, shown);
    }

    /** "Versions of …": the document's name now, else as its newest version knew it; plain "Versions" before any. */
    #documentTitle(locale: UiLocale, document: HistoryDocumentPort): string {
        const newest = document.entries.items[0];
        if (newest === undefined) {
            return contentText(locale, 'adminContent.history.title');
        }
        const name = currentName(document.current.doc?.data) ?? newest.name;
        return contentText(locale, 'adminContent.history.of', { name: nameText(locale, { ...newest, name }) });
    }

    #versionRow(locale: UiLocale, view: HistoryViewState, entry: HistoryItemPort, shown: boolean): TemplateResult {
        const select = (): void => {
            this.intents?.select(entry.entryId);
        };
        return html`<li>
            <button class="row" type="button" aria-current=${shown ? 'true' : 'false'} @click=${select}>
                <span class="row-title">${summaryText(locale, entry, this.state?.user?.uid ?? null, view.people)}</span>
                <span class="row-detail">${fieldsText(locale, entry)}</span>
            </button>
        </li>`;
    }

    #entry(locale: UiLocale, view: HistoryViewState, entry: HistoryItemPort): TemplateResult {
        const ask = (): void => {
            this.confirming = entry;
        };
        return entryDetail({
            locale,
            entry,
            changes: view.changes,
            heading: summaryText(locale, entry, this.state?.user?.uid ?? null, view.people),
            refusal: this.#refusal(locale, view),
            // A revoked admin's read-only page reverts nothing (DECISIONS-for-review.md §42d).
            reverting: view.reverting === entry.entryId || this.readOnly,
            ask,
        });
    }

    #refusal(locale: UiLocale, view: HistoryViewState): TemplateResult {
        return view.refusal === null
            ? EMPTY
            : html`<p class="alert" role="alert"><hcm-icon name="error"></hcm-icon><span>${noticeOf(locale, view.refusal)}</span></p>`;
    }

    #confirm(locale: UiLocale): TemplateResult {
        const item = this.confirming;
        const restore = item?.action === 'delete';
        const confirm = (): void => {
            this.confirming = null;
            if (item !== null) {
                void this.intents?.revert(item);
            }
        };
        const dismiss = (): void => {
            this.confirming = null;
        };
        return html`<hcm-confirm-dialog
            .open=${item !== null}
            .headline=${contentText(locale, restore ? 'adminContent.history.restoreConfirm' : 'adminContent.history.revertConfirm')}
            .body=${contentText(locale, restore ? 'adminContent.history.restoreBody' : 'adminContent.history.revertBody')}
            .confirmLabel=${contentText(locale, restore ? 'adminContent.history.restore' : 'adminContent.history.revert')}
            .cancelLabel=${contentText(locale, 'adminContent.common.cancel')}
            .closeLabel=${contentText(locale, 'adminContent.common.close')}
            @hcm-confirm=${confirm}
            @hcm-cancel=${dismiss}
        ></hcm-confirm-dialog>`;
    }
}

export function defineHcmHistoryPage(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_HISTORY_PAGE_TAG) === undefined) {
        registry.define(HCM_HISTORY_PAGE_TAG, HcmHistoryPage);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-history-page': HcmHistoryPage;
    }
}
