/**
 * The budget guard's banner (CR-M3-47; behaviour A43), on the Imagery and Jobs pages: while `ops/guard` is red it says
 * that processing is paused, with the month's cost and the budget the alert reported (in the billing account's
 * currency), that the public map keeps working, and offers **Resume processing** (the page asks first). Nothing while the
 * guard is green or still reading.
 */
import type { UiLocale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { EMPTY } from '../shell/empty.js';
import { contentText } from '../shell/text.js';
import type { GuardPort } from './guard-port.js';
import { numberText } from './imagery-text.js';

/** An amount in the admin's language, in its currency when the alert named one. */
export function moneyText(locale: UiLocale, amount: number, currency: string | null): string {
    if (currency === null) {
        return numberText(locale, amount, 2);
    }
    return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount);
}

function pausedText(locale: UiLocale, guard: GuardPort): string {
    const { costAmount, budgetAmount, currency } = guard;
    if (costAmount === null || budgetAmount === null) {
        return contentText(locale, 'adminContent.imagery.guard.pausedPlain');
    }
    const [cost, budget] = [moneyText(locale, costAmount, currency), moneyText(locale, budgetAmount, currency)];
    return contentText(locale, 'adminContent.imagery.guard.paused', { cost, budget });
}

export interface GuardBannerOptions {
    /** The resume is on its way, or the admin may not write. */
    readonly off: boolean;
    /** Asks first, then resumes. */
    readonly resume: () => void;
}

export function guardBanner(locale: UiLocale, guard: GuardPort | null, options: GuardBannerOptions): TemplateResult {
    if (guard?.paused !== true) {
        return EMPTY;
    }
    return html`<div class="alert" role="status" data-state="guard-paused">
        <hcm-icon name="pause"></hcm-icon>
        <div class="alert-body">
            <p>${pausedText(locale, guard)}</p>
            <div class="actions">
                <hcm-button variant="text" icon="play_arrow" ?disabled=${options.off} @click=${options.resume}
                    >${contentText(locale, 'adminContent.imagery.guard.resume')}</hcm-button
                >
            </div>
        </div>
    </div>`;
}
