/**
 * `<hcm-home-page>`: the dashboard, `#/home` (the M2c brief's "dashboard home"; `docs/research/M2c-interfaces.md`
 * CR-M2c-24). What the city holds (photos, places, categories, layers), what waits for an admin (photos in rights review,
 * unpublished photos, running and failed jobs), each a link to its page; one chip per Setup area with its state (live,
 * from `setup/status`), and the public map's state (live, from `manifests/{city}`) with **Not on the public map**: every
 * document the last build left out, its first issue and a link to its editor (`docs/research/M2c-interfaces.md` §5.4,
 * S-A38-BAD-SKIPPED-SHOWN). A count that could not be read shows a dash; Refresh counts again. M6 (setup-ux): first,
 * what Setup left open (`./reminders.ts`): USGS later or waiting for its approval, a likely free trial ending soon. M18
 * item 7: then What needs you (`NEEDS`). The owner, 2026-11-16: last, Visitors (`<hcm-home-visitors>`, `./hcm-home-visitors.ts`) and Monthly costs (`<hcm-home-costs>`, `./hcm-home-costs.ts`, defined by its lazy chunk).
 */
import { translate, type UiLocale } from '@hcm/shared';
import { css, html, type TemplateResult } from 'lit';

import { visuallyHidden } from '../../components/styles.js';
import type { AdminRouteIdPort } from '../admin-port.js';
import type { AreaPort, ContentPort } from '../content-port.js';
import { AreaPage } from '../editing/area-page.js';
import { editingStyles } from '../editing/editing-styles.js';
import { fieldName } from '../editing/field-names.js';
import { errorTemplate, formatWhen, reconnectingStatus } from '../editing/states.js';
import { EMPTY } from '../shell/empty.js';
import { contentText, noticeOf, shellText } from '../shell/text.js';
import type { HealthChipPort, HomeCountPort, HomeIntentsPort, HomeViewState, PublicMapPort, SkippedDocumentPort } from './home-port.js';
import { reminderStyles, remindersSection } from './reminders.js';

export const HCM_HOME_PAGE_TAG = 'hcm-home-page';

interface Tile {
    readonly count: HomeCountPort;
    readonly href: string;
}

const HOLDINGS: readonly Tile[] = [
    { count: 'photos', href: '#/photos' },
    { count: 'pois', href: '#/pois' },
    { count: 'categories', href: '#/settings/categories' },
    { count: 'layers', href: '#/layers' },
];

const WAITING: readonly Tile[] = [
    { count: 'rightsReviews', href: '#/photos' },
    { count: 'unpublishedPhotos', href: '#/photos' },
    { count: 'activeJobs', href: '#/jobs' },
    // M3 (admin-imagery): the scans waiting for points, on the Imagery page. M18: the failed jobs and the layer versions to
    // approve are in What needs you (`NEEDS`), shown only while there are some.
    { count: 'versionsNeedingPoints', href: '#/imagery' },
];

/**
 * M18 item 7 (`docs/research/M18-improvements.md`): What needs you, first: only what waits for a person now, each a link to
 * where it is done (images to approve, role requests to accept, suggestions, photos, places and stories to review, jobs that
 * stopped).
 */
const NEEDS: readonly Tile[] = [
    { count: 'versionsToApprove', href: '#/imagery' },
    { count: 'roleRequests', href: '#/review' },
    { count: 'suggestionsToReview', href: '#/review' },
    // The merge of M17 (stories) with M18: an uploader's story waits in the same review queue, as their photos and places
    // do (DECISIONS-for-review.md §104c).
    { count: 'photosToReview', href: '#/review' },
    { count: 'placesToReview', href: '#/review' },
    { count: 'storiesToReview', href: '#/review' },
    { count: 'failedJobs', href: '#/jobs' },
];

const TONES: Readonly<Record<HealthChipPort['state'], 'good' | 'wait' | 'error' | 'none'>> = {
    ok: 'good',
    pending: 'wait',
    missing: 'none',
    invalid: 'error',
    unavailable: 'error',
};

const ICONS: Readonly<Record<HealthChipPort['state'], string>> = {
    ok: 'check_circle',
    pending: 'schedule',
    missing: 'info',
    invalid: 'error',
    unavailable: 'warning',
};

