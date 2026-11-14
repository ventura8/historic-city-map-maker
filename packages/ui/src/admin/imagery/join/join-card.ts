/**
 * The join's screens (M8, `docs/research/M8-join-interfaces.md` §6; behaviours A65, A66), a chunk fetched on first need
 * (`lazy-card.ts`): Find's whole-city dates, the offer to join a frame with its date's others, a join's frames (a frame
 * that needs points links to the georeferencer) and, on its approval card, what the join measured. The plan's figures are
 * estimates, worded "about"; the report's are measured. A join closes the gap between frames and does not improve their
 * absolute error, and the card says so.
 */
import {
    CITY_MIN_COVERAGE_PCT,
    MAX_TARGET_YEARS,
    SENSOR_SPECS,
    type DatePlanRow,
    type JoinReport,
    type JoinSeam,
    type LayerVersionState,
    type UiLocale,
} from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { EMPTY } from '../../shell/empty.js';
import { contentText, noticeOf } from '../../shell/text.js';
import { calibrationCard, calibrationWaits } from '../calibration-card.js';
import { paidFrameList } from '../orders/order-list.js';
import type { ImageryContext } from '../context.js';
import type { ImageryViewState, JobViewPort, SceneItemPort, VersionViewPort } from '../imagery-port.js';
import { dayText, numberText, versionStateText } from '../imagery-text.js';
import { when, withValue } from '../when.js';
import { defineOnce } from '../../../components/internal.js';
import { HCM_ARCHIVE_JOIN_TAG, HcmArchiveJoin } from './hcm-archive-join.js';
import { frameName, liveJoin, liveJoinOver } from './live-join.js';

async function joinFrames(context: ImageryContext, entityIds: readonly string[]): Promise<void> {
    const versionId = (await context.intents?.joinFrames(entityIds)) ?? null;
    if (versionId !== null) {
        context.go(['version', versionId]);
    }
}

/** Why the join of these frames was refused, beside its button. */
function refusal(context: ImageryContext, entityIds: readonly string[]): TemplateResult {
    const refused = context.view.joinRefusal;
    return withValue(
        refused?.id === entityIds[0] ? refused : null,
        ({ notice }) =>
            html`<p class="alert" role="alert" data-state="join-refused">
                <hcm-icon name="error"></hcm-icon><span>${noticeOf(context.locale, notice)}</span>
            </p>`,
    );
}

/** A row's chosen frames, by id. */
function idsOf(row: DatePlanRow): string[] {
    return row.frames.map((frame) => frame.entityId);
}

/** One click, and the page opens the join (`joinFrames` of `CONTENT_INPUT_BUDGETS`); Join frames unless told otherwise. */
function joinButton(
    context: ImageryContext,
    entityIds: readonly string[],
    label = contentText(context.locale, 'adminContent.imagery.join.button'),
    variant = 'filled',
): TemplateResult {
    return html`<div class="actions">
            <hcm-button
                variant=${variant}
                icon="layers"
                ?disabled=${context.view.joining !== null || context.readOnly}
                @click=${() => void joinFrames(context, entityIds)}
                >${label}</hcm-button
            >
        </div>
        ${refusal(context, entityIds)}`;
}

/** What must be ordered: how many, then every paid frame with its own Buy this scan. */
function paidFrames(context: ImageryContext, row: DatePlanRow): TemplateResult {
    const { locale } = context;
    const count = row.paidFrames.length;
    const key = count === 1 ? 'adminContent.imagery.join.paidFrameOne' : 'adminContent.imagery.join.paidFrame';
    return when(
        count > 0,
        () =>
            html`<span class="note" data-state="join-paid">${contentText(locale, key, { count: String(count) })}</span>
                ${paidFrameList(context, row.paidFrames, row.cloudyFrames)}`,
    );
}

/** What the row or the offer adds to its figures: what must be downloaded, that snow may need points, what must be ordered. */
function rowNotes(context: ImageryContext, row: DatePlanRow): TemplateResult {
    const { locale } = context;
    return html`${when(
        row.framesToDownload > 0,
        () =>
            html`<span class="note"
                >${contentText(locale, 'adminContent.imagery.join.toDownload', { count: String(row.framesToDownload) })}</span
            >`,
    )}
    ${when(row.winter, () => html`<span class="note" data-state="join-winter">${contentText(locale, 'adminContent.imagery.join.winter')}</span>`)}
    ${paidFrames(context, row)}`;
}

/**
 * A row's way forward: the live join over any of its frames, nothing with fewer than two frames or a join already published, else Join
 * frames. While a join is live this is no button: one click would reject a rendered join, or be refused (a frame is added on its page).
 */
