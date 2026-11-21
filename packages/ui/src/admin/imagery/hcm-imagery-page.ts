/**
 * `<hcm-imagery-page>`: `#/imagery`, `#/imagery/scene/<entityId>` and `#/imagery/version/<versionId>`
 * (`docs/research/M3-interfaces.md` §10.2, §10.3; behaviours A11, A12, A14, A17, A42). The list pane has three views:
 * Find (the ranked scenes, their filters and the search), Work (the versions in progress and those waiting for the
 * admin) and Upload; the detail pane holds the page's one map (the footprints and the selected scene's browse image, or
 * a version's preview) above the open scene or version. While the budget guard pauses the raster work the list pane
 * says so, with the spend, and offers Resume processing (CR-M3-47). Reject, Dismiss, Pay, Cancel, Resume and Delete this version ask
 * first; a deleted version's page returns to the list.
 */
import type { UiLocale, PublishChoice } from '@hcm/shared';
import { html, type PropertyValues, type TemplateResult } from 'lit';

import { MAPBOX_GL_CSS_URL } from '../../map/mapbox-loader.js';
import type { AdminRouteIdPort } from '../admin-port.js';
import type { AreaPort, ContentPort } from '../content-port.js';
import { AreaPage } from '../editing/area-page.js';
import { cityRoleOfState } from '../shell/city-role.js';
import { EMPTY } from '../shell/empty.js';
import { contentText } from '../shell/text.js';
import { trackAreaFunnels } from '../editing/area-funnel.js';
import type { ImageryContext, ImageryQuestion } from './context.js';
import { guardBanner } from './guard-banner.js';
import type { ImageryIntentsPort, ImageryTabPort, ImageryViewState } from './imagery-port.js';
import { imageryStyles } from './imagery-styles.js';
import { numberText } from './imagery-text.js';
import { openOrderCount } from './orders/order-list.js';
import { orderStyles } from './orders/order-styles.js';
import { sceneDetail } from './scene-detail.js';
import { findView } from './scene-list.js';
import { chunkLoader, chunkTemplate } from './orders/lazy-card.js';
import { APPROVAL_MAP_CHUNK } from './lazy-version.js';
import { workView } from './work-list.js';
import { imageryFunnels } from './imagery-funnels.js';

export const HCM_IMAGERY_PAGE_TAG = 'hcm-imagery-page';

const HCM_ADMIN_MAP_SELECTOR = 'hcm-admin-map';

const TABS: readonly ImageryTabPort[] = ['find', 'work', 'upload'];

/** M28: a part of Imagery the map's sources turned off: why, and the way to Setup → Sources. */
function sourcesOff(context: ImageryContext, part: 'find' | 'archives'): TemplateResult {
    return html`<div class="pane sources-off" data-sources-off=${part}>
        <p>${contentText(context.locale, `adminContent.imagery.sourcesOff.${part}`)}</p>
        <p>${contentText(context.locale, `adminContent.imagery.sourcesOff.${part}Fix`)}</p>
        <a href="#/setup/sources">${contentText(context.locale, 'adminContent.imagery.sourcesOff.open')}</a>
    </div>`;
}

/** M28: Find, while the USGS frames or Landsat are among the sources. */
function findOrOff(context: ImageryContext): TemplateResult {
    const { sources } = context.view;
    return sources.usgs || sources.landsat ? findView(context) : sourcesOff(context, 'find');
}

/** The Upload view as a chunk of its own, fetched when its tab first opens (M8: room in the area's chunk for the join's plan). */
export const UPLOAD_PANEL_CHUNK = chunkLoader(async () => import('./upload-panel.js'));

