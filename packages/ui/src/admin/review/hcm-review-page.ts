/**
 * `<hcm-review-page>`: `#/review` (M13, `docs/research/M13-roles.md` §8; behaviours A90, A92, A93): what uploaders added, the
 * public's suggestions with the photo as it is and as proposed side by side on one map, and for the city's owners the requests
 * for a role. Text only: what strangers typed is shown through Lit's text bindings, and a source link must be https.
 */
import { pluralOf, type UiLocale, type SuggestionProposal } from '@hcm/shared';
import { css, html, nothing, type TemplateResult } from 'lit';

import type { AdminRouteIdPort } from '../admin-port.js';
import type { AreaPort, ContentPort } from '../content-port.js';
import { defineUiKit } from '../../components/define.js';
import { AreaPage } from '../editing/area-page.js';
import { defineEditingElements } from '../editing/define.js';
import { editingStyles } from '../editing/editing-styles.js';
import { reconnectingStatus } from '../editing/states.js';
import { defineHcmAdminMap } from '../map/hcm-admin-map.js';
import { bearingField, coordinateField, dateFields } from '../contribute/proposal-fields.js';
import { EMPTY } from '../shell/empty.js';
import { contentText, shellText } from '../shell/text.js';
import type { ListStatePort } from '../area-port.js';
import type {
    ReviewBlockedPort,
    ReviewIntentsPort,
    ReviewItemPort,
    ReviewRequestPort,
    ReviewSuggestionPort,
    ReviewViewState,
} from './review-port.js';

export const HCM_REVIEW_PAGE_TAG = 'hcm-review-page';

const styles = css`
    section {
        display: flex;
        flex-direction: column;
        gap: 12px;
        margin-block-end: 24px;
    }

    li.card {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 12px;
        border-radius: var(--md-sys-shape-corner-medium, 12px);
        background: var(--md-sys-color-surface-container, Canvas);
        overflow-wrap: anywhere;
    }

    /* M3's 48 px touch target on a compact window. */
    li.card a {
        display: inline-flex;
        align-items: center;
        min-block-size: 48px;
    }

    img {
        max-inline-size: 160px;
        border-radius: var(--md-sys-shape-corner-small, 8px);
    }

    hcm-admin-map {
        display: block;
        block-size: 320px;
    }

    ul {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 0;
        list-style: none;
    }
`;

function yearsOf(year: number | undefined, yearEnd: number | undefined): string | null {
    if (year === undefined) {
        return null;
    }
    return yearEnd === undefined ? String(year) : `${String(year)}–${String(yearEnd)}`;
}

function placeOf({ location, bearing }: SuggestionProposal): readonly (string | null)[] {
    return [
        location === undefined ? null : `${String(location.lat)}, ${String(location.lng)}`,
        bearing === undefined ? null : `${String(bearing)}°`,
    ];
}

/** A proposal's or a photo's facts as one line: its place, its direction, its date. */
function factsOf(proposal: SuggestionProposal | null, none: string): string {
    const facts = proposal ?? {};
    const parts = [...placeOf(facts), yearsOf(facts.year, facts.yearEnd), facts.dateText ?? null].filter((part) => part !== null);
    return parts.length === 0 ? none : parts.join(' · ');
}

function nameIn(locale: UiLocale, title: { readonly ro: string; readonly en?: string | undefined }): string {
    return locale === 'en' ? (title.en ?? title.ro) : title.ro;
}

/** Where each kind of item is edited. */
const ITEM_ROUTES = { photo: 'photos', poi: 'pois', story: 'stories' } as const;

class HcmReviewPage extends AreaPage<ReviewViewState, ReviewIntentsPort> {
    static override readonly fillsPage: boolean = false;

    static override readonly styles = [...editingStyles, styles];

    protected readonly route: AdminRouteIdPort = 'review';

    protected storeOf(content: ContentPort): AreaPort<ReviewViewState, ReviewIntentsPort> | null {
        return content.review;
    }

