/**
 * M16 (`docs/research/M16-recalibrate.md` §7; S-A89-*): what a version's page says of calibrating it again. On a published
 * version or one waiting for approval: **Refine automatically** (a new version from the same scan, which the page then opens) and **Place
 * rough points** (the georeferencer, where Snap my points sends them). On a recalibration: the current fit and the new one on the same checks,
 * or that they were not compared, the pairs found around the admin's points, and **Show the current one**, which swaps the page's one map
 * between the two at full detail.
 */
import { recalibrationVerdict, type Recalibration } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { contentText } from '../../shell/text.js';
import type { ImageryContext } from '../context.js';
import type { VersionPagePort, VersionViewPort } from '../imagery-port.js';
import { numberText } from '../imagery-text.js';
import { when } from '../when.js';

function figures(context: ImageryContext, recalibration: Recalibration): TemplateResult {
    const { locale } = context;
    const { before, after } = recalibration;
    if (before === undefined || after === undefined) {
        return html`<p class="note" data-verdict="unmeasured">${contentText(locale, 'adminContent.imagery.recalibrate.unmeasured')}</p>`;
    }
    const verdict = recalibrationVerdict(recalibration);
    const params = { before: numberText(locale, before.rmseM, 1), after: numberText(locale, after.rmseM, 1), checks: String(after.checks) };
    return html`<p data-verdict=${verdict}>${contentText(locale, 'adminContent.imagery.recalibrate.figures', params)}</p>
        ${when(verdict === 'worse', () => worse(context))}`;
}

function worse(context: ImageryContext): TemplateResult {
    return html`<p class="note">${contentText(context.locale, 'adminContent.imagery.recalibrate.worse')}</p>`;
}

function proposed(context: ImageryContext, recalibration: Recalibration): TemplateResult {
    const count = recalibration.proposed;
    return when(
        count !== undefined,
        () =>
            html`<p class="note">${contentText(context.locale, 'adminContent.imagery.recalibrate.proposed', { count: String(count) })}</p>`,
    );
}

/** The map between the new version and the current one, once the current one is read. */
function swap(context: ImageryContext, page: VersionPagePort): TemplateResult {
    const label = page.showing === 'new' ? 'adminContent.imagery.recalibrate.showCurrent' : 'adminContent.imagery.recalibrate.showNew';
    return when(
        (page.current?.output ?? null) !== null,
        () =>
            html`<hcm-button variant="outlined" icon="compare" data-showing=${page.showing} @click=${() => context.intents?.toggleCurrent()}
                >${contentText(context.locale, label)}</hcm-button
            >`,
    );
}

function report(context: ImageryContext, page: VersionPagePort, recalibration: Recalibration): TemplateResult {
    return html`<section class="recalibrate" data-route=${recalibration.route}>
        <h3>${contentText(context.locale, 'adminContent.imagery.recalibrate.title')}</h3>
        ${figures(context, recalibration)} ${proposed(context, recalibration)}
        <div class="actions">${swap(context, page)}</div>
    </section>`;
}

async function refine(context: ImageryContext): Promise<void> {
    const id = (await context.intents?.recalibrate()) ?? null;
    if (id !== null) {
        context.go(['version', id]);
    }
}

function offer(context: ImageryContext, page: VersionPagePort, version: VersionViewPort): TemplateResult {
    const { locale } = context;
    const off = page.acting !== null || context.readOnly;
    return html`<section class="recalibrate">
        <h3>${contentText(locale, 'adminContent.imagery.recalibrate.title')}</h3>
        <p class="note">${contentText(locale, 'adminContent.imagery.recalibrate.hint')}</p>
        <div class="actions">
            <hcm-button variant="tonal" icon="tune" ?disabled=${off} @click=${() => void refine(context)}
                >${contentText(locale, 'adminContent.imagery.recalibrate.refine')}</hcm-button
            >
            <a class="external" href=${['#/georef', version.id].join('/')}
                >${contentText(locale, 'adminContent.imagery.recalibrate.points')}</a
            >
        </div>
    </section>`;
}

/** `offered`: the version may be calibrated again (`lazy-recalibrate.ts`). */
export function recalibrateCard(
    context: ImageryContext,
    page: VersionPagePort,
    version: VersionViewPort,
    offered: boolean,
): TemplateResult {
    const { recalibration } = version;
    const shown = recalibration === null ? html`` : report(context, page, recalibration);
    return html`${shown} ${when(offered, () => offer(context, page, version))}`;
}
