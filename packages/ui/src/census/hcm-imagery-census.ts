/**
 * `<hcm-imagery-census>` (M29, `docs/research/M29-imagery-census.md`): how many old images from above the chosen rectangle has,
 * shown on the start page and in Setup's first step. It searches on its own when its rectangle changes (after a short pause, so
 * typing an edge searches once), cancels a search the rectangle outdated, and says in plain words what failed and what to do.
 */
import { CENSUS_ESTIMATE_CHECKED_ON, imageryCensus, translateCensus } from '@hcm/shared/census';
import type { CensusBox, CensusFailure, CensusFetch, CensusKey, CountRange, ImageryCensus } from '@hcm/shared/census';
import { createLogger, intlTag, type UiLocale } from '@hcm/shared';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';

import { defineOnce } from '../components/internal.js';

export const HCM_IMAGERY_CENSUS_TAG = 'hcm-imagery-census';
/** The pause after the last change of the rectangle before searching. */
export const CENSUS_DEBOUNCE_MS = 500;

const log = createLogger('census');

type CensusState =
    | { readonly kind: 'waiting' }
    | { readonly kind: 'loading' }
    | { readonly kind: 'ready'; readonly census: ImageryCensus }
    | { readonly kind: 'failed'; readonly reason: CensusFailure };

const FAILURES: Readonly<Record<CensusFailure, CensusKey>> = {
    offline: 'census.failed.offline',
    refused: 'census.failed.refused',
    unreadable: 'census.failed.unreadable',
};

function reasonOf(error: unknown): CensusFailure {
    return error instanceof Error && 'reason' in error && typeof error.reason === 'string' && error.reason in FAILURES
        ? (error.reason as CensusFailure)
        : 'unreadable';
}

const sameBox = (a: CensusBox | null, b: CensusBox | null): boolean => a?.join() === b?.join();

export class HcmImageryCensus extends LitElement {
    static override readonly properties = {
        box: { attribute: false },
        locale: { type: String },
        fetcher: { attribute: false },
        usgsLink: { type: String, attribute: 'usgs-link' },
        state: { state: true },
    };

    static override readonly styles = css`
        :host {
            display: block;
            margin-block: 16px;
            padding: 16px;
            border-radius: 16px;
            background: var(--md-sys-color-surface-container);
            color: var(--md-sys-color-on-surface);
        }

        h2 {
            font-size: 1.125rem;
            margin-block: 0 8px;
        }

        p,
        ul {
            margin-block: 4px;
        }

        .note {
            color: var(--md-sys-color-on-surface-variant);
            font-size: 0.875rem;
        }

        .alert {
            color: var(--md-sys-color-error);
        }

        .counts {
            font-weight: 600;
        }

        ol.previews {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(8rem, 1fr));
            gap: 8px;
            padding: 0;
            list-style: none;
        }

        figure {
            margin: 0;
        }

        img {
            display: block;
            inline-size: 100%;
            aspect-ratio: 1;
            object-fit: cover;
            border-radius: 8px;
            background: var(--md-sys-color-surface-container-highest);
        }

        figcaption {
            font-size: 0.75rem;
        }

        button,
        a {
            min-block-size: 48px;
            min-inline-size: 48px;
        }

        button {
            padding-inline: 16px;
            border: 1px solid var(--md-sys-color-outline);
            border-radius: 20px;
            background: transparent;
            color: var(--md-sys-color-primary);
            font: inherit;
        }

        a {
            display: inline-flex;
            align-items: center;
            color: var(--md-sys-color-primary);
        }
    `;

    declare box: CensusBox | null;
    declare locale: UiLocale;
    declare fetcher: CensusFetch;
    /** Where the USGS step is (Setup's deep link), or '' where Setup is not reachable yet (the start page). */
    declare usgsLink: string;
    declare state: CensusState;

    #searched: CensusBox | null = null;
    #timer: ReturnType<typeof setTimeout> | undefined;
    #abort: AbortController | undefined;

    constructor() {
        super();
        this.box = null;
        this.locale = 'ro';
        this.fetcher = (url, init) => fetch(url, init);
        this.usgsLink = '';
        this.state = { kind: 'waiting' };
    }

    override disconnectedCallback(): void {
        super.disconnectedCallback();
        this.#cancel();
        this.#searched = null;
    }

    protected override willUpdate(): void {
        if (sameBox(this.box, this.#searched)) {
            return;
        }
        this.#cancel();
        this.#searched = this.box;
        if (this.box === null) {
            this.state = { kind: 'waiting' };
            return;
        }
        this.state = { kind: 'loading' };
        const box = this.box;
        this.#timer = setTimeout(() => void this.#search(box), CENSUS_DEBOUNCE_MS);
    }

    #cancel(): void {
        clearTimeout(this.#timer);
        this.#abort?.abort();
    }

    async #search(box: CensusBox): Promise<void> {
        const abort = new AbortController();
        this.#abort = abort;
        this.state = { kind: 'loading' };
        try {
            const census = await imageryCensus(this.fetcher, box, abort.signal);
            this.state = { kind: 'ready', census };
            log.info('imagery census ready', { landsat: census.landsat, previews: census.previews.length, box: box.join(',') });
        } catch (error) {
            if (abort.signal.aborted) {
                return;
            }
            const reason = reasonOf(error);
            this.state = { kind: 'failed', reason };
            log.warn('imagery census failed', { reason, box: box.join(',') });
        }
    }