const QUESTIONS = {
    reject: {
        headline: 'adminContent.imagery.confirm.reject',
        body: 'adminContent.imagery.confirm.rejectBody',
        confirm: 'adminContent.imagery.reject',
    },
    resume: {
        headline: 'adminContent.imagery.confirm.resume',
        body: 'adminContent.imagery.confirm.resumeBody',
        confirm: 'adminContent.imagery.guard.resume',
    },
    pay: {
        headline: 'adminContent.imagery.confirm.pay',
        body: 'adminContent.imagery.confirm.payBody',
        confirm: 'adminContent.imagery.confirm.payConfirm',
    },
    cancel: { headline: 'adminContent.jobs.cancelConfirm', body: 'adminContent.jobs.cancelBody', confirm: 'adminContent.jobs.cancel' },
    // M18 item 5: a frame waiting for its points is deleted with the same words as at every other stage, by `imagery.reject`
    // as well (its job is cancelled and the version reads Deleted, never Cancelled).
    drop: {
        headline: 'adminContent.imagery.confirm.reject',
        body: 'adminContent.imagery.confirm.dismissBody',
        confirm: 'adminContent.imagery.reject',
    },
    // M16: a recalibration not shown better replaces the current one only by the owner's choice.
    approveWorse: {
        headline: 'adminContent.imagery.confirm.approveWorse',
        body: 'adminContent.imagery.confirm.approveWorseBody',
        confirm: 'adminContent.imagery.confirm.approveWorseConfirm',
    },
    // The city guard: a version whose footprint lies mostly outside the city's bounds is approved only after this question.
    approveOutside: {
        headline: 'adminContent.imagery.confirm.approveOutside',
        body: 'adminContent.imagery.confirm.approveOutsideBody',
        confirm: 'adminContent.imagery.confirm.approveOutsideConfirm',
    },
    // The merge of M16 and M18: a recalibration of a published layer is deleted with the same Delete, but the question says what
    // goes (the new fit) and what stays (the published version), not "this image".
    rejectRecalibration: {
        headline: 'adminContent.imagery.confirm.rejectRecalibration',
        body: 'adminContent.imagery.confirm.rejectRecalibrationBody',
        confirm: 'adminContent.imagery.reject',
    },
    // A version that never reached the map goes for good: the question says what goes and that the originals on the owner's computer stay.
    deleteVersion: {
        headline: 'adminContent.imagery.confirm.deleteVersion',
        body: 'adminContent.imagery.confirm.deleteBody',
        confirm: 'adminContent.imagery.deleteVersion',
    },
} as const;

class HcmImageryPage extends AreaPage<ImageryViewState, ImageryIntentsPort> {
    static override readonly properties = { ...AreaPage.properties, question: { state: true }, mapCss: { attribute: false } };

    static override readonly styles = [...imageryStyles, orderStyles];

    protected readonly route: AdminRouteIdPort = 'imagery';
    /** The open question (Reject, Pay, Cancel), or null. */
    declare question: ImageryQuestion | null;
    /** mapbox-gl.css of the pinned release ('' in tests: no network). */
    declare mapCss: string;
    /** The upload whose version the page opened. */
    #opened: string | null = null;
    /** M20: the `archive` chunk's elements were asked for. */
    #archiveAsked = false;

    constructor() {
        super();
        this.question = null;
        this.mapCss = MAPBOX_GL_CSS_URL;
    }

    protected storeOf(content: ContentPort): AreaPort<ImageryViewState, ImageryIntentsPort> | null {
        return content.imagery;
    }

    protected override updated(changed: PropertyValues<this>): void {
        // The wizard's funnel (§200): what changed since the last render, as codes.
        trackAreaFunnels(this, this.view, imageryFunnels);
        super.updated(changed);
        this.#follow();
    }

