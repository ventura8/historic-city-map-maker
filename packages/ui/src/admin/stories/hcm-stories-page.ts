/**
 * `<hcm-stories-page>`: `#/stories` and `#/stories/<id>` (M17, `docs/research/M17-stories.md` §6; behaviour A100) in the list
 * and detail layout. The list has New story (a Romanian title) and every story with its years and its state (Unpublished,
 * Waiting for review, Refused); the detail edits one: both titles and texts (the story format's help under them), the years,
 * the linked photos and places (picked by title), Published for a reviewer, Save and Discard with the conflict banner, Delete
 * after a confirmation, and the link to its versions, where Revert is; New story, Delete and Versions follow the city role as the
 * rules do (M17 §6). Text only: every value is bound as a property or text.
 */
import type { UiLocale, StoryDoc } from '@hcm/shared';
import { css, html, type TemplateResult } from 'lit';

import type { AdminRouteIdPort } from '../admin-port.js';
import type { AreaPort, ContentPort } from '../content-port.js';
import { AreaPage } from '../editing/area-page.js';
import { editingStyles } from '../editing/editing-styles.js';
import { loadingTemplate } from '../editing/states.js';
import { conflictBanner, field, issueAt, saveBar, saveStateOf } from '../layers/form-parts.js';
import { EMPTY } from '../shell/empty.js';
import { contentText as t } from '../shell/text.js';
import { canCreateStory, canDeleteStory, inLocale, seesVersions, stateText, textSpecs } from './stories-fields.js';
import type { StoriesIntentsPort, StoriesViewState, StoryItemPort, StoryPickPort } from './stories-port.js';

export const HCM_STORIES_PAGE_TAG = 'hcm-stories-page';

type Open = NonNullable<StoriesViewState['open']>;

/** The photos or the places of a story, as the editor shows them. */
interface LinkSpec {
    readonly key: 'photoIds' | 'poiIds';
    readonly options: readonly StoryPickPort[] | undefined;
    readonly heading: 'adminContent.stories.photos' | 'adminContent.stories.places';
    readonly add: 'adminContent.stories.addPhoto' | 'adminContent.stories.addPlace';
}

class HcmStoriesPage extends AreaPage<StoriesViewState, StoriesIntentsPort> {
    static override readonly properties = { ...AreaPage.properties, confirming: { state: true }, newTitle: { state: true } };

    static override readonly styles = [
        ...editingStyles,
        css`
            button.row {
                inline-size: 100%;
                border: none;
                background: none;
                font: inherit;
                text-align: start;
                cursor: pointer;
            }

            button.row[aria-current='true'] {
                background: var(--md-sys-color-secondary-container, Highlight);
                color: var(--md-sys-color-on-secondary-container, HighlightText);
            }

            .actions a {
                display: inline-flex;
                align-items: center;
                min-block-size: 48px;
            }

            .chips {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                padding: 0;
                list-style: none;
            }
        `,
    ];

    declare confirming: boolean;
    declare newTitle: string;

    protected readonly route: AdminRouteIdPort = 'stories';

    constructor() {
        super();
        this.confirming = false;
        this.newTitle = '';
    }

    protected storeOf(content: ContentPort): AreaPort<StoriesViewState, StoriesIntentsPort> | null {
        return content.stories;
    }

    override render(): TemplateResult {
        const view = this.view;
        if (view === null) {
            return EMPTY;
        }
        const locale = this.locale;
        return html`<hcm-list-detail
            ?detail=${view.open !== null}
            .detailKey=${view.open?.id ?? ''}
            .listLabel=${t(locale, 'adminContent.stories.listLabel')}
            .detailLabel=${t(locale, 'adminContent.stories.detailLabel')}
            .backLabel=${t(locale, 'adminContent.common.back')}
            .closeLabel=${t(locale, 'adminContent.common.close')}
            @hcm-back=${() => {
                this.go([]);
            }}
        >
            <div slot="list">${this.#create(locale, view)} ${this.#list(locale, view)}</div>
            <div slot="detail">${view.open === null ? this.#choose(locale) : this.#detail(locale, view, view.open)}</div>
        </hcm-list-detail>`;
    }

