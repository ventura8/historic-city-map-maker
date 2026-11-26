/**
 * The Statistics view's small renderers (§203): counts and times as the reader's language writes them, the plain words
 * of a GA4 value (an app, a device, a key action, an error code), and the per-day line of an app as a tiny inline SVG.
 */
import { isApiErrorCode, type UiLocale } from '@hcm/shared';
import { html, svg, type TemplateResult } from 'lit';

import { contentText, noticeText } from '../shell/text.js';
import type { AdminNoticeKey } from '../admin-port.js';
import type { DayNumbersPort } from './crashes-port.js';

/** A whole number as the language writes it. */
export function formatCount(locale: UiLocale, count: number): string {
    return new Intl.NumberFormat(locale).format(Math.round(count));
}

/** An average time: seconds under two minutes, else minutes; a dash without one. */
export function formatDuration(locale: UiLocale, ms: number | null): string {
    if (ms === null) {
        return '—';
    }
    const seconds = ms / 1000;
    return seconds < 120
        ? contentText(locale, 'adminContent.statistics.numbers.seconds', { count: formatCount(locale, seconds) })
        : contentText(locale, 'adminContent.statistics.numbers.minutes', {
              count: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(seconds / 60),
          });
}

const SURFACES: ReadonlySet<string> = new Set(['viewer', 'admin', 'admin_owner', 'admin_editor', 'admin_moderator', 'admin_uploader']);

/** An `app_surface` value in words; anything else (GA4's `(not set)`) is the events from before the apps tagged themselves. */
export function surfaceName(locale: UiLocale, surface: string): string {
    const key = SURFACES.has(surface) ? surface : 'notSet';
    return contentText(locale, `adminContent.statistics.numbers.surface.${key as 'viewer'}`);
}

const DEVICES: ReadonlySet<string> = new Set(['desktop', 'mobile', 'tablet']);

export function deviceName(locale: UiLocale, device: string): string {
    return DEVICES.has(device) ? contentText(locale, `adminContent.statistics.numbers.device.${device as 'desktop'}`) : device;
}

const EVENTS: ReadonlySet<string> = new Set(['year_change', 'compass_reset', 'layer_toggle', 'photo_open', 'compare_open', 'share']);

export function eventName(locale: UiLocale, event: string): string {
    return EVENTS.has(event) ? contentText(locale, `adminContent.statistics.numbers.event.${event as 'share'}`) : event;
}

const CATALOGUE_PREFIXES = ['adminSetup.', 'adminContent.', 'adminShell.'];

/** A `step_error` code in plain words with the code after it; a code no catalogue knows stays a code. */
export function errorName(locale: UiLocale, code: string): string {
    const known = isApiErrorCode(code) || CATALOGUE_PREFIXES.some((prefix) => code.startsWith(prefix));
    if (!known) {
        return code;
    }
    try {
        const words = noticeText(locale, code as AdminNoticeKey).replace(/\{\w+\}/g, '…');
        return `${words} (${code})`;
    } catch {
        return code;
    }
}

const WIDTH = 120;
const HEIGHT = 32;

/** The days' visitors as a line (an image with its own words: the app and the highest day). */
export function dailyLine(label: string, days: readonly DayNumbersPort[]): TemplateResult {
    const max = Math.max(1, ...days.map((day) => day.visitors));
    const step = days.length > 1 ? WIDTH / (days.length - 1) : 0;
    const points = days
        .map((day, index) => `${String(index * step)},${String(HEIGHT - (day.visitors / max) * (HEIGHT - 2) - 1)}`)
        .join(' ');
    return html`<svg class="daily" viewBox="0 0 ${WIDTH} ${HEIGHT}" width=${WIDTH} height=${HEIGHT} role="img" aria-label=${label}>
        ${svg`<polyline points=${points} fill="none" stroke="currentColor" stroke-width="2"></polyline>`}
    </svg>`;
}
