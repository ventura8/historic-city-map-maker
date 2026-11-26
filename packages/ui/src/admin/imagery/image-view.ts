/**
 * What the owner reads beside the picture they approve (`docs/research/M12-own-tiles.md`; behaviours A73, A74): how much of the city it
 * holds (the map shades the rest), whether the map shows its full detail or a small picture and why, **Actual pixels**, **See the image**
 * for a phone's card below the map, and what publishing costs in the owner's words.
 */
import { ENDED_VERSION_STATES, type AdminContentKey, type LayerVersionState, type UiLocale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { noticeOf, contentText } from '../shell/text.js';
import type { ImageryContext } from './context.js';
import type { AdminNoticeInputPort } from '../notice-port.js';
import type { VersionViewPort } from './imagery-port.js';
import { numberText } from './imagery-text.js';
import { when, withValue } from './when.js';

type Output = NonNullable<VersionViewPort['output']>;

/** Google Cloud Storage's standard class, per GB and month, in cents (`docs/research/M12-own-tiles.md` → *Cost*). */
const STORAGE_CENTS_PER_GB_MONTH = 2;
const MB = 1e6;
const GB = 1e9;

/** The picture's share of the city, once measured. */
function coverage(locale: UiLocale, output: Output): TemplateResult {
    return withValue(
        output.coveragePct,
        (percent) =>
            html`<p data-coverage>
                ${contentText(locale, 'adminContent.imagery.view.coverage', { percent: numberText(locale, percent) })}
            </p>`,
    );
}

const ENDED: ReadonlySet<LayerVersionState> = new Set(ENDED_VERSION_STATES);

/** Refusals Try again cannot change: the tiles are gone for good. */
const FINAL_REFUSALS: ReadonlySet<string> = new Set(['apiError.imagery.tilesGone']);

/**
 * Why only the small picture shows, honestly (`docs/LESSONS.md`): a rejected version's tiles were deleted; an ended one (published or
 * replaced before the app made its own tiles, failed, cancelled), or any in a city that publishes through Mapbox, gets none, as the tick's
 * sweep leaves it; only a waiting one gets them on their own, and if their job fails the Jobs page has its Retry.
 */
function smallKey(state: LayerVersionState, throughMapbox: boolean): AdminContentKey {
    if (state === 'rejected') {
        return 'adminContent.imagery.view.smallGone';
    }
    return ENDED.has(state) || throughMapbox ? 'adminContent.imagery.view.smallNone' : 'adminContent.imagery.view.small';
}

function failed(locale: UiLocale, notice: AdminNoticeInputPort, retry: () => void): TemplateResult {
    return html`<div class="alert" role="alert" data-image="failed">
            <hcm-icon name="error"></hcm-icon><span>${noticeOf(locale, notice)}</span>
        </div>
        ${when(
            !FINAL_REFUSALS.has(notice.key),
            () =>
                html`<hcm-button variant="tonal" icon="replay" @click=${retry}
                    >${contentText(locale, 'adminContent.common.retry')}</hcm-button
                >`,
        )}`;
}

/** Why the map shows less than the full detail, or that it is on its way. */
function imageState({ locale, view, intents }: ImageryContext, state: LayerVersionState): TemplateResult {
    const { image } = view;
    if (image.status === 'small' || image.status === 'loading') {
        const key = image.status === 'small' ? smallKey(state, view.settings.publishThroughMapbox) : 'adminContent.imagery.view.loading';
        return html`<p class="note" role="status" data-image=${image.status}>${contentText(locale, key)}</p>`;
    }
    return image.status === 'failed' ? failed(locale, image.notice, () => intents?.retryImage()) : html``;
}

/**
 * What the map can do with what it shows. Actual pixels brings the map into view too: the buttons sit below it, so on a page scrolled to
 * them the map zoomed out of sight and nothing seemed to happen (the rehearsal of 2026-11-07, docs/LESSONS.md).
 */
function controls({ locale, view, intents, showMap }: ImageryContext): TemplateResult {
    return html`<hcm-button variant="tonal" icon="map" @click=${showMap}
            >${contentText(locale, 'adminContent.imagery.view.seeImage')}</hcm-button
        >
        ${when(
            view.image.status === 'ready',
            () =>
                html`<hcm-button
                    variant="outlined"
                    icon="zoom_in"
                    @click=${() => {
                        showMap();
                        intents?.actualPixels();
                    }}
                    >${contentText(locale, 'adminContent.imagery.view.actualPixels')}</hcm-button
                >`,
        )}`;
}

export function imageView(context: ImageryContext, output: Output, state: LayerVersionState): TemplateResult {
    return html`<div class="image-view">${coverage(context.locale, output)} ${imageState(context, state)} ${controls(context)}</div>`;
}

/** The owner's cost, the version's own size; nothing is paid here and nothing is hidden. A version with no tiles yet says its size later. */
export function ownCost(locale: UiLocale, version: VersionViewPort): TemplateResult {
    return withValue(version.output?.tiles ?? null, ({ bytes }) => {
        const megabytes = numberText(locale, Math.max(1, Math.round(bytes / MB)), 0);
        const cents = numberText(locale, (bytes / GB) * STORAGE_CENTS_PER_GB_MONTH, 1);
        const words = [
            contentText(locale, 'adminContent.imagery.approval.ownSize', { megabytes }),
            contentText(locale, 'adminContent.imagery.approval.ownMapbox'),
            contentText(locale, 'adminContent.imagery.approval.ownStorage', { cents }),
            contentText(locale, 'adminContent.imagery.approval.ownTraffic'),
            contentText(locale, 'adminContent.imagery.approval.ownSite'),
        ];
        return html`<p class="note" data-own-cost>${words.join(' ')}</p>`;
    });
}