    #t(key: CensusKey, params?: Readonly<Record<string, string>>): string {
        return translateCensus(this.locale, key, params);
    }

    #n(value: number): string {
        return new Intl.NumberFormat(intlTag(this.locale)).format(value);
    }

    #usd(value: number): string {
        return new Intl.NumberFormat(intlTag(this.locale), { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
    }

    #range(key: CensusKey, range: CountRange): string {
        return this.#t(key, { low: this.#n(range.low), high: this.#n(range.high) });
    }

    override render(): TemplateResult {
        return html`<section aria-labelledby="census-title" aria-busy=${this.state.kind === 'loading' ? 'true' : 'false'}>
            <h2 id="census-title">${this.#t('census.title')}</h2>
            ${this.#body()}
        </section>`;
    }

    #body(): TemplateResult {
        switch (this.state.kind) {
            case 'waiting':
                return html`<p class="note">${this.#t('census.waiting')}</p>`;
            case 'loading':
                return html`<p role="status" data-census-loading>${this.#t('census.loading')}</p>`;
            case 'failed':
                return this.#failed(this.state.reason);
            case 'ready':
                return this.#ready(this.state.census);
        }
    }

    #failed(reason: CensusFailure): TemplateResult {
        return html`<div role="alert" data-census-failed=${reason}>
            <p class="alert">${this.#t(FAILURES[reason])}</p>
            <p>${this.#t('census.failed.help')}</p>
            <button
                type="button"
                @click=${() => {
                    if (this.box !== null) {
                        void this.#search(this.box);
                    }
                }}
            >
                ${this.#t('census.retry')}
            </button>
        </div>`;
    }

    #ready(census: ImageryCensus): TemplateResult {
        const count = this.#n(census.landsat);
        const params = { scan: this.#usd(census.scanUsd), fee: this.#usd(census.orderFeeUsd) };
        return html`<div role="status" data-census-ready>
                <p class="counts">${this.#range('census.total', census.total)}</p>
                <ul>
                    <li>${this.#range('census.free', census.free)}</li>
                    <li>${this.#range('census.paid', census.declassifiedPaid)}</li>
                </ul>
            </div>
            <p>${this.#t(census.landsatMore ? 'census.landsatMore' : 'census.landsat', { count })}</p>
            <p>${this.#t('census.declassified')}</p>
            <ul>
                <li>${this.#range('census.declassifiedFree', census.declassifiedFree)}</li>
                <li>${this.#t('census.declassifiedPaid', { ...this.#rangeParams(census.declassifiedPaid), ...params })}</li>
            </ul>
            <p class="note">${this.#t('census.unlock')}</p>
            ${this.usgsLink === '' ? nothing : html`<a href=${this.usgsLink}>${this.#t('census.unlockLink')}</a>`} ${this.#previews(census)}
            <p class="note">${this.#t('census.source', { date: CENSUS_ESTIMATE_CHECKED_ON })}</p>`;
    }

    #rangeParams(range: CountRange): Readonly<Record<string, string>> {
        return { low: this.#n(range.low), high: this.#n(range.high) };
    }

    #previews(census: ImageryCensus): TemplateResult {
        if (census.previews.length === 0) {
            return html`<p class="note" data-census-none>${this.#t('census.none')}</p>`;
        }
        return html`<h3 class="note">${this.#t('census.previews')}</h3>
            <ol class="previews">
                ${census.previews.map((preview) => {
                    const caption = this.#t('census.preview', {
                        decade: String(preview.decade),
                        mission: String(preview.mission),
                        date: preview.date,
                        cloud: String(preview.cloud),
                    });
                    return html`<li>
                        <figure>
                            ${
                                preview.image === null
                                    ? html`<p class="note">${this.#t('census.noPreview')}</p>`
                                    : html`<img src=${preview.image} alt="" loading="lazy" referrerpolicy="no-referrer" />`
                            }
                            <figcaption>${caption}</figcaption>
                        </figure>
                    </li>`;
                })}
            </ol>`;
    }
}

/** Setup's census: until Setup is done, the start page's rectangle (when the project names one), with the USGS step's link. */
export function setupCensus(
    view: { readonly ready: boolean; readonly cityBBox?: CensusBox | null },
    locale: UiLocale,
): TemplateResult | typeof nothing {
    const box = view.ready ? null : (view.cityBBox ?? null);
    return box === null ? nothing : html`<hcm-imagery-census .box=${box} .locale=${locale} usgs-link="#/setup/usgs"></hcm-imagery-census>`;
}

export function defineHcmImageryCensus(registry: CustomElementRegistry = customElements): void {
    defineOnce(registry, HCM_IMAGERY_CENSUS_TAG, HcmImageryCensus);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-imagery-census': HcmImageryCensus;
    }
}
