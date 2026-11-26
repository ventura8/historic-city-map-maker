/**
 * What `locate` measured, on a version's page (`docs/research/M9-calibration.md` §8; behaviour A67), in the join's chunk
 * (`join/join-card.ts` renders it, the Imagery chunk being at its budget): how the frame was found, how many areas agree, the measured error
 * and how much of the city it covers; a frame nothing found asks for a few rough points; and, on the approval card, why a frame
 * under the threshold still waits.
 */
import {
    alignedWith,
    AUTO_MIN_MEASURED_PCT,
    CITY_MIN_COVERAGE_PCT,
    type AdminContentKey,
    type Calibration,
    type CalibrationHow,
    type UiLocale,
} from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { contentText } from '../shell/text.js';
import type { VersionViewPort } from './imagery-port.js';
import { numberText } from './imagery-text.js';
import { when, withValue } from './when.js';

/** How the frame was found, in words; any other proposal passes the same proof: to the admin it is found automatically too. */
function howKey(how: Exclude<CalibrationHow, 'none'>): AdminContentKey {
    return how === 'pass' || how === 'points'
        ? `adminContent.imagery.calibration.how.${how}`
        : 'adminContent.imagery.calibration.how.votes';
}

/** The heading: the local AI proposed this place (M10), on which device; `georef`'s matcher may have fitted it since, the proof stands. */
function howText(locale: UiLocale, { how, proposer }: Calibration & { readonly how: Exclude<CalibrationHow, 'none'> }): string {
    if (proposer === undefined || (how !== 'local-ai' && how !== 'matcher')) {
        return contentText(locale, howKey(how));
    }
    const device = proposer.deviceName ?? contentText(locale, 'adminContent.imagery.calibration.device.cpu');
    return contentText(locale, 'adminContent.imagery.calibration.how.localAi', { device });
}

/** Each figure the block has, in words: `georef`'s matcher, having fitted a frame, leaves it none of the proof's (`georef.py`). */
function facts(locale: UiLocale, { tiles, crossValidatedM, alignment }: Calibration, covered: number | undefined): readonly string[] {
    return [
        ...(tiles === undefined
            ? []
            : [
                  contentText(locale, 'adminContent.imagery.calibration.tiles', {
                      agreed: String(tiles.agreed),
                      tried: String(tiles.tried),
                  }),
              ]),
        ...(crossValidatedM === undefined
            ? []
            : [contentText(locale, 'adminContent.imagery.calibration.error', { metres: numberText(locale, crossValidatedM) })]),
        ...(covered === undefined
            ? []
            : [contentText(locale, 'adminContent.imagery.join.coverageMeasured', { percent: numberText(locale, covered, 0) })]),
        // M15: the photos it was lined up with, held still, and those whose streets sat off; too few shared points go unsaid.
        ...alignedWith(alignment).map(([line, params]) => contentText(locale, `adminContent.imagery.calibration.${line}`, params)),
    ];
}

/** The block of a version `locate` measured; nothing for one it never saw (an upload, a join, a re-rendered version). */
export function calibrationCard(locale: UiLocale, version: VersionViewPort): TemplateResult {
    return withValue(version.calibration, (calibration) => {
        const { how } = calibration;
        if (how === 'none') {
            // A frame nothing proved asks for points while it waits for them; once it has them, its figures are the fit's.
            return when(
                version.state === 'needs_gcps',
                () => html`<p class="note" data-calibration="none">${contentText(locale, 'adminContent.imagery.calibration.notFound')}</p>`,
            );
        }
        const covered = version.output?.coveragePct ?? calibration.coveredPct;
        return html`<section class="card" data-calibration=${how}>
            <h3 data-how>${howText(locale, { ...calibration, how })}</h3>
            ${facts(locale, calibration, covered).map((fact) => html`<p class="note">${fact}</p>`)}
        </section>`;
    });
}

/** A USGS frame that measured less of the city than the policy's bar: a figure it lacks says nothing here. */
function short(version: VersionViewPort): boolean {
    return version.entityId !== null && (version.output?.coveragePct ?? CITY_MIN_COVERAGE_PCT) < CITY_MIN_COVERAGE_PCT;
}

/** What keeps a frame's figure from speaking for it: only a proof that holds its fit records `measuredPct`, at the bar or not. */
const GAPS: readonly ((version: VersionViewPort) => boolean)[] = [
    ({ georef }) => georef?.checkpointKind === 'leave-one-out',
    ({ calibration }) => (calibration?.checksDropped ?? 0) > 0,
    ({ calibration }) => (calibration?.measuredPct ?? 0) < AUTO_MIN_MEASURED_PCT,
];

function waits(locale: UiLocale, name: string, key: AdminContentKey): TemplateResult {
    return html`<p class="note" data-waits=${name}>${contentText(locale, key)}</p>`;
}

/** On the approval card: why this frame waits for a click whatever its error (`functions/src/imagery/approval.ts`). */
export function calibrationWaits(locale: UiLocale, version: VersionViewPort): TemplateResult {
    return html`${when(version.entityId !== null && GAPS.some((gap) => gap(version)), () => waits(locale, 'not-proved', 'adminContent.imagery.calibration.waits.notProved'))}
    ${when(short(version), () => waits(locale, 'coverage', 'adminContent.imagery.calibration.waits.coverage'))}`;
}
