/**
 * The states every editor screen has (`docs/research/M2c-interfaces.md` §1.4), as templates the pages share: loading
 * (the loading indicator, announced once), an error with its reason and Try again, empty (an icon, a sentence), the
 * items with More, and "Reconnecting…" in a polite live region that exists before its text. Who did something and when
 * are formatted here too, as text.
 */
import type { AdminContentKey, UiLocale } from '@hcm/shared';
import { html, nothing, type TemplateResult } from 'lit';

import type { ListStatePort, StoreFailurePort } from '../content-port.js';
import { contentText } from '../shell/text.js';

/** A date and time in the admin's language (`17 oct. 2026, 14:02`). */
export function formatWhen(locale: UiLocale, iso: string): string {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}

/** A date in the admin's language. */
export function formatDay(locale: UiLocale, iso: string): string {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso));
}

/** Who made a change: you, a named admin, the server (a `system:` writer), or another admin. */
export function whoText(locale: UiLocale, uid: string, self: string | null, people: Readonly<Record<string, string>> = {}): string {
    if (uid === self) {
        return contentText(locale, 'adminContent.common.you');
    }
    if (uid.startsWith('system:')) {
        return contentText(locale, 'adminContent.common.server');
    }
    return people[uid] ?? contentText(locale, 'adminContent.common.someone');
}

/** The reason a listener stopped, as text. */
export function failureText(locale: UiLocale, failure: StoreFailurePort | null): string {
    if (failure?.kind === 'denied') {
        return contentText(locale, 'adminContent.common.denied');
    }
    return contentText(locale, 'adminContent.common.loadFailed', { code: failure?.code ?? 'unknown' });
}

/** "Reconnecting…" while the list's listener lost the server; the region is always there, so the text is announced. */
export function reconnectingStatus(locale: UiLocale, reconnecting: boolean): TemplateResult {
    return html`<p class="note status" role="status">${reconnecting ? contentText(locale, 'adminContent.common.reconnecting') : ''}</p>`;
}

export function loadingTemplate(locale: UiLocale): TemplateResult {
    const text = contentText(locale, 'adminContent.common.loading');
    return html`<div class="pane" role="status">
        <hcm-loading-indicator .label=${text}></hcm-loading-indicator>
        <p class="note">${text}</p>
    </div>`;
}

export function errorTemplate(locale: UiLocale, failure: StoreFailurePort | null, retry: () => void): TemplateResult {
    return html`<div class="pane">
        <p class="alert" role="alert"><hcm-icon name="error"></hcm-icon><span>${failureText(locale, failure)}</span></p>
        <div class="actions">
            <hcm-button variant="tonal" icon="refresh" @click=${retry}>${contentText(locale, 'adminContent.common.retry')}</hcm-button>
        </div>
    </div>`;
}

export interface ListTexts {
    readonly empty: AdminContentKey;
    readonly icon: string;
    /** The empty state's second line: where the items come from (finding 44 of 2026-11-01). */
    readonly emptyHint?: AdminContentKey;
    /** The count's sentence ("Places: {count}"; "In the list: {count}" when absent). */
    readonly count?: AdminContentKey;
}

/** The empty state: its sentence and, when the list has one, the line that says where the items come from. */
function emptyTemplate(locale: UiLocale, texts: ListTexts): TemplateResult {
    const hint = texts.emptyHint === undefined ? '' : contentText(locale, texts.emptyHint);
    return html`<hcm-empty-state .icon=${texts.icon} .text=${contentText(locale, texts.empty)} .hint=${hint}></hcm-empty-state>`;
}

/** "Places: 315": how many items the list holds, with a plus while more wait past what was read. */
export function countLine(
    locale: UiLocale,
    count: number,
    hasMore: boolean,
    key: AdminContentKey = 'adminContent.common.count',
): TemplateResult {
    const shown = hasMore ? `${String(count)}+` : String(count);
    return html`<p class="note list-count" role="status">${contentText(locale, key, { count: shown })}</p>`;
}

/**
 * Every item of a list in a `<hcm-list-window>`: the rows a window at a time, the next window and the next documents
 * read as the reader scrolls to the end, the "Show more" button only as the keyboard's fallback.
 */
export function listWindow<Item>(
    locale: UiLocale,
    items: readonly Item[],
    hasMore: boolean,
    handlers: { readonly more?: () => void; readonly items: (items: readonly Item[]) => TemplateResult },
): TemplateResult {
    const rows = handlers.items as (items: readonly unknown[]) => TemplateResult;
    return html`<hcm-list-window
        .items=${items}
        .rows=${rows}
        .hasMore=${hasMore}
        .more=${handlers.more ?? null}
        .label=${contentText(locale, 'adminContent.common.more')}
    ></hcm-list-window>`;
}

export interface ListHandlers<Item> {
    readonly retry: () => void;
    readonly more: () => void;
    readonly items: (items: readonly Item[]) => TemplateResult;
    /** The items the search and filters keep, out of every item read (all of them when absent). */
    readonly shown?: (items: readonly Item[]) => readonly Item[];
}

/**
 * A list's body: loading before the first answer, the error with Try again, the empty state, or the count and every
 * item in a window that grows as the reader scrolls. The items stay on screen while a filter change reloads them.
 */
export function listBody<Item>(
    locale: UiLocale,
    list: ListStatePort<Item>,
    texts: ListTexts,
    handlers: ListHandlers<Item>,
): TemplateResult {
    if (list.status === 'error') {
        return errorTemplate(locale, list.failure, handlers.retry);
    }
    if (list.items.length === 0) {
        return list.status === 'loading' ? loadingTemplate(locale) : emptyTemplate(locale, texts);
    }
    const shown = handlers.shown === undefined ? list.items : handlers.shown(list.items);
    return html`${countLine(locale, shown.length, list.hasMore, texts.count)} ${listWindow(locale, shown, list.hasMore, handlers)}`;
}

/** `aria-current="page"` on the selected row's link, nothing on the others. */
export function current(selected: boolean): 'page' | typeof nothing {
    return selected ? 'page' : nothing;
}
