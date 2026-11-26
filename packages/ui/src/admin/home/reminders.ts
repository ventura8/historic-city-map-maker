/**
 * Home's reminders (M6 setup-ux, `docs/research/M6-interfaces.md` §4.1 and §3.1; findings 16, 18 and 24 of the live test
 * of 2026-10-25): what Setup left open, one tile each, first on the dashboard: USGS not set up yet (historical imagery
 * search is off) with Set up USGS; USGS's M2M approval awaited, since when, with its step; a likely free trial ending
 * soon, with the link to upgrade it in Google Cloud (a new tab) and "It is a paid account"; and (M6 installer) the
 * map's installation stopped or an update ready, with the Setup step that acts on it. Nothing when none. Text only.
 */
import type { UiLocale } from '@hcm/shared';
import { css, html, type TemplateResult } from 'lit';

import { EMPTY } from '../shell/empty.js';
import { formatDate, setupLabel } from '../setup/setup-text.js';
import type { HomeIntentsPort, HomeReminderPort, HomeViewState } from './home-port.js';

const USGS_STEP = '#/setup/usgs';

function usgsLater(locale: UiLocale): TemplateResult {
    return html`<li class="reminder" data-reminder="usgsLater">
        <hcm-icon name="satellite_alt"></hcm-icon>
        <p>${setupLabel(locale, 'adminSetup.reminder.usgsLater')}</p>
        <a class="action" href=${USGS_STEP}>${setupLabel(locale, 'adminSetup.reminder.setUpUsgs')}</a>
    </li>`;
}

function usgsPending(locale: UiLocale, since: string | null): TemplateResult {
    const date = since === null ? '…' : formatDate(locale, since);
    const step = setupLabel(locale, 'adminSetup.step.usgs');
    return html`<li class="reminder" data-reminder="usgsPending">
        <hcm-icon name="schedule"></hcm-icon>
        <p>${setupLabel(locale, 'adminSetup.reminder.usgsPending', { date })}</p>
        <a class="action" href=${USGS_STEP}>${setupLabel(locale, 'adminSetup.selfTest.fix', { step })}</a>
    </li>`;
}

type TrialReminder = Extract<HomeReminderPort, { kind: 'trial' }>;

function trial(locale: UiLocale, reminder: TrialReminder, view: HomeViewState, intents: HomeIntentsPort | null): TemplateResult {
    const paid = (): void => {
        void intents?.dismissTrial();
    };
    return html`<li class="reminder" data-reminder="trial">
        <hcm-icon name="credit_card"></hcm-icon>
        <p>${setupLabel(locale, 'adminSetup.reminder.trial', { date: formatDate(locale, reminder.endsAt) })}</p>
        <div class="actions">
            <a class="action" href=${reminder.upgradeUrl} target="_blank" rel="noopener noreferrer"
                >${setupLabel(locale, 'adminSetup.reminder.upgrade')}<hcm-icon name="open_in_new"></hcm-icon
                ><span class="visually-hidden">${setupLabel(locale, 'adminSetup.newTab')}</span></a
            >
            <hcm-button variant="text" ?disabled=${view.dismissing} @click=${paid}
                >${setupLabel(locale, 'adminSetup.reminder.paid')}</hcm-button
            >
        </div>
    </li>`;
}

type InstallReminder = Extract<HomeReminderPort, { kind: 'installUpdate' | 'installFailed' }>;

// [section install] owner: installer (M6, `home.update-tile`)
function installTile(locale: UiLocale, reminder: InstallReminder): TemplateResult {
    const failed = reminder.kind === 'installFailed';
    return html`<li class="reminder" data-reminder=${reminder.kind}>
        <hcm-icon name=${failed ? 'error' : 'publish'}></hcm-icon>
        <p>${setupLabel(locale, failed ? 'adminSetup.install.tileFailed' : 'adminSetup.install.tileUpdate')}</p>
        <a class="action" href=${`#/setup/${reminder.step}`}>${setupLabel(locale, 'adminSetup.install.tileOpen')}</a>
    </li>`;
}
// [end install]

function isInstall(reminder: HomeReminderPort): reminder is InstallReminder {
    return reminder.kind === 'installUpdate' || reminder.kind === 'installFailed';
}

function reminderTile(locale: UiLocale, reminder: HomeReminderPort, view: HomeViewState, intents: HomeIntentsPort | null): TemplateResult {
    if (isInstall(reminder)) {
        return installTile(locale, reminder);
    }
    if (reminder.kind === 'usgsLater') {
        return usgsLater(locale);
    }
    return reminder.kind === 'usgsPending' ? usgsPending(locale, reminder.since) : trial(locale, reminder, view, intents);
}

/** The reminders section, or nothing when Setup left nothing open. */
export function remindersSection(locale: UiLocale, view: HomeViewState, intents: HomeIntentsPort | null): TemplateResult {
    if (view.reminders.length === 0) {
        return EMPTY;
    }
    return html`<section aria-labelledby="reminders">
        <h2 id="reminders">${setupLabel(locale, 'adminSetup.reminder.title')}</h2>
        <ul class="reminders">
            ${view.reminders.map((reminder) => reminderTile(locale, reminder, view, intents))}
        </ul>
    </section>`;
}

/** A reminder is a tonal tile: its icon, the sentence, then its actions (each a 48 px target). */
export const reminderStyles = css`
    ul.reminders {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin: 0;
        padding: 0;
        list-style: none;
    }

    .reminder {
        display: grid;
        grid-template-columns: 24px minmax(0, 1fr);
        gap: 4px 12px;
        align-items: start;
        padding: 16px;
        border-radius: var(--md-sys-shape-corner-large, 16px);
        background: var(--md-sys-color-secondary-container, Canvas);
        color: var(--md-sys-color-on-secondary-container, CanvasText);
    }

    .reminder > :not(hcm-icon) {
        grid-column: 2;
    }

    .reminder .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
    }

    .reminder a.action {
        display: inline-flex;
        gap: 4px;
        align-items: center;
        min-block-size: 48px;
        color: var(--md-sys-color-on-secondary-container, LinkText);
        font-weight: var(--md-sys-typescale-label-large-weight, 500);

        --hcm-icon-size: 18px;
    }
`;