const homeStyles = css`
    .tiles {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(min(100%, 160px), 1fr));
        gap: 8px;
        margin: 0;
        padding: 0;
        list-style: none;
    }

    /* The grid stretches each item to its row's height; the tile fills its item, so a row's tiles are as tall. */
    .tiles > li {
        display: flex;
    }

    .tile {
        display: flex;
        flex: 1 1 auto;
        flex-direction: column;
        gap: 4px;
        box-sizing: border-box;
        min-block-size: 88px;
        padding: 16px;
        border-radius: var(--md-sys-shape-corner-large, 16px);
        background: var(--md-sys-color-surface-container-low, Canvas);
        color: inherit;
        text-decoration: none;
    }

    a.tile:hover {
        background: var(--md-sys-color-surface-container, Canvas);
    }

    .value {
        font-size: var(--md-sys-typescale-headline-medium-size, 1.75rem);
        line-height: var(--md-sys-typescale-headline-medium-line-height, 2.25rem);
    }

    .tile[data-attention] .value {
        color: var(--md-sys-color-primary, LinkText);
    }

    section {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    ul.chips {
        margin: 0;
        padding: 0;
        list-style: none;
    }

    /* A link in a sentence is still a 48 px target on a touch window (the checker's target sizes). */
    ul.skipped {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin: 0;
        padding: 0;
        list-style: none;
    }

    ul.skipped a {
        display: inline-flex;
        align-items: center;
        min-block-size: 48px;
    }
`;

export class HcmHomePage extends AreaPage<HomeViewState, HomeIntentsPort> {
    /** The dashboard scrolls with the page area like a form; it has no panes. */
    static override readonly fillsPage: boolean = false;

    static override readonly styles = [...editingStyles, homeStyles, reminderStyles, visuallyHidden];

    protected readonly route: AdminRouteIdPort = 'home';

    protected storeOf(content: ContentPort): AreaPort<HomeViewState, HomeIntentsPort> | null {
        return content.home;
    }

    override render(): TemplateResult {
        const view = this.view;
        if (view === null) {
            return EMPTY;
        }
        const locale = this.locale;
        const refresh = (): void => {
            void this.intents?.refresh();
        };
        return html`<div class="pane">
            ${remindersSection(locale, view, this.intents)}
            <div class="actions">
                <hcm-button variant="tonal" icon="refresh" ?disabled=${view.countsStatus === 'loading'} @click=${refresh}
                    >${shellText(locale, 'adminShell.home.refresh')}</hcm-button
                >
            </div>
            ${this.#tiles(locale, view, 'adminShell.home.needsYou', needs(view))}
            ${this.#tiles(locale, view, 'adminShell.home.holdings', HOLDINGS)}
            ${this.#tiles(locale, view, 'adminShell.home.waiting', WAITING)} ${this.#health(locale, view)} ${this.#publicMap(locale, view)}
            <hcm-home-visitors .statistics=${view.visitors} locale=${locale}></hcm-home-visitors>
            <hcm-home-costs .costs=${view.costs} locale=${locale}></hcm-home-costs>
        </div>`;
    }

    #tiles(
        locale: UiLocale,
        view: HomeViewState,
        heading: 'adminShell.home.holdings' | 'adminShell.home.waiting' | 'adminShell.home.needsYou',
        tiles: readonly Tile[],
    ): TemplateResult {
        return html`<section aria-labelledby=${heading}>
            <h2 id=${heading}>${shellText(locale, heading)}</h2>
            ${
                tiles.length === 0
                    ? html`<p>${shellText(locale, 'adminShell.home.needsNothing')}</p>`
                    : html`<ul class="tiles">
                          ${tiles.map((tile) => this.#tile(locale, view, tile, heading !== 'adminShell.home.holdings'))}
                      </ul>`
            }
        </section>`;
    }

    #tile(locale: UiLocale, view: HomeViewState, tile: Tile, attention: boolean): TemplateResult {
        const value = view.counts?.[tile.count] ?? null;
        return html`<li>
            <a class="tile" href=${tile.href} ?data-attention=${attention && (value ?? 0) > 0}>
                <span class="value">${countText(locale, value, view.countsStatus === 'loading')}</span>
                <span>${shellText(locale, `adminShell.home.count.${tile.count}`)}</span>
            </a>
        </li>`;
    }

    #health(locale: UiLocale, view: HomeViewState): TemplateResult {
        const retry = (): void => {
            this.intents?.retry();
        };
        return html`<section aria-labelledby="services">
            <h2 id="services">${shellText(locale, 'adminShell.home.services')}</h2>
            ${reconnectingStatus(locale, view.health.reconnecting)}
            ${
                view.health.status === 'error'
                    ? errorTemplate(locale, null, retry)
                    : html`<ul class="chips">
                          ${view.health.chips.map((chip) => this.#chip(locale, chip))}
                      </ul>`
            }
            <p><a href="#/setup">${shellText(locale, 'adminShell.home.openSetup')}</a></p>
        </section>`;
    }

    #chip(locale: UiLocale, chip: HealthChipPort): TemplateResult {
        const area = shellText(locale, `adminShell.home.area.${chip.area}`);
        const state = shellText(locale, `adminShell.home.state.${chip.state}`);
        const detail = chip.detail === null ? '' : ` (${noticeOf(locale, chip.detail)})`;
        return html`<li class="tag" data-tone=${TONES[chip.state]}>
            <hcm-icon name=${ICONS[chip.state]}></hcm-icon>${area}: ${state}${detail}
        </li>`;
    }

    #publicMap(locale: UiLocale, view: HomeViewState): TemplateResult {
        const map = publicMapOf(view.publicMap);
        return html`<section aria-labelledby="public-map">
            <h2 id="public-map">${shellText(locale, 'adminShell.home.publicMap')}</h2>
            ${reconnectingStatus(locale, view.publicMap.reconnecting)}
            <p>${publicMapText(locale, map)}</p>
            ${skippedList(locale, map?.skipped ?? [])}
        </section>`;
    }
}

