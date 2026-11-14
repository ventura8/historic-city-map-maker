/**
 * The approval card of a rendered version (`docs/research/M3-interfaces.md` §7, §10.2; behaviours A17, A42, A73): the checkpoint error
 * against the city's threshold in words, the pairs it comes from, what publishing costs, then **Approve** (or Reject, asked first). M12
 * (`docs/research/M12-own-tiles.md`): by default a layer's tiles go to the city's own public bucket, and the card says what that costs in
 * the owner's words (`image-view.ts`): no compute units, Studio steps or choices. A city that publishes through Mapbox sees those from
 * the `mapbox-choices` chunk. M8: a join's section says what it measured (`join/join-card.ts`), and M9 there too: why a frame under the
 * threshold still waits. Batch 4 (`docs/research/M20-import-local.md` §5.1): a grid series placed from its sheets' names without a proof
 * shows its seams and its checks against OpenStreetMap, and only the city's owner sees **Approve the sheet-name placement**.
 * M25: a Landsat scene has no checkpoint error; the card says its shift from Sentinel-2 and the city's cloud.
 */
import { landsatClear, recalibrationVerdict, type LandsatReport, type UiLocale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { EMPTY } from '../shell/empty.js';
import { contentText } from '../shell/text.js';
import type { ImageryContext } from './context.js';
import type { VersionPagePort, VersionViewPort } from './imagery-port.js';
import { ownCost } from './image-view.js';
import { numberText } from './imagery-text.js';
import { lazyJoin } from './join/lazy-card.js';
import { lazyMapboxChoices } from './lazy-approval.js';
import type { Guard } from './mapbox-choices.js';
import { withValue } from './when.js';

/** True when the version has no rights gate, or its rights already allow a publish. */
function rightsReady(version: VersionViewPort): boolean {
    return !version.rights || version.rights.allowPublish;
}

/** The page is busy with another action, or nothing may be written. */
function busy(context: ImageryContext, page: VersionPagePort): boolean {
    return page.acting !== null || context.readOnly;
}

function measured(context: ImageryContext, rmse: number): TemplateResult {
    const { locale, view } = context;
    const over = rmse > view.settings.rmseThresholdM;
    const key = over ? 'adminContent.imagery.approval.rmseOver' : 'adminContent.imagery.approval.rmseUnder';
    const text = contentText(locale, key, { rmse: numberText(locale, rmse), threshold: numberText(locale, view.settings.rmseThresholdM) });
    return over ? html`<p class="alert" data-rmse="over">${text}</p>` : html`<p data-rmse="under">${text}</p>`;
}

/** The checkpoint error. M8: a join has no georeference of its own; its figure is its worst frame's; M20: a series' blocked figure. */
function checkpointOf(version: VersionViewPort): number | null {
    const figures = [version.georef, version.join, version.archive].map((each) => each?.checkpointRmseM);
    return figures.find((figure) => typeof figure === 'number') ?? null;
}

/** Batch 4: a grid series placed from its sheets' names, whose grid did not prove on the reference. */
function byNames(version: VersionViewPort): boolean {
    return version.archive?.method === 'grid-names';
}

/** What the placement from the names measured: its seams and its checks against OpenStreetMap. */
function namesReport(context: ImageryContext, version: VersionViewPort): TemplateResult {
    const { locale } = context;
    const report = version.archive;
    if (report?.method !== 'grid-names') {
        return EMPTY;
    }
    const seam = report.seamScore === undefined ? '–' : numberText(locale, report.seamScore, 2);
    return html`<p class="note" data-state="grid-names">
        ${contentText(locale, 'adminContent.imagery.approval.gridNames', { seam, checks: String(report.checkpointCount) })}
    </p>`;
}

const CORRECTION_KEYS = {
    applied: 'adminContent.imagery.landsat.moved',
    implausible: 'adminContent.imagery.landsat.implausible',
    unconfirmed: 'adminContent.imagery.landsat.unconfirmed',
} as const;

/** Lesson 727: what was done about a systematic scene's shift (moved onto Sentinel-2, or why not); nothing for any other scene. */
function correctionText(locale: UiLocale, report: LandsatReport): TemplateResult {
    return withValue(report.correction, (correction) => {
        const kind = correction.state === 'applied' ? 'applied' : (correction.reason ?? 'unconfirmed');
        const metres = numberText(locale, Math.round(Math.hypot(correction.eastM, correction.northM)));
        const hint = kind === 'applied' ? '' : ` ${contentText(locale, 'adminContent.imagery.landsat.rejectHint')}`;
        return html`<p class="note" data-correction=${kind}>${contentText(locale, CORRECTION_KEYS[kind], { metres })}${hint}</p>`;
    });
}

/** M25: a Landsat scene's shift from Sentinel-2 and the city's cloud, and why it waits when it is not clear. */
function landsatText(locale: UiLocale, report: LandsatReport): TemplateResult {
    const offset =
        report.offsetPx === undefined || report.offsetM === undefined
            ? contentText(locale, 'adminContent.imagery.landsat.unchecked')
            : contentText(locale, 'adminContent.imagery.landsat.offset', {
                  pixels: numberText(locale, report.offsetPx),
                  metres: numberText(locale, report.offsetM),
              });
    const clear = landsatClear(report);
    const cloud = contentText(locale, 'adminContent.imagery.landsat.cloud', { percent: numberText(locale, report.cityCloudPct) });
    const held = clear ? '' : html`<p class="alert">${contentText(locale, 'adminContent.imagery.landsat.held')}</p>`;
    return html`<p data-landsat=${clear ? 'clear' : 'held'}>${offset}</p>
        ${correctionText(locale, report)}
        <p class="note">${cloud}</p>
        ${held}`;
}

function rmseText(context: ImageryContext, version: VersionViewPort): TemplateResult {
    if (version.landsat !== null) {
        return landsatText(context.locale, version.landsat);
    }
    const rmse = checkpointOf(version);
    return rmse === null
        ? html`<p class="note" data-rmse="unmeasured">${contentText(context.locale, 'adminContent.imagery.approval.unmeasured')}</p>`
        : measured(context, rmse);
}

function pairsText(locale: UiLocale, version: VersionViewPort): TemplateResult {
    return withValue(
        version.georef,
        (georef) =>
            html`<p class="note">
                ${contentText(locale, 'adminContent.imagery.approval.pairs', {
                    pairs: String(georef.pairs),
                    checks: String(georef.checkpointCount ?? 0),
                })}
            </p>`,
    );
}

/**
 * Delete this image? (`imagery.reject`): waiting for approval, and (M18 item 5) approved but stopped at the guard. A recalibration of a
 * published version (M16) asks about the new fit: the published one stays. One of a waiting version asks as any image does, since that
 * version was cancelled once the new one was rendered.
 */
function deleteButton(context: ImageryContext, page: VersionPagePort, version: VersionViewPort): TemplateResult {
    const question = version.recalibration !== null && page.current?.state === 'published' ? 'rejectRecalibration' : 'reject';
    return html`<hcm-button
        variant="outlined"
        icon="close"
        ?disabled=${busy(context, page)}
        @click=${() => {
            context.ask(question);
        }}
        >${contentText(context.locale, 'adminContent.imagery.reject')}</hcm-button
    >`;
}

/** M16 (`docs/research/M16-recalibrate.md` §4): a recalibration not shown better replaces the current one only by the owner's choice. */
function approve(context: ImageryContext, version: VersionViewPort): void {
    const { recalibration } = version;
    if (recalibration !== null && recalibrationVerdict(recalibration) !== 'better') {
        context.ask('approveWorse');
        return;
    }
    void context.intents?.approve();
}

/** Approve, or for a placement from sheet names the owner's own Approve; an editor is told the owner decides. */
function approveButton(context: ImageryContext, page: VersionPagePort, version: VersionViewPort): TemplateResult {
    const { locale } = context;
    const names = byNames(version);
    if (names && context.owner !== true) {
        return html`<p class="note" data-state="grid-names-owner">
            ${contentText(locale, 'adminContent.imagery.approval.gridNamesOwner')}
        </p>`;
    }
    return html`<hcm-button
        variant="filled"
        icon="approval"
        ?disabled=${busy(context, page) || !rightsReady(version)}
        @click=${() => {
            approve(context, version);
        }}
        >${contentText(locale, names ? 'adminContent.imagery.approval.gridNamesApprove' : 'adminContent.imagery.approve')}</hcm-button
    >`;
}

type RightsSummary = NonNullable<VersionViewPort['rights']>;

function rightsNote(rights: RightsSummary): TemplateResult {
    return rights.note === null ? EMPTY : html`<p class="note" data-rights-note>${rights.note}</p>`;
}

/** The owner's Confirm form once rights wait. */
function rightsForm(context: ImageryContext, page: VersionPagePort, version: VersionViewPort, note: TemplateResult): TemplateResult {
    const { locale } = context;
    const fieldId = `rights-by-${version.id}`;
    const confirm = (event: Event): void => {
        const root = (event.currentTarget as HTMLElement).getRootNode() as ParentNode;
        const input = root.querySelector<HTMLInputElement>(`#${fieldId}`);
        void context.intents?.confirmRights(input?.value ?? '');
    };
    return html`${note}
        <p class="alert" data-rights="needs-confirmation">${contentText(locale, 'adminContent.imagery.rights.needsConfirmation')}</p>
        <div class="field">
            <label for=${fieldId}>${contentText(locale, 'adminContent.imagery.rights.by')}</label>
            <input id=${fieldId} ?readonly=${busy(context, page)} />
        </div>
        <div class="actions">
            <hcm-button variant="tonal" icon="check" data-confirm-rights ?disabled=${busy(context, page)} @click=${confirm}
                >${contentText(locale, 'adminContent.imagery.rights.confirm')}</hcm-button
            >
        </div>`;
}

/** M20 (§7): Confirm who granted the permission; only the city's owner, while rights wait. */
function rightsBlock(context: ImageryContext, page: VersionPagePort, version: VersionViewPort): TemplateResult {
    const rights = version.rights;
    if (rights?.state !== 'needs-confirmation') {
        return EMPTY;
    }
    const note = rightsNote(rights);
    return context.owner === true
        ? rightsForm(context, page, version, note)
        : html`${note}
              <p class="note" data-rights="owner">${contentText(context.locale, 'adminContent.imagery.rights.ownerOnly')}</p>`;
}

function decision(context: ImageryContext, page: VersionPagePort, version: VersionViewPort): TemplateResult {
    return html`${rightsBlock(context, page, version)}
        <div class="actions">${approveButton(context, page, version)} ${deleteButton(context, page, version)}</div>`;
}

/** The guard's verdict when it stopped the publish (null: within, or not checked yet). */
function stopped(version: VersionViewPort): Guard | null {
    const guard = version.guard;
    return guard === null || guard.verdict === 'within' ? null : guard;
}

/**
 * M12: this version publishes from the city's own bucket: the city's choice, or a version with no COG for Mapbox to take (as
 * `functions/src/imagery/publish-own.ts` decides). Its old guard means nothing then: the sweep clears it.
 */
function publishesOwn(context: ImageryContext, version: VersionViewPort): boolean {
    return !context.view.settings.publishThroughMapbox || version.output?.cogBytes === 0;
}

/** The guard's stop, for a version that goes through Mapbox (null: none). */
export function guardStop(context: ImageryContext, version: VersionViewPort): Guard | null {
    return publishesOwn(context, version) ? null : stopped(version);
}

function costText(context: ImageryContext, page: VersionPagePort, version: VersionViewPort): TemplateResult {
    return publishesOwn(context, version)
        ? ownCost(context.locale, version)
        : lazyMapboxChoices(context, (chunk) => chunk.costText(context, page, version));
}

export function approvalCard(context: ImageryContext, page: VersionPagePort, version: VersionViewPort): TemplateResult {
    const guard = guardStop(context, version);
    return html`<section class="card" aria-labelledby="approval-title" data-state=${guard === null ? 'approval' : 'guard'}>
        <h3 id="approval-title">${contentText(context.locale, 'adminContent.imagery.approval.title')}</h3>
        ${lazyJoin(context, version, (chunk) => chunk.joinReport(context, version))} ${namesReport(context, version)}
        ${rmseText(context, version)} ${pairsText(context.locale, version)} ${costText(context, page, version)}
        ${
            guard === null
                ? decision(context, page, version)
                : html`${lazyMapboxChoices(context, (chunk) => chunk.guarded(context, page, guard, version))}
                      <div class="actions">${deleteButton(context, page, version)}</div>`
        }
    </section>`;
}
