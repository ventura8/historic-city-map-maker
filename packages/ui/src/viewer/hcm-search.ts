/**
 * `<hcm-search>`: the public viewer's manifest search bar. Finds places, POIs, disappeared streets, photos and stories
 * from the already-loaded `Manifest` without network calls, and dispatches `hcm-search-select` when a visitor picks a
 * result so the viewer flies the map there and opens it.
 */
import { DEFAULT_LOCALE, translate, type Manifest, type ViewerLocale } from '@hcm/shared';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';

import { defineOnce } from '../components/internal.js';
import { focusRing, stateLayer } from '../components/styles.js';
import { baseStyles } from './shared-styles.js';
import { searchManifest, type SearchResult } from './viewer-search.js';

export const HCM_SEARCH_TAG = 'hcm-search';

const LISTBOX_ID = 'hcm-search-results';

export class HcmSearch extends LitElement {
    static override readonly properties = {
        manifest: { attribute: false },
        locale: { type: String },
        query: { state: true },
        open: { state: true },
        activeIndex: { state: true },
    };

    static override readonly styles = [
        baseStyles,
        focusRing,
        stateLayer,
        css`
            :host {
                display: block;
                inline-size: 100%;
            }

            .box {
                position: relative;
            }

            /*
             * The input is the pill itself, its outline the field's boundary at 3:1 or more against its surface (WCAG 1.4.11;
             * lesson 804: a borderless input inside a filled pill reached 1:1, and over the map the pill's own edge cannot be
             * measured). The search icon and the clear button sit over its ends.
             */
            .field {
                position: relative;
                border-radius: var(--md-sys-shape-corner-full);
                box-shadow: var(--md-sys-elevation-level2);
            }

            .field > hcm-icon {
                position: absolute;
                inset-block-start: 50%;
                inset-inline-start: 12px;
                translate: 0 -50%;
                color: var(--md-sys-color-on-surface-variant);
                pointer-events: none;
            }

            input {
                box-sizing: border-box;
                inline-size: 100%;
                min-block-size: 48px;
                margin: 0;
                padding-block: 0;
                padding-inline: 44px;
                border: 1px solid var(--md-sys-color-outline);
                border-radius: var(--md-sys-shape-corner-full);
                background: var(--md-sys-color-surface-container-high);
                color: var(--md-sys-color-on-surface);
                font: inherit;
                font-size: var(--md-sys-typescale-body-medium-size, 14px);
                line-height: 1.4;
            }

            input::placeholder {
                color: var(--md-sys-color-on-surface-variant);
            }

            .clear {
                position: absolute;
                inset-block-start: 50%;
                inset-inline-end: 4px;
                translate: 0 -50%;
                display: inline-grid;
                place-items: center;
                flex: none;
                inline-size: 36px;
                block-size: 36px;
                padding: 0;
                border: none;
                border-radius: var(--md-sys-shape-corner-full);
                background: transparent;
                color: var(--md-sys-color-on-surface-variant);
                cursor: pointer;
            }

            .results {
                position: absolute;
                inset-inline: 0;
                inset-block-start: calc(100% + 6px);
                max-block-size: min(320px, 50vh);
                overflow-y: auto;
                margin: 0;
                padding: 6px;
                list-style: none;
                border-radius: var(--md-sys-shape-corner-large, 16px);
                background: var(--md-sys-color-surface-container-high);
                color: var(--md-sys-color-on-surface);
                box-shadow: var(--md-sys-elevation-level3, var(--md-sys-elevation-level2));
            }

            .result {
                display: flex;
                align-items: center;
                gap: 10px;
                inline-size: 100%;
                min-block-size: 44px;
                padding: 8px 10px;
                border: none;
                border-radius: var(--md-sys-shape-corner-medium, 12px);
                background: transparent;
                color: inherit;
                font: inherit;
                text-align: start;
                cursor: pointer;
            }

            .result:hover,
            .result[data-active] {
                background: var(--md-sys-color-surface-container-highest);
            }

            .meta {
                display: flex;
                flex-direction: column;
                min-inline-size: 0;
            }

            .title {
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                font-size: var(--md-sys-typescale-body-medium-size, 14px);
            }

            .subtitle {
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                font-size: var(--md-sys-typescale-body-small-size, 12px);
                color: var(--md-sys-color-on-surface-variant);
            }

            .empty {
                margin: 0;
                padding: 12px 10px;
                font-size: var(--md-sys-typescale-body-medium-size, 14px);
                color: var(--md-sys-color-on-surface-variant);
            }
        `,
    ];