const PUBLIC_MAP: Readonly<
    Record<PublicMapPort['status'], 'adminShell.home.map.idle' | 'adminShell.home.map.updating' | 'adminShell.home.map.failed'>
> = {
    idle: 'adminShell.home.map.idle',
    queued: 'adminShell.home.map.updating',
    building: 'adminShell.home.map.updating',
    failed: 'adminShell.home.map.failed',
};

/**
 * What needs a person now: the counts above zero, and every count still being read or that could not be read (its
 * ellipsis or its dash), so a failure or the first open never reads as nothing to do.
 */
function needs(view: HomeViewState): readonly Tile[] {
    return NEEDS.filter((tile) => {
        const value = view.counts?.[tile.count] ?? null;
        return value === null || value > 0;
    });
}

/** The public map once read (null: never built), or undefined while reading. */
function publicMapOf(state: HomeViewState['publicMap']): PublicMapPort | null | undefined {
    if (state.status !== 'ready') {
        return undefined;
    }
    return state.doc === null ? null : state.doc.data;
}

/** A count as text: the number, a dash when it failed, an ellipsis while counting. */
function countText(locale: UiLocale, value: number | null, counting: boolean): string {
    if (value !== null) {
        return new Intl.NumberFormat(locale).format(value);
    }
    return shellText(locale, counting ? 'adminShell.home.counting' : 'adminShell.home.unknown');
}

/** Where each kind of document is edited. */
const EDITORS: Readonly<Record<SkippedDocumentPort['entity'], (id: string) => string>> = {
    photo: (id) => `#/photos/${id}`,
    poi: (id) => `#/pois/${id}`,
    layer: (id) => `#/layers/${id}`,
    poiCategory: (id) => `#/settings/categories/${id}`,
    story: (id) => `#/stories/${id}`,
};

/** The field a path names (`title.ro`, `links[0].url`: its first segment). */
function fieldOf(path: string): string {
    return path.split(/[.[]/)[0] ?? path;
}

function skippedItem(locale: UiLocale, item: SkippedDocumentPort): TemplateResult {
    const kind = contentText(locale, `adminContent.history.one.${item.entity}`);
    const issue = translate(locale, item.code);
    const problem = item.path === '' ? issue : `${fieldName(locale, fieldOf(item.path))}: ${issue}`;
    return html`<li data-skipped=${[item.entity, item.id].join('/')}>
        <a href=${EDITORS[item.entity](item.id)}>${kind} ${item.id}</a> · ${problem}
    </li>`;
}

/** The documents the last build left out of the public map, each with its first issue and its editor (nothing when none). */
function skippedList(locale: UiLocale, skipped: readonly SkippedDocumentPort[]): TemplateResult {
    if (skipped.length === 0) {
        return EMPTY;
    }
    return html`<p class="note">${shellText(locale, 'adminShell.home.skipped', { count: String(skipped.length) })}</p>
        <h3 id="not-on-map">${shellText(locale, 'adminShell.home.notOnMap')}</h3>
        <ul class="skipped" aria-labelledby="not-on-map">
            ${skipped.map((item) => skippedItem(locale, item))}
        </ul>`;
}

/** The public map's state in one sentence (undefined: still reading; null: never built). */
export function publicMapText(locale: UiLocale, map: PublicMapPort | null | undefined): string {
    if (map === undefined) {
        return contentText(locale, 'adminContent.common.loading');
    }
    if (map === null) {
        return shellText(locale, 'adminShell.home.map.never');
    }
    const date = map.builtAt === null ? '' : formatWhen(locale, map.builtAt);
    return shellText(locale, PUBLIC_MAP[map.status], { date, error: map.error === null ? '' : noticeOf(locale, map.error) });
}

export function defineHcmHomePage(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_HOME_PAGE_TAG) === undefined) {
        registry.define(HCM_HOME_PAGE_TAG, HcmHomePage);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-home-page': HcmHomePage;
    }
}