    #choose(locale: UiLocale): TemplateResult {
        return html`<hcm-empty-state icon="museum" .text=${t(locale, 'adminContent.stories.choose')}></hcm-empty-state>`;
    }

    #create(locale: UiLocale, view: StoriesViewState): TemplateResult {
        if (!canCreateStory(view.role)) {
            return EMPTY;
        }
        const create = async (): Promise<void> => {
            const id = await this.intents?.create(this.newTitle);
            if (typeof id === 'string') {
                this.newTitle = '';
                this.go([id]);
            }
        };
        return html`<div class="pane">
            ${field(locale, {
                id: 'story-new',
                label: t(locale, 'adminContent.stories.newTitle'),
                value: this.newTitle,
                issue: null,
                readOnly: this.readOnly,
                onInput: (text) => {
                    this.newTitle = text;
                },
            })}
            <div class="actions">
                <hcm-button
                    variant="tonal"
                    icon="add"
                    ?disabled=${this.readOnly || view.busy || this.newTitle.trim() === ''}
                    @click=${create}
                    >${t(locale, 'adminContent.stories.create')}</hcm-button
                >
            </div>
        </div>`;
    }

    #list(locale: UiLocale, view: StoriesViewState): TemplateResult {
        const list = view.list;
        if (list.status === 'error') {
            return html`<p class="alert" role="alert">
                ${t(locale, 'adminContent.common.loadFailed', { code: list.failure?.code ?? '' })}
            </p>`;
        }
        if (list.items.length === 0) {
            return this.#empty(locale, list);
        }
        return html`<ul class="rows" aria-label=${t(locale, 'adminContent.stories.listLabel')}>
                ${list.items.map((item) => this.#row(locale, item, item.id === view.open?.id))}
            </ul>
            ${this.#more(locale, list.hasMore)}`;
    }

    /** No story yet, or none read yet. */
    #empty(locale: UiLocale, list: StoriesViewState['list']): TemplateResult {
        return list.status === 'loading'
            ? loadingTemplate(locale)
            : html`<hcm-empty-state icon="museum" .text=${t(locale, 'adminContent.stories.empty')}></hcm-empty-state>`;
    }

    #more(locale: UiLocale, hasMore: boolean): TemplateResult {
        const more = (): void => {
            this.intents?.more();
        };
        return hasMore
            ? html`<div class="actions more">
                  <hcm-button variant="text" icon="expand_more" @click=${more}>${t(locale, 'adminContent.common.more')}</hcm-button>
              </div>`
            : EMPTY;
    }

    #row(locale: UiLocale, item: StoryItemPort, selected: boolean): TemplateResult {
        const years = [item.yearStart, item.yearEnd].filter((year) => year !== null).join('–');
        const status = stateText(locale, item);
        return html`<li>
            <button
                class="row"
                type="button"
                aria-current=${selected ? 'true' : 'false'}
                @click=${() => {
                    this.go([item.id]);
                }}
            >
                <span class="row-title">${inLocale(item.title, locale)}</span>
                <span class="row-detail">${[years, status].filter((part) => part !== '').join(' · ')}</span>
            </button>
        </li>`;
    }

    #detail(locale: UiLocale, view: StoriesViewState, open: Open): TemplateResult {
        const value = open.draft.value;
        if (value === null) {
            const missing = open.doc.status === 'ready' && open.doc.doc === null;
            return missing ? html`<p class="pane" role="alert">${t(locale, 'adminContent.stories.notFound')}</p>` : loadingTemplate(locale);
        }
        const draft = open.draft;
        const edit = (patch: Partial<StoryDoc>): void => {
            this.intents?.edit(patch);
        };
        return html`<div class="pane">
            <h2 tabindex="-1" data-detail-heading>${inLocale(value.title, locale)}</h2>
            ${saveBar(
                locale,
                {
                    saved: 'adminContent.stories.state.saved',
                    unsaved: 'adminContent.stories.state.unsaved',
                    saving: 'adminContent.stories.state.saving',
                },
                { ...saveStateOf({ ...draft, dirty: draft.dirty.length > 0 }), readOnly: this.readOnly },
                {
                    save: () => void this.intents?.save(),
                    discard: () => {
                        this.intents?.discard();
                    },
                },
            )}
            ${conflictBanner(
                locale,
                {
                    conflict: 'adminContent.stories.conflict',
                    keepMine: 'adminContent.stories.keepMine',
                    takeTheirs: 'adminContent.stories.takeTheirs',
                },
                draft.conflict,
                {
                    keepMine: () => {
                        this.intents?.keepMine();
                    },
                    takeTheirs: () => {
                        this.intents?.takeTheirs();
                    },
                    who: { self: this.self, people: this.people },
                    readOnly: this.readOnly,
                },
            )}
            ${this.#texts(locale, value, draft.issues, edit)} ${this.#links(locale, view, value, edit)}
            ${this.#publishing(locale, view, value, edit)} ${this.#actions(locale, view, open, value)}
        </div>`;
    }

    #texts(locale: UiLocale, value: StoryDoc, issues: Open['draft']['issues'], edit: (patch: Partial<StoryDoc>) => void): TemplateResult {
        const readOnly = this.readOnly;
        return html`${textSpecs(locale, value, edit).map((spec) =>
            field(locale, { ...spec, label: t(locale, spec.key), issue: issueAt(issues, spec.id.replace('-', '.')), readOnly }),
        )}`;
    }

    #links(locale: UiLocale, view: StoriesViewState, value: StoryDoc, edit: (patch: Partial<StoryDoc>) => void): TemplateResult {
        const photos = {
            key: 'photoIds',
            options: view.picks?.photos,
            heading: 'adminContent.stories.photos',
            add: 'adminContent.stories.addPhoto',
        } as const;
        const places = {
            key: 'poiIds',
            options: view.picks?.places,
            heading: 'adminContent.stories.places',
            add: 'adminContent.stories.addPlace',
        } as const;
        return html`${this.#linked(locale, value, photos, edit)} ${this.#linked(locale, value, places, edit)}`;
    }

    /** The linked photos or places as chips that remove them, and a select of the city's others that adds one. */
    #linked(locale: UiLocale, value: StoryDoc, spec: LinkSpec, edit: (patch: Partial<StoryDoc>) => void): TemplateResult {
        const ids = value[spec.key] ?? [];
        const options = spec.options ?? [];
        const titleOf = (id: string): string => inLocale(options.find((pick) => pick.id === id)?.title ?? { ro: id }, locale);
        const set = (next: readonly string[]): void => {
            edit({ [spec.key]: next.length === 0 ? undefined : [...next] });
        };
        const add = (event: Event): void => {
            const select = event.target as HTMLSelectElement;
            set([...ids, select.value]);
            select.value = '';
        };
        const chip = (id: string): TemplateResult =>
            html`<li>
                <hcm-button
                    variant="outlined"
                    icon="close"
                    ?disabled=${this.readOnly}
                    .label=${t(locale, 'adminContent.stories.remove', { title: titleOf(id) })}
                    @click=${() => {
                        set(ids.filter((other) => other !== id));
                    }}
                    >${titleOf(id)}</hcm-button
                >
            </li>`;
        return html`<section class="field">
            <h3>${t(locale, spec.heading)}</h3>
            <ul class="chips">
                ${ids.map(chip)}
            </ul>
            <label for=${spec.key}>${t(locale, spec.add)}</label>
            <select id=${spec.key} ?disabled=${this.readOnly || spec.options === undefined} @change=${add}>
                <option value="">${t(locale, 'adminContent.stories.pick')}</option>
                ${options.filter((pick) => !ids.includes(pick.id)).map((pick) => html`<option value=${pick.id}>${inLocale(pick.title, locale)}</option>`)}
            </select>
        </section>`;
    }

    /** The pickers' photos and places are read once, when a story first opens. */
    protected override updated(): void {
        const view = this.view;
        if (view !== null && view.open !== null && view.picks === null) {
            this.intents?.loadPicks();
        }
    }

    #publishing(locale: UiLocale, view: StoriesViewState, value: StoryDoc, edit: (patch: Partial<StoryDoc>) => void): TemplateResult {
        const waiting = value.reviewStatus === 'pending' || value.reviewStatus === 'refused';
        if (!view.reviewer || waiting) {
            return html`<p class="note">${t(locale, 'adminContent.stories.waitsHelp')}</p>`;
        }
        const label = t(locale, 'adminContent.stories.published');
        return html`<div class="switch-row">
                <span aria-hidden="true">${label}</span>
                <hcm-switch
                    .checked=${value.published}
                    ?disabled=${this.readOnly}
                    label=${label}
                    @hcm-change=${(event: Event) => {
                        edit({ published: (event as CustomEvent<{ checked: boolean }>).detail.checked });
                    }}
                ></hcm-switch>
            </div>
            <p class="note">${t(locale, 'adminContent.stories.publishedHelp')}</p>`;
    }

    #actions(locale: UiLocale, view: StoriesViewState, open: Open, value: StoryDoc): TemplateResult {
        const remove = async (): Promise<void> => {
            this.confirming = false;
            const outcome = await this.intents?.remove();
            if (outcome?.ok === true) {
                this.go([]);
            }
        };
        const versions = seesVersions(view.role)
            ? html`<a href=${['#', 'history', 'story', open.id].join('/')}>${t(locale, 'adminContent.stories.versions')}</a>`
            : EMPTY;
        const deleting = canDeleteStory(view.role, value)
            ? html`<hcm-button
                  variant="text"
                  icon="delete"
                  ?disabled=${this.readOnly || view.busy || open.draft.base === null}
                  @click=${() => {
                      this.confirming = true;
                  }}
                  >${t(locale, 'adminContent.stories.delete')}</hcm-button
              >`
            : EMPTY;
        return html`<div class="actions">${versions} ${deleting}</div>
            <hcm-confirm-dialog
                destructive
                .open=${this.confirming}
                .headline=${t(locale, 'adminContent.stories.deleteTitle', { title: inLocale(value.title, locale) })}
                .body=${t(locale, 'adminContent.stories.deleteBody')}
                .confirmLabel=${t(locale, 'adminContent.stories.delete')}
                .cancelLabel=${t(locale, 'adminContent.common.cancel')}
                @hcm-confirm=${remove}
                @hcm-cancel=${() => {
                    this.confirming = false;
                }}
            ></hcm-confirm-dialog>`;
    }
}

export function defineHcmStoriesPage(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_STORIES_PAGE_TAG) === undefined) {
        registry.define(HCM_STORIES_PAGE_TAG, HcmStoriesPage);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-stories-page': HcmStoriesPage;
    }
}
