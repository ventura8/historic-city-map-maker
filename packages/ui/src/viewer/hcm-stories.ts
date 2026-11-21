/**
 * `<hcm-stories>` (M17, `docs/research/M17-stories.md` §5; V50): the city's stories inside the `stories` sheet. Without a
 * `storyId` it lists them (the cover thumbnail, the title, the years); with one it reads that story: its years, its text
 * (`parseStory`: paragraphs and figures of the city's own photos, walked into Lit templates, so markup stays text), its credit,
 * and its places and photos as buttons that open them. A figure whose photo the manifest does not list is left out.
 */
import {
    DEFAULT_LOCALE,
    parseStory,
    storyFigureIds,
    translate,
    type ViewerLocale,
    type Photo,
    type Poi,
    type Story,
    type StoryBlock,
    type UnplacedPhoto,
} from '@hcm/shared';
import { LitElement, css, html, type PropertyValues, type TemplateResult } from 'lit';

import { EMPTY } from './empty.js';
import { photoSelectEvent } from './hcm-poi-detail.js';
import { renderParagraph } from './markdown.js';
import { creditLine } from './photo-rights.js';
import { resolveAssetUrl } from './services.js';
import { baseStyles, detailStyles } from './shared-styles.js';
import { localizedText, poiYearsText } from './text.js';

export const HCM_STORIES_TAG = 'hcm-stories';

type AnyPhoto = Photo | UnplacedPhoto;

/** The viewer-internal event asking to open a story (null: their list). */
function storySelectEvent(storyId: string | null): CustomEvent<{ readonly storyId: string | null }> {
    return new CustomEvent('hcm-story-select', { bubbles: true, composed: true, detail: { storyId } });
}

/** The viewer-internal event asking to open a place. */
function poiSelectEvent(poiId: string): CustomEvent<{ readonly poiId: string }> {
    return new CustomEvent('hcm-poi-select', { bubbles: true, composed: true, detail: { poiId } });
}

/** The stories that name `id` among their photos (`photoIds`) or places (`poiIds`), as buttons that open them. */
export function relatedStories(stories: readonly Story[], key: 'photoIds' | 'poiIds', id: string, locale: ViewerLocale): TemplateResult {
    const related = stories.filter((story) => story[key]?.includes(id) === true);
    if (related.length === 0) {
        return EMPTY;
    }
    return html`<section>
        <h3>${translate(locale, 'stories.title')}</h3>
        <ul>
            ${related.map(
                (story) =>
                    html`<li>
                        <button
                            type="button"
                            class="link"
                            @click=${(event: Event) => {
                                event.currentTarget?.dispatchEvent(storySelectEvent(story.id));
                            }}
                        >
                            ${localizedText(story.title, locale)}
                        </button>
                    </li>`,
            )}
        </ul>
    </section>`;
}

export class HcmStories extends LitElement {
    static override readonly properties = {
        stories: { attribute: false },
        storyId: { attribute: false },
        photos: { attribute: false },
        pois: { attribute: false },
        locale: { type: String },
        manifestUrl: { attribute: false },
    };

    static override readonly styles = [
        baseStyles,
        detailStyles,
        css`
            :host {
                display: block;
            }

            ul.stories {
                display: grid;
                gap: 8px;
            }

            .row {
                display: grid;
                grid-template-columns: 64px 1fr;
                gap: 4px 12px;
                align-items: center;
                inline-size: 100%;
                min-block-size: 48px;
                padding: 4px;
                border: 0;
                border-radius: var(--md-sys-shape-corner-medium);
                background: none;
                color: inherit;
                font: inherit;
                text-align: start;
                cursor: pointer;
            }

            img {
                display: block;
                inline-size: 100%;
                aspect-ratio: 1;
                border-radius: var(--md-sys-shape-corner-medium);
                object-fit: cover;
                background: var(--md-sys-color-surface-container-highest);
            }

            figure {
                margin: 0;
            }

            figure img {
                aspect-ratio: auto;
            }

            .row img {
                grid-row: span 2;
            }

            .text {
                max-inline-size: 65ch;
                overflow-wrap: anywhere;
            }

            .years,
            figcaption {
                color: var(--md-sys-color-on-surface-variant);
            }

            .link {
                min-block-size: 48px;
                padding: 0;
                border: 0;
                background: none;
                color: var(--md-sys-color-primary);
                font: inherit;
                text-align: start;
                cursor: pointer;
            }

            article:focus:not(:focus-visible) {
                outline: none;
            }

            figure .link {
                display: block;
                inline-size: 100%;
            }
        `,
    ];

    declare stories: readonly Story[];
    declare storyId: string | null;
    /** Every photo of the manifest, placed or not: figures and the cover come from here; only a placed one opens. */
    declare photos: readonly AnyPhoto[];
    declare pois: readonly Poi[];
    declare locale: ViewerLocale;
    declare manifestUrl: string;

    constructor() {
        super();
        this.stories = [];
        this.storyId = null;
        this.photos = [];
        this.pois = [];
        this.locale = DEFAULT_LOCALE;
        this.manifestUrl = '';
    }