function rowAction(context: ImageryContext, row: DatePlanRow): TemplateResult {
    const ids = idsOf(row);
    const live = liveJoinOver(context.view.versions.items, ids);
    if (live !== null) {
        return partLink(context, live);
    }
    const joined = row.frames.every((frame) => frame.state === 'joined');
    return when(row.frames.length > 1 && !joined, () => joinButton(context, ids));
}

/** Add {year}, while the year is not targeted and there is room: the search then ranks the date's frames with it. */
function addYear(context: ImageryContext, row: DatePlanRow): TemplateResult {
    const { view, intents, locale } = context;
    const year = Number(row.date.slice(0, 4));
    const { targetYears } = view.settings;
    const off = view.addingYear !== null || view.search.phase === 'searching' || context.readOnly;
    return when(
        !targetYears.includes(year) && targetYears.length < MAX_TARGET_YEARS,
        () =>
            html`<div class="actions">
                <hcm-button variant="text" icon="add" ?disabled=${off} @click=${() => void intents?.addTargetYear(year)}
                    >${contentText(locale, 'adminContent.imagery.join.addYear', { year: String(year) })}</hcm-button
                >
            </div>`,
    );
}

function dateRow(context: ImageryContext, row: DatePlanRow): TemplateResult {
    const { locale } = context;
    // The figure is the chosen frames': a paid frame would add to it, and the note says it must be ordered.
    const frames = row.frames.length;
    const coverage = frames === 1 ? 'adminContent.imagery.join.rowCoverageOne' : 'adminContent.imagery.join.rowCoverage';
    return html`<li class="card" data-date=${row.date} data-sensor=${row.sensor}>
        <span class="row-title">${SENSOR_SPECS[row.sensor].name} · ${dayText(locale, row.date)}</span>
        <span class="row-detail">
            ${contentText(locale, coverage, { frames: String(frames), percent: numberText(locale, row.coveragePct, 0) })}
        </span>
        ${rowNotes(context, row)} ${rowAction(context, row)} ${addYear(context, row)}
    </li>`;
}

/** Whole-city dates: the plan's rows, the best first (the server's order). */
export function dateRows(context: ImageryContext): TemplateResult {
    return html`<section class="section" aria-labelledby="jd" data-join-dates>
        <h3 id="jd">${contentText(context.locale, 'adminContent.imagery.join.datesTitle')}</h3>
        <ul class="rows">
            ${context.view.dates.map((row) => dateRow(context, row))}
        </ul>
    </section>`;
}

/** The date's row that joins this frame with at least one other. */
function rowWithFrame(view: ImageryViewState, entityId: string): DatePlanRow | undefined {
    return view.dates.find((row) => row.frames.length > 1 && row.frames.some((frame) => frame.entityId === entityId));
}

/** A frame as the offer reads it: its id and the share of the city it covers (0 to 1). */
interface OfferedFrame {
    readonly id: string;
    readonly coverage: number;
}

/** The row to offer: for a frame that leaves part of the city out and that no live join holds, when another frame of its date helps. */
function offeredRow(view: ImageryViewState, frame: OfferedFrame): DatePlanRow | undefined {
    const wanted = frame.coverage * 100 < CITY_MIN_COVERAGE_PCT && liveJoinOver(view.versions.items, [frame.id]) === null;
    return wanted ? rowWithFrame(view, frame.id) : undefined;
}

function offerCard(context: ImageryContext, row: DatePlanRow, frame: OfferedFrame): TemplateResult {
    const { locale } = context;
    const others = row.frames.filter((other) => other.entityId !== frame.id).map((other) => frameName(other.entityId));
    const text = contentText(locale, 'adminContent.imagery.join.offer', {
        percent: numberText(locale, frame.coverage * 100, 0),
        frames: others.join(', '),
        total: numberText(locale, row.coveragePct, 0),
    });
    return html`<section class="card" data-join-offer>
        <p>${text}</p>
        ${rowNotes(context, row)} ${joinButton(context, idsOf(row))}
    </section>`;
}

/** This frame covers about N % of the city; with its date's others, about M %. */
function offer(context: ImageryContext, frame: OfferedFrame): TemplateResult {
    return withValue(offeredRow(context.view, frame), (row) => offerCard(context, row, frame));
}

/** The scene's page: the offer beside Import (a scene is an offered frame: its id and its coverage). */
export function sceneOffer(context: ImageryContext, scene: SceneItemPort): TemplateResult {
    return offer(context, scene);
}