    declare manifest: Manifest | null;
    declare locale: ViewerLocale;
    declare query: string;
    declare open: boolean;
    declare activeIndex: number;

    constructor() {
        super();
        this.manifest = null;
        this.locale = DEFAULT_LOCALE;
        this.query = '';
        this.open = false;
        this.activeIndex = -1;
    }

    #results(): readonly SearchResult[] {
        return this.manifest === null ? [] : searchManifest(this.manifest, this.query, this.locale);
    }

    #onInput(event: Event): void {
        const target = event.target as HTMLInputElement;
        this.query = target.value;
        this.open = this.query.trim() !== '';
        this.activeIndex = -1;
    }

    #onFocus(): void {
        if (this.query.trim() !== '') {
            this.open = true;
        }
    }

    #onClear(): void {
        this.query = '';
        this.open = false;
        this.activeIndex = -1;
        this.renderRoot.querySelector('input')?.focus();
    }

    #pick(result: SearchResult): void {
        this.open = false;
        this.activeIndex = -1;
        this.dispatchEvent(new CustomEvent('hcm-search-select', { detail: { result }, bubbles: true, composed: true }));
    }

    #onKeydown(event: KeyboardEvent): void {
        if (event.key === 'Escape') {
            this.open = false;
            this.activeIndex = -1;
            return;
        }
        const results = this.#results();
        if (!this.open || results.length === 0) {
            return;
        }
        this.#handleListKey(event, results);
    }

    #pickActive(results: readonly SearchResult[]): void {
        const picked = results[Math.max(0, this.activeIndex)];
        if (picked !== undefined) {
            this.#pick(picked);
        }
    }

    #handleListKey(event: KeyboardEvent, results: readonly SearchResult[]): void {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            this.activeIndex = (this.activeIndex + 1) % results.length;
            return;
        }
        if (event.key === 'ArrowUp') {
            event.preventDefault();
            this.activeIndex = (this.activeIndex - 1 + results.length) % results.length;
            return;
        }
        if (event.key === 'Enter') {
            event.preventDefault();
            this.#pickActive(results);
        }
    }

    #renderResult(result: SearchResult, index: number): TemplateResult {
        const active = index === this.activeIndex;
        return html`<li role="option" aria-selected=${active ? 'true' : 'false'}>
            <button
                type="button"
                class="result"
                ?data-active=${active}
                @click=${() => {
                    this.#pick(result);
                }}
            >
                <hcm-icon name=${result.icon}></hcm-icon>
                <span class="meta">
                    <span class="title">${result.title}</span>
                    <span class="subtitle">${result.subtitle}</span>
                </span>
            </button>
        </li>`;
    }

    #renderList(results: readonly SearchResult[]): TemplateResult {
        if (results.length === 0) {
            return html`<div id=${LISTBOX_ID} class="results" role="status">
                <p class="empty">${translate(this.locale, 'search.empty')}</p>
            </div>`;
        }
        return html`<ul id=${LISTBOX_ID} class="results" role="listbox" aria-label=${translate(this.locale, 'search.results')}>
            ${results.map((result, index) => this.#renderResult(result, index))}
        </ul>`;
    }

    override render(): TemplateResult {
        const results = this.open ? this.#results() : [];
        const label = translate(this.locale, 'search.label');
        return html`<div class="box">
            <div class="field">
                <hcm-icon name="search"></hcm-icon>
                <input
                    type="search"
                    role="combobox"
                    autocomplete="off"
                    .value=${this.query}
                    aria-label=${label}
                    aria-expanded=${this.open ? 'true' : 'false'}
                    aria-controls=${LISTBOX_ID}
                    placeholder=${translate(this.locale, 'search.placeholder')}
                    @input=${this.#onInput}
                    @focus=${this.#onFocus}
                    @keydown=${this.#onKeydown}
                />
                ${
                    this.query === ''
                        ? nothing
                        : html`<button
                              type="button"
                              class="clear"
                              aria-label=${translate(this.locale, 'search.clear')}
                              @click=${this.#onClear}
                          >
                              <hcm-icon name="close"></hcm-icon>
                          </button>`
                }
            </div>
            ${this.open ? this.#renderList(results) : nothing}
        </div>`;
    }
}

/** Registers `<hcm-search>` once (idempotent). */
export function defineHcmSearch(registry: CustomElementRegistry = customElements): void {
    defineOnce(registry, HCM_SEARCH_TAG, HcmSearch);
}
