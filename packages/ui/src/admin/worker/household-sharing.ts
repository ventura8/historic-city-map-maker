/**
 * What one computer shares in `<hcm-worker-household>` (M20 §22, the owner's request of 2026-11-14: "other household computers work
 * on the imported scanned maps"): the computer that holds them sends a series' sheets to the others through the project's bucket,
 * also while it works on a map. While a copy goes: "Sharing scanned maps with 2 computers" and how far, as a progress bar and in
 * words; once today's limit is reached: what happened, why (the cloud bill) and what goes on meanwhile.
 */
import { ARCHIVE_SHARE_DAY_BYTES, pluralOf, type UiLocale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import type { PartContext } from './household-parts.js';
import type { ComputerViewPort } from './worker-port.js';

const MB = 1024 ** 2;
const GB = 1024 ** 3;

/** Bytes in whole megabytes, in the admin's language. */
function megabytes(locale: UiLocale, bytes: number): string {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.round(bytes / MB));
}

/** The copy under way: for how many computers, and how far (a bar once its size is known). */
function sendingWords({ t, locale }: PartContext, sharing: NonNullable<ComputerViewPort['sharing']>): TemplateResult {
    const count = sharing.computers;
    const who = t(`adminWorkerHousehold.sharing.${pluralOf(locale, count)}`, { count: String(count) });
    if (sharing.totalBytes === 0) {
        return html`<p class="note" role="status" data-sharing="sending">${who} ${t('adminWorkerHousehold.sharingStarts')}</p>`;
    }
    const sent = megabytes(locale, sharing.sentBytes);
    const total = megabytes(locale, sharing.totalBytes);
    return html`<p class="note" role="status" data-sharing="sending">
        ${who} ${t('adminWorkerHousehold.sharingProgress', { sent, total })}
        <progress max=${sharing.totalBytes} value=${sharing.sentBytes} aria-label=${t('adminWorkerHousehold.sharingBar')}></progress>
    </p>`;
}

/** What the computer shares now; nothing when it shares nothing. */
export function sharingPart(context: PartContext, computer: ComputerViewPort): TemplateResult {
    const sharing = computer.sharing;
    if (sharing === null) {
        return html``;
    }
    if (sharing.state === 'sending') {
        return sendingWords(context, sharing);
    }
    const limit = new Intl.NumberFormat(context.locale).format(ARCHIVE_SHARE_DAY_BYTES / GB);
    return html`<p class="note" role="status" data-sharing="dayLimit">
        ${context.t('adminWorkerHousehold.sharingDayLimit', { limit })} ${context.t('adminWorkerHousehold.sharingDayLimit2')}
        ${context.t('adminWorkerHousehold.sharingDayLimit3')}
    </p>`;
}