/** The scene's estimate (0 to 1), once the frame's own scene is read. */
function sceneEstimate(scene: SceneItemPort | null, entityId: string | null): number | null {
    return scene !== null && scene.id === entityId ? scene.coverage : null;
}

/** M9: what the render measured (0 to 1), else the scene's estimate; null while neither is known. */
function frameCoverage(context: ImageryContext, version: VersionViewPort): number | null {
    const measured = version.output?.coveragePct ?? null;
    return measured === null ? sceneEstimate(context.view.named.scene, version.entityId) : measured / 100;
}

/** The frame of a USGS version awaiting approval, with the share it covers (live F039's path). */
function offeredFrame(context: ImageryContext, version: VersionViewPort): OfferedFrame | null {
    const coverage = frameCoverage(context, version);
    const open = version.state === 'awaiting_approval' && version.entityId !== null && coverage !== null;
    return open ? { id: version.entityId, coverage } : null;
}

/** The version's page: the offer of a USGS frame awaiting approval. */
function versionOffer(context: ImageryContext, version: VersionViewPort): TemplateResult {
    return withValue(offeredFrame(context, version), (frame) => offer(context, frame));
}

/** A frame's page: the way to the join that holds it. */
function partLink(context: ImageryContext, joinId: string): TemplateResult {
    return html`<p data-state="join-holds">
        <a class="external" href=${context.href(['version', joinId])}>${contentText(context.locale, 'adminContent.imagery.origin.join')}</a>
    </p>`;
}

/** A frame's state as the page's lists know it: the unfinished list, else the plan (a frame that ended otherwise is in neither: none). */
function listedState(context: ImageryContext, part: VersionViewPort['parts'][number]): LayerVersionState | null {
    const { versions, dates } = context.view;
    const item = versions.items.find((candidate) => candidate.id === part.versionId);
    const planned = dates.flatMap((row) => row.frames).find((frame) => frame.versionId === part.versionId);
    return item?.state ?? planned?.state ?? null;
}

/** A frame's state as far as the page knows: `joined` once its join is published. */
function partState(context: ImageryContext, part: VersionViewPort['parts'][number], join: VersionViewPort): LayerVersionState | null {
    return join.state === 'published' ? 'joined' : listedState(context, part);
}

/** The georeferencer cures a frame that needs points, and two frames too far apart. */
function needsGeoref(state: LayerVersionState | null, job: JobViewPort | null): boolean {
    return state === 'needs_gcps' || job?.error?.notice.key === 'apiError.imagery.joinSeamTooFar';
}

function partRow(
    context: ImageryContext,
    part: VersionViewPort['parts'][number],
    join: VersionViewPort,
    job: JobViewPort | null,
): TemplateResult {
    const { locale } = context;
    const state = partState(context, part, join);
    const href = needsGeoref(state, job) ? `#/georef/${part.versionId}` : context.href(['version', part.versionId]);
    return html`<li data-part=${part.entityId} data-state=${state ?? ''}>
        <a class="row" href=${href}>
            <span class="row-title">${frameName(part.entityId)}</span>
            ${withValue(state, (known) => html`<span class="row-detail">${versionStateText(locale, known)}</span>`)}
        </a>
    </li>`;
}

/** A row's frames, the plan's choice first, then its spares. */
function framesOffered(row: DatePlanRow | undefined): readonly string[] {
    return row === undefined ? [] : [...idsOf(row), ...(row.spareFrames ?? [])];
}

/** The next frame of the date a short join does not hold: its request, or null. */
function nextFrame(
    context: ImageryContext,
    version: VersionViewPort,
): { readonly name: string; readonly entityIds: readonly string[] } | null {
    const row = context.view.dates.find((candidate) => candidate.date === version.date && candidate.sensor === version.sensor);
    const held = version.parts.map((part) => part.entityId);
    const next = framesOffered(row).find((entityId) => !held.includes(entityId));
    return next === undefined ? null : { name: frameName(next), entityIds: [...held, next] };
}

/** Add {frame} and join again: a rendered join that came out short, while its date has a frame it does not hold. */
function addFrame(context: ImageryContext, version: VersionViewPort): TemplateResult {
    const short = version.state === 'awaiting_approval' && (version.join?.coveragePct ?? 100) < CITY_MIN_COVERAGE_PCT;
    if (!short) {
        return EMPTY;
    }
    return withValue(nextFrame(context, version), ({ name, entityIds }) =>
        joinButton(context, entityIds, contentText(context.locale, 'adminContent.imagery.join.addFrame', { frame: name }), 'tonal'),
    );
}