    override render(): TemplateResult {
        const view = this.view;
        if (view === null) {
            return EMPTY;
        }
        const locale = this.locale;
        return html`<div class="pane">
            <h2>${contentText(locale, 'adminContent.review.title')}</h2>
            ${reconnectingStatus(locale, view.suggestions.reconnecting)}
            ${this.#section(locale, 'adminContent.review.uploads', [...view.photos.items, ...view.places.items, ...view.stories.items], (item) => this.#item(locale, view, item))}
            ${this.#section(locale, 'adminContent.review.suggestions', view.suggestions.items, (row) => this.#suggestion(locale, view, row))}
            ${this.#map(locale, view)}
            ${this.#section(locale, 'adminContent.review.decided', view.decided.items, (row) => this.#decided(locale, row))}
            ${view.requests === null ? nothing : this.#requests(locale, view.requests)}
            ${this.#section(locale, 'adminContent.review.blockedList', view.blocked.items, (row) => this.#blocked(locale, row))}
            ${this.#blockQuestion(locale, view)}
        </div>`;
    }

    #section<Item>(
        locale: UiLocale,
        title: Parameters<typeof contentText>[1],
        items: readonly Item[],
        row: (item: Item) => TemplateResult,
    ): TemplateResult {
        return html`<section aria-label=${contentText(locale, title)}>
            <h3>${contentText(locale, title)}</h3>
            ${
                items.length === 0
                    ? html`<p class="note">${contentText(locale, 'adminContent.review.empty')}</p>`
                    : html`<ul>
                          ${items.map(row)}
                      </ul>`
            }
        </section>`;
    }

    #requests(locale: UiLocale, list: ListStatePort<ReviewRequestPort>): TemplateResult {
        return this.#section(locale, 'adminContent.review.requests', list.items, (row) => this.#request(locale, row));
    }

    #note(id: string, locale: UiLocale): TemplateResult {
        const field = `note-${id}`;
        return html`<div class="field">
            <label for=${field}>${contentText(locale, 'adminContent.review.note')}</label>
            <input id=${field} maxlength="500" />
        </div>`;
    }

    /** The note typed beside the button that was pressed. */
    #noteOf(id: string): string {
        return this.renderRoot.querySelector<HTMLInputElement>(`#note-${id}`)?.value ?? '';
    }

    #button(label: string, icon: string, act: () => void): TemplateResult {
        return html`<hcm-button variant="tonal" icon=${icon} ?disabled=${this.view?.busy === true || this.readOnly} @click=${act}
            >${label}</hcm-button
        >`;
    }

    #item(locale: UiLocale, view: ReviewViewState, item: ReviewItemPort): TemplateResult {
        const title = nameIn(locale, item.title);
        const key = `${item.entity}-${item.id}`;
        return html`<li class="card">
            <strong>${contentText(locale, `adminContent.review.entity.${item.entity}`)}: ${title}</strong>
            ${this.#picture(locale, view, item)} ${this.#published(locale, item)}
            <a href=${`#/${ITEM_ROUTES[item.entity]}/${item.id}`}>${contentText(locale, 'adminContent.review.open')}</a>
            ${this.#note(key, locale)}
            <div class="actions">
                ${this.#button(contentText(locale, 'adminContent.review.approve'), 'check', () => void this.intents?.decideItem(item, 'approve', this.#noteOf(key)))}
                ${this.#button(contentText(locale, 'adminContent.review.refuse'), 'close', () => void this.intents?.decideItem(item, 'refuse', this.#noteOf(key)))}
            </div>
        </li>`;
    }

    #picture(locale: UiLocale, view: ReviewViewState, item: ReviewItemPort): TemplateResult | typeof nothing {
        const picture = item.thumbPath === null ? undefined : view.pictures[item.thumbPath];
        const alt = contentText(locale, 'adminContent.review.picture', { title: nameIn(locale, item.title) });
        return picture === undefined ? nothing : html`<img src=${picture} alt=${alt} />`;
    }

    /** What an approval publishes besides the title and the picture: an approval is of what was read here. */
    #published(locale: UiLocale, item: ReviewItemPort): TemplateResult {
        const credit =
            item.credit === null ? nothing : html`<span>${contentText(locale, 'adminContent.review.credit', { name: item.credit })}</span>`;
        const description = item.description === null ? nothing : html`<p>${nameIn(locale, item.description)}</p>`;
        const links = item.links.map(
            (link) => html`<a href=${link.url} target="_blank" rel="noopener noreferrer nofollow ugc">${link.label}</a>`,
        );
        return html`${credit} ${description} ${links}`;
    }

    #voice(locale: UiLocale, view: ReviewViewState, voice: ReviewSuggestionPort['voices'][number]): TemplateResult {
        return html`<div>
            ${voice.reason === null ? nothing : html`<p>${voice.reason}</p>`}
            ${voice.sourceUrl === null ? nothing : html`<p><a href=${voice.sourceUrl} target="_blank" rel="noopener noreferrer nofollow ugc">${contentText(locale, 'adminContent.review.source')}</a></p>`}
            ${voice.credit === null ? nothing : html`<p>${contentText(locale, 'adminContent.review.credit', { name: voice.credit })}</p>`}
            ${this.#blockOrLetBack(locale, view, voice)}
        </div>`;
    }

    #suggestion(locale: UiLocale, view: ReviewViewState, row: ReviewSuggestionPort): TemplateResult {
        const shown = view.selected === row.id;
        const count = contentText(locale, `adminContent.review.count.${pluralOf(locale, row.count)}`, { count: String(row.count) });
        return html`<li class="card">
            <strong>${nameIn(locale, row.title)}</strong>
            <img src=${row.thumb} alt=${contentText(locale, 'adminContent.review.picture', { title: nameIn(locale, row.title) })} />
            <span>${contentText(locale, `adminContent.review.kind.${row.kind}`)} · ${count}</span>
            ${shown ? this.#selected(locale, view, row) : this.#proposed(locale, row.proposal)}
            ${row.voices.map((voice) => this.#voice(locale, view, voice))} ${this.#note(row.id, locale)}
            <div class="actions">
                ${shown ? this.#decisions(locale, view, row) : this.#button(contentText(locale, 'adminContent.review.compare'), 'compare', () => this.intents?.select(row.id))}
            </div>
        </li>`;
    }

    #proposed(locale: UiLocale, proposal: SuggestionProposal): TemplateResult {
        const none = contentText(locale, 'adminContent.review.noPlace');
        return html`<span>${contentText(locale, 'adminContent.review.proposed', { value: factsOf(proposal, none) })}</span>`;
    }

    /** The one on the map: as it is now, as proposed or as the reviewer has it, and the values by hand while adjusting. */
    #selected(locale: UiLocale, view: ReviewViewState, row: ReviewSuggestionPort): TemplateResult {
        const none = contentText(locale, 'adminContent.review.noPlace');
        return html`<span>${contentText(locale, 'adminContent.review.current', { value: factsOf(view.current, none) })}</span>
            ${this.#proposed(locale, view.adjusted ?? row.proposal)}
            ${view.adjusted === null ? nothing : this.#adjustFields(locale, view.adjusted)}`;
    }

    #blockOrLetBack(locale: UiLocale, view: ReviewViewState, voice: ReviewSuggestionPort['voices'][number]): TemplateResult {
        const ask = (): void => {
            this.intents?.askBlock(voice.uid, voice.reason);
        };
        return view.blocked.items.some((row) => row.uid === voice.uid)
            ? this.#unblock(locale, voice.uid)
            : this.#button(contentText(locale, 'adminContent.review.block'), 'block', ask);
    }

    /** Every value by hand: what the pin cannot say (a direction, a date), and the keyboard's way to the place. */
    #adjustFields(locale: UiLocale, adjusted: SuggestionProposal): TemplateResult {
        const edit = (patch: SuggestionProposal): void => {
            this.intents?.editAdjusted(patch);
        };
        return html`${coordinateField(locale, 'lat', adjusted.location, edit)} ${coordinateField(locale, 'lng', adjusted.location, edit)}
        ${bearingField(locale, adjusted.bearing, edit)} ${dateFields(locale, adjusted, edit)}`;
    }

    #unblock(locale: UiLocale, uid: string): TemplateResult {
        return html`<span>${contentText(locale, 'adminContent.review.isBlocked')}</span>
            ${this.#button(contentText(locale, 'adminContent.review.unblock'), 'undo', () => void this.intents?.unblock(uid))}`;
    }

    #blocked(locale: UiLocale, row: ReviewBlockedPort): TemplateResult {
        return html`<li class="card">
            <strong>${contentText(locale, 'adminContent.review.account', { uid: row.uid })}</strong>
            ${row.about === null ? nothing : html`<p>${row.about}</p>`} ${this.#unblock(locale, row.uid)}
        </li>`;
    }

    /** Blocking is a lasting decision about a person, one row from the words that prompted it: it asks first. */
    #blockQuestion(locale: UiLocale, view: ReviewViewState): TemplateResult {
        return html`<hcm-confirm-dialog
            ?open=${view.confirmBlock !== null}
            destructive
            headline=${contentText(locale, 'adminContent.review.blockTitle')}
            body=${contentText(locale, 'adminContent.review.blockBody')}
            confirm-label=${contentText(locale, 'adminContent.review.block')}
            cancel-label=${contentText(locale, 'adminContent.common.cancel')}
            close-label=${contentText(locale, 'adminContent.common.close')}
            @hcm-confirm=${() => void this.intents?.confirmBlock()}
            @hcm-cancel=${() => this.intents?.cancelBlock()}
        ></hcm-confirm-dialog>`;
    }

    #decisions(locale: UiLocale, view: ReviewViewState, row: ReviewSuggestionPort): TemplateResult {
        const decide = (decision: 'approve' | 'adjust' | 'reject') => () =>
            void this.intents?.decideSuggestion(row.id, decision, this.#noteOf(row.id));
        return html`${this.#button(contentText(locale, 'adminContent.review.approve'), 'check', decide('approve'))}
        ${
            view.adjusted === null
                ? this.#button(contentText(locale, 'adminContent.review.adjust'), 'edit', () => this.intents?.startAdjusting())
                : this.#button(contentText(locale, 'adminContent.review.apply'), 'edit', decide('adjust'))
        }
        ${this.#button(contentText(locale, 'adminContent.review.reject'), 'close', decide('reject'))}`;
    }

    #decided(locale: UiLocale, row: ReviewSuggestionPort): TemplateResult {
        return html`<li class="card">
            <strong>${nameIn(locale, row.title)}</strong>
            <span>${factsOf(row.proposal, '')}</span>
            <div class="actions">
                ${this.#button(contentText(locale, 'adminContent.review.revert'), 'undo', () => void this.intents?.revert(row))}
            </div>
        </li>`;
    }

    #request(locale: UiLocale, row: ReviewRequestPort): TemplateResult {
        const role = shellText(locale, `adminShell.city.role.${row.role}`);
        const decide = (decision: 'approve' | 'refuse') => () => void this.intents?.decideRequest(row.uid, decision, this.#noteOf(row.uid));
        return html`<li class="card">
            <strong>${contentText(locale, 'adminContent.review.who', { name: row.name, email: row.email })}</strong>
            <span>${contentText(locale, 'adminContent.review.asks', { role })}</span>
            <p>${row.reason}</p>
            ${row.credit === null ? nothing : html`<span>${contentText(locale, 'adminContent.review.credit', { name: row.credit })}</span>`}
            ${this.#note(row.uid, locale)}
            <div class="actions">
                ${this.#button(contentText(locale, 'adminContent.review.approve'), 'check', decide('approve'))}
                ${this.#button(contentText(locale, 'adminContent.review.refuse'), 'close', decide('refuse'))}
            </div>
        </li>`;
    }

    #map(locale: UiLocale, view: ReviewViewState): TemplateResult {
        if (view.selected === null) {
            return EMPTY;
        }
        const adjusting = html`<p role="status">${contentText(locale, 'adminContent.review.adjusting')}</p>`;
        return html`<hcm-admin-map
                .status=${view.map}
                .locale=${locale}
                @hcm-map-host=${(event: CustomEvent<{ readonly container: HTMLElement }>) => this.intents?.attachMap(event.detail.container)}
                @hcm-zoom=${(event: CustomEvent<{ readonly delta: number }>) => this.intents?.zoomBy(event.detail.delta)}
            ></hcm-admin-map>
            ${view.adjusted === null ? nothing : adjusting}`;
    }
}

/** Registers `<hcm-review-page>` and what it renders; idempotent per registry. */
export function defineHcmReviewPage(registry: CustomElementRegistry = customElements): void {
    defineUiKit(registry);
    defineEditingElements(registry);
    defineHcmAdminMap(registry);
    if (registry.get(HCM_REVIEW_PAGE_TAG) === undefined) {
        registry.define(HCM_REVIEW_PAGE_TAG, HcmReviewPage);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-review-page': HcmReviewPage;
    }
}