    /** A finished upload opens its version; the Upload view or an archive's report first registers the `archive` chunk's elements. */
    #follow(): void {
        const view = this.view;
        if (view !== null) {
            this.#followUpload(view.upload);
            this.#askArchive(view);
        }
    }

    #askArchive(view: ImageryViewState): void {
        if (!this.#archiveAsked && showsArchive(view)) {
            this.#archiveAsked = true;
            void this.#archiveElements().catch(() => undefined);
        }
    }

    async #archiveElements(): Promise<void> {
        await this.intents?.archiveElements();
    }

    #followUpload(upload: ImageryViewState['upload']): void {
        const jobId = upload.phase === 'done' ? upload.jobId : null;
        if (jobId !== null && jobId !== this.#opened) {
            this.#opened = jobId;
            this.go(['version', jobId]);
        }
    }

    override render(): TemplateResult {
        const view = this.view;
        if (view === null) {
            return EMPTY;
        }
        const context = this.#context(view);
        const locale = this.locale;
        return html`<hcm-list-detail
                ?detail=${view.detail !== null}
                .detailKey=${view.detail === null ? '' : `${view.detail.kind}/${view.detail.id}`}
                .listLabel=${contentText(locale, 'adminContent.imagery.listLabel')}
                .detailLabel=${contentText(locale, 'adminContent.imagery.detailLabel')}
                .backLabel=${contentText(locale, 'adminContent.common.back')}
                .closeLabel=${contentText(locale, 'adminContent.common.close')}
                @hcm-back=${() => {
                    this.go([]);
                }}
            >
                <div slot="list">${this.#list(context)}</div>
                <div slot="detail">${this.#map(context)} ${this.#detail(context)}</div>
            </hcm-list-detail>
            ${this.#dialog(context)}`;
    }

    #context(view: ImageryViewState): ImageryContext {
        return {
            ...{ locale: this.locale, view, intents: this.intents, readOnly: this.readOnly, app: this.app },
            owner: cityRoleOfState(this.state) === 'owner',
            self: this.state?.user?.uid ?? '',
            href: (params) => this.href(params),
            go: (params) => {
                this.go(params);
            },
            ask: (question) => {
                this.question = question;
            },
            refresh: () => {
                this.requestUpdate();
            },
            focusDetail: () => {
                void this.updateComplete.then(() => this.renderRoot.querySelector<HTMLElement>('[data-detail-heading]')?.focus());
            },
            showMap: () => {
                this.renderRoot.querySelector(HCM_ADMIN_MAP_SELECTOR)?.scrollIntoView();
            },
        };
    }

    #list(context: ImageryContext): TemplateResult {
        const { locale, view, intents } = context;
        // Work's count is what Work lists, live: every unfinished version (an import running too) and every open order (finding 54).
        const work = view.versions.items.length + openOrderCount(view);
        const options = TABS.map((tab) => ({
            value: tab,
            label: contentText(locale, `adminContent.imagery.tab.${tab}`, { count: String(work) }),
        }));
        return html`<div class="list-head">
                <h2>${contentText(locale, 'adminContent.imagery.title')}</h2>
                <hcm-segmented-button
                    .options=${options}
                    .value=${view.tab}
                    .label=${contentText(locale, 'adminContent.imagery.tabsLabel')}
                    @hcm-change=${(event: Event) => intents?.setTab((event as CustomEvent<{ value: ImageryTabPort }>).detail.value)}
                ></hcm-segmented-button>
            </div>
            ${guardBanner(locale, view.guard, {
                off: view.resuming || context.readOnly,
                resume: () => {
                    context.ask('resume');
                },
            })}
            ${this.#tab(context)}`;
    }

    #tab(context: ImageryContext): TemplateResult {
        const { view, intents } = context;
        if (view.tab === 'find') {
            return findOrOff(context);
        }
        if (view.tab === 'work') {
            return workView(context);
        }
        const archive = !view.sources.archives
            ? sourcesOff(context, 'archives')
            : html`<hcm-archive-panel
                  class="pane"
                  .app=${context.app}
                  .locale=${context.locale}
                  @hcm-archive-arrived=${(event: Event) => {
                      context.go(['archive', (event as CustomEvent<{ id: string }>).detail.id]);
                  }}
              ></hcm-archive-panel>`;
        return html`${chunkTemplate(context, UPLOAD_PANEL_CHUNK, ({ uploadPanel }) =>
            uploadPanel(
                context.locale,
                { ...view.upload, layerId: view.upload.layerId ?? view.replaceLayer },
                {
                    ...{ choose: (file) => void intents?.chooseFile(file), setYear: (text) => intents?.setYear(text) },
                    ...{ start: () => intents?.startUpload(), cancel: () => intents?.cancelUpload(), reset: () => intents?.resetUpload() },
                    readOnly: context.readOnly,
                },
            ),
        )}
        ${archive}`;
    }

    /** The page's one map, always first in the detail pane so it stays the same element. */
    #map(context: ImageryContext): TemplateResult {
        const { intents } = context;
        return html`<hcm-admin-map
            class="imagery-map"
            .status=${context.view.map}
            .locale=${context.locale}
            .cssUrl=${this.mapCss}
            @hcm-map-host=${(event: Event) => {
                intents?.attachMap((event as CustomEvent<{ container: HTMLElement }>).detail.container);
            }}
            @hcm-zoom=${(event: Event) => {
                intents?.zoomBy((event as CustomEvent<{ delta: number }>).detail.delta);
            }}
        ></hcm-admin-map>`;
    }

    #detail(context: ImageryContext): TemplateResult {
        const { locale, view } = context;
        const detail = view.detail;
        if (detail === null) {
            return html`<hcm-empty-state
                icon="satellite_alt"
                .text=${contentText(locale, 'adminContent.imagery.choose')}
            ></hcm-empty-state>`;
        }
        if (detail.kind === 'scene') {
            return this.#scene(context, detail.id);
        }
        return detail.kind === 'archive' ? archiveReport(context, detail.id) : this.#version(context);
    }

    /**
     * M4: an ordered scene the filters hide (Free only) opens too, from Work's orders or a notification's link; any other scene they
     * hide, or past the list's page, from its own read (a shared or bookmarked address).
     */
    #scene(context: ImageryContext, id: string): TemplateResult {
        const view = context.view;
        const scenes = [...view.scenes.items, ...view.orders.items, ...(view.named.scene === null ? [] : [view.named.scene])];
        return sceneDetail(context, scenes.find((scene) => scene.id === id) ?? null);
    }

    #version(context: ImageryContext): TemplateResult {
        return chunkTemplate(context, APPROVAL_MAP_CHUNK, ({ versionDetail }) => versionDetail(context, context.view.version));
    }

    #dialog(context: ImageryContext): TemplateResult {
        const question = this.question;
        const texts = QUESTIONS[question ?? 'reject'];
        const { locale } = context;
        const usd = usdOf(context.view, locale);
        const actions = answers(context.intents, () => {
            context.go([]);
        });
        return html`<hcm-confirm-dialog
            ?destructive=${question !== 'pay' && question !== 'resume'}
            .open=${question !== null}
            .headline=${contentText(locale, texts.headline)}
            .body=${contentText(locale, texts.body, { usd })}
            .confirmLabel=${contentText(locale, texts.confirm, { usd })}
            .cancelLabel=${contentText(locale, 'adminContent.common.cancel')}
            .closeLabel=${contentText(locale, 'adminContent.common.close')}
            @hcm-confirm=${() => {
                this.question = null;
                if (question !== null) {
                    actions[question]();
                }
            }}
            @hcm-cancel=${() => {
                this.question = null;
            }}
        ></hcm-confirm-dialog>`;
    }
}