    /**
     * A story opened from the list replaces the button that had the focus: the story itself takes it, so the sheet's Esc and its
     * focus return still work (the tour found the focus lost to the page).
     */
    protected override updated(changed: PropertyValues<this>): void {
        if (changed.has('storyId') && this.storyId !== null) {
            this.renderRoot.querySelector<HTMLElement>('article')?.focus({ preventScroll: true });
        }
    }

    override render(): TemplateResult {
        const story = this.stories.find((candidate) => candidate.id === this.storyId);
        return story === undefined ? this.#list() : this.#story(story);
    }

    #photo(id: string): AnyPhoto | undefined {
        return this.photos.find((photo) => photo.id === id);
    }

    #thumb(photo: AnyPhoto | undefined, alt: string): TemplateResult {
        const src = photo === undefined ? null : resolveAssetUrl(photo.image.thumb, this.manifestUrl, document.baseURI);
        return src === null ? html`<span></span>` : html`<img src=${src} alt=${alt} loading="lazy" decoding="async" />`;
    }

    #select(event: Event): void {
        this.dispatchEvent(event);
    }

    /** Oldest first; a story without a year after every dated one. */
    #list(): TemplateResult {
        const sorted = this.stories.toSorted((a, b) => (a.yearStart ?? 9999) - (b.yearStart ?? 9999));
        return html`<ul class="stories" aria-label=${translate(this.locale, 'stories.title')}>
            ${sorted.map((story) => this.#item(story))}
        </ul>`;
    }

    #item(story: Story): TemplateResult {
        return html`<li>
            <button
                type="button"
                class="row"
                @click=${() => {
                    this.#select(storySelectEvent(story.id));
                }}
            >
                ${this.#thumb(this.#photo(coverId(story)), '')}
                <span>${localizedText(story.title, this.locale)}</span>
                <span class="years">${poiYearsText(story, this.locale)}</span>
            </button>
        </li>`;
    }

    #story(story: Story): TemplateResult {
        const years = poiYearsText(story, this.locale);
        return html`<article class="details" tabindex="-1">
            ${years === null ? EMPTY : html`<p class="years">${years}</p>`}
            <div class="text">${parseStory(localizedText(story.body, this.locale)).map((block) => this.#block(block))}</div>
            ${creditLine(story.credit, this.locale)} ${this.#places(story)} ${this.#photos(story)}
            <p>
                <button
                    type="button"
                    class="link"
                    @click=${() => {
                        this.#select(storySelectEvent(null));
                    }}
                >
                    ${translate(this.locale, 'stories.all')}
                </button>
            </p>
        </article>`;
    }

    #block(block: StoryBlock): TemplateResult {
        if (block.type === 'paragraph') {
            return renderParagraph(block);
        }
        const photo = this.#photo(block.photoId);
        if (photo === undefined) {
            return EMPTY;
        }
        const alt = block.caption === '' ? localizedText(photo.title, this.locale) : block.caption;
        return html`<figure>
            ${this.#opener(photo, this.#thumb(photo, alt))}
            ${block.caption === '' ? EMPTY : html`<figcaption>${block.caption}</figcaption>`}
        </figure>`;
    }

    /** A placed photo opens on the map; one with no place yet is only shown. */
    #opener(photo: AnyPhoto, content: TemplateResult): TemplateResult {
        if (!('location' in photo)) {
            return content;
        }
        return html`<button
            type="button"
            class="link"
            @click=${() => {
                this.#select(photoSelectEvent(photo.id));
            }}
        >
            ${content}
        </button>`;
    }

    #places(story: Story): TemplateResult {
        const places = (story.poiIds ?? []).flatMap((id) => this.pois.find((poi) => poi.id === id) ?? []);
        return this.#section(
            'story.places',
            places,
            (poi) =>
                html`<button
                    type="button"
                    class="link"
                    @click=${() => {
                        this.#select(poiSelectEvent(poi.id));
                    }}
                >
                    ${localizedText(poi.title, this.locale)}
                </button>`,
        );
    }

    #photos(story: Story): TemplateResult {
        const photos = (story.photoIds ?? []).flatMap((id) => this.#photo(id) ?? []);
        return this.#section('story.photos', photos, (photo) => this.#opener(photo, html`${localizedText(photo.title, this.locale)}`));
    }

    #section<Item>(
        heading: 'story.places' | 'story.photos',
        items: readonly Item[],
        item: (value: Item) => TemplateResult,
    ): TemplateResult {
        if (items.length === 0) {
            return EMPTY;
        }
        return html`<section>
            <h3>${translate(this.locale, heading)}</h3>
            <ul>
                ${items.map((value) => html`<li>${item(value)}</li>`)}
            </ul>
        </section>`;
    }
}

/** A story's cover: its first photo, else the first figure of its Romanian text. */
function coverId(story: Story): string {
    return story.photoIds?.[0] ?? storyFigureIds(story.body.ro)[0] ?? '';
}

/** Registers `<hcm-stories>` once; calling it again is a no-op. */
export function defineHcmStories(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_STORIES_TAG) === undefined) {
        registry.define(HCM_STORIES_TAG, HcmStories);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-stories': HcmStories;
    }
}