/** A join's page: its frames, each with its state and link; while they are not ready, that it waits for them. */
function joinParts(context: ImageryContext, version: VersionViewPort, job: JobViewPort | null): TemplateResult {
    const { locale } = context;
    return html`<section class="section" aria-labelledby="jp" data-join-parts>
        <h3 id="jp">${contentText(locale, 'adminContent.imagery.origin.join')}</h3>
        ${when(job?.waitReason === 'parts', () => html`<p class="note" data-state="join-waiting">${contentText(locale, 'adminContent.imagery.join.waiting')}</p>`)}
        <ul class="rows">
            ${version.parts.map((part) => partRow(context, part, version, job))}
        </ul>
        ${addFrame(context, version)}
    </section>`;
}

/** A frame with a way to its join: one live, or the published join it is now part of. */
function joinOfFrame(context: ImageryContext, version: VersionViewPort): string | null {
    return version.state === 'joined' || liveJoin(context.view.versions.items, version.partOf) ? version.partOf : null;
}

/** A join's frames, or a frame's way to its join, or its offer to join its date's others. */
function joinOfVersion(context: ImageryContext, version: VersionViewPort, job: JobViewPort | null): TemplateResult {
    if (version.origin === 'join') {
        return joinParts(context, version, job);
    }
    const join = joinOfFrame(context, version);
    return join === null ? versionOffer(context, version) : partLink(context, join);
}

/** The version's page: how the frame was found (M9), then what it has to do with a join. */
export function versionJoin(context: ImageryContext, version: VersionViewPort, job: JobViewPort | null): TemplateResult {
    defineOnce(customElements, HCM_ARCHIVE_JOIN_TAG, HcmArchiveJoin);
    return html`${calibrationCard(context.locale, version)} ${joinOfVersion(context, version, job)}
        <hcm-archive-join
            .locale=${context.locale}
            .intents=${context.intents ?? null}
            .version=${version}
            .hrefOf=${context.href}
        ></hcm-archive-join>`;
}

/** A seam in words: what it measured before and after; a seam whose correction did not help moved nothing, and says so. */
function seamLine(locale: UiLocale, seam: JoinSeam): TemplateResult {
    const names = { a: frameName(seam.a), b: frameName(seam.b) };
    const before = seam.measured ? seam.beforeRmseM : undefined;
    if (before === undefined) {
        return html`<li data-seam="unmeasured">${contentText(locale, 'adminContent.imagery.join.seamUnmeasured', names)}</li>`;
    }
    const was = { ...names, before: numberText(locale, before) };
    if (!seam.applied) {
        return html`<li data-seam="not-applied">${contentText(locale, 'adminContent.imagery.join.seamRefused', was)}</li>`;
    }
    const figures = { ...was, after: numberText(locale, seam.afterRmseM ?? before) };
    return html`<li data-seam="applied">${contentText(locale, 'adminContent.imagery.join.seam', figures)}</li>`;
}

function reportOf(locale: UiLocale, join: JoinReport): TemplateResult {
    const omitted = join.omitted.map(frameName).join(', ');
    return html`<div class="choices" data-join-report>
        <p data-coverage>
            ${contentText(locale, 'adminContent.imagery.join.coverageMeasured', { percent: numberText(locale, join.coveragePct, 0) })}
        </p>
        ${
            join.seams.length === 0
                ? html`<p class="note" data-state="join-no-seams">${contentText(locale, 'adminContent.imagery.join.noSeams')}</p>`
                : html`<ul class="reasons">
                      ${join.seams.map((seam) => seamLine(locale, seam))}
                  </ul>`
        }
        ${withValue(
            join.checkpointRmseM,
            (metres) =>
                html`<p class="note">
                    ${contentText(locale, 'adminContent.imagery.join.absolute', { metres: numberText(locale, metres) })}
                </p>`,
        )}
        <p class="note">${contentText(locale, 'adminContent.imagery.join.maxShift', { metres: numberText(locale, join.maxShiftM) })}</p>
        ${when(omitted !== '', () => html`<p class="note" data-omitted>${contentText(locale, 'adminContent.imagery.join.omitted', { frames: omitted })}</p>`)}
    </div>`;
}

/**
 * The approval card: a rendered join's coverage, every seam, the worst frame's own error, the largest shift, the frames left out;
 * M9: why a frame under the threshold still waits.
 */
export function joinReport(context: ImageryContext, version: VersionViewPort): TemplateResult {
    return html`${calibrationWaits(context.locale, version)} ${withValue(version.join, (join) => reportOf(context.locale, join))}`;
}