/** M20: an archive's report (`#/imagery/archive/<id>`), the `archive` chunk's element. */
function archiveReport(context: ImageryContext, archiveId: string): TemplateResult {
    return html`<hcm-archive-report
        .app=${context.app}
        .locale=${context.locale}
        archive=${archiveId}
        ?read-only=${context.readOnly}
    ></hcm-archive-report>`;
}

/** M20: the Upload view (Import local files) or an archive's report is on screen. */
function showsArchive(view: ImageryViewState): boolean {
    return view.tab === 'upload' || view.detail?.kind === 'archive';
}

/** The open version's overage cost in dollars, for the Pay question, as the Pay button writes it. */
function usdOf(view: ImageryViewState, locale: UiLocale): string {
    return numberText(locale, view.version?.version.doc?.data.guard?.overageUsd ?? 0, 2);
}

/** A deleted version's page has nothing left to show: back to the Historical imagery list. */
async function deleteAndLeave(intents: ImageryIntentsPort | null, leave: () => void): Promise<void> {
    if ((await intents?.deleteVersion()) === true) {
        leave();
    }
}

/** What each question does once confirmed (`leave`: back to the list). */
function answers(intents: ImageryIntentsPort | null, leave: () => void): Readonly<Record<ImageryQuestion, () => void>> {
    return {
        reject: () => void intents?.reject(),
        pay: () => void intents?.choose('pay' satisfies PublishChoice),
        cancel: () => void intents?.cancelJob(),
        drop: () => void intents?.reject(),
        rejectRecalibration: () => void intents?.reject(),
        resume: () => void intents?.resumeGuard(),
        approveWorse: () => void intents?.approve(true),
        approveOutside: () => void intents?.approve(),
        deleteVersion: () => void deleteAndLeave(intents, leave),
    };
}

/** Registers `<hcm-imagery-page>` (its kit elements are the editing kit's and the admin map's). */
export function defineHcmImageryPage(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_IMAGERY_PAGE_TAG) === undefined) {
        registry.define(HCM_IMAGERY_PAGE_TAG, HcmImageryPage);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-imagery-page': HcmImageryPage;
    }
}
