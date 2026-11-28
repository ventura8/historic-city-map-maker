import { translate } from '@hcm/shared';

import type { DockView } from './dock-date-menu.js';
import { dateItems, frontOfYear, type DateItem, type DatesOpenDetail } from './timeline-dates.js';

function adjacentDate(view: DockView, year: number, step: number): DateItem | undefined {
    const items = dateItems(view.layers, year, view.locale);
    const front = frontOfYear(view.layers, year, view.front ?? null);
    const index = items.findIndex((item) => item.id === front);
    return items[(index + step + items.length) % items.length];
}

export function announceDate(
    event: CustomEvent<DatesOpenDetail>,
    view: DockView,
    open: DatesOpenDetail | null,
    pick: (event: CustomEvent<{ layerId: string }>) => void,
): void {
    const { step, year } = event.detail;
    if (step === undefined) {
        return;
    }
    const pill = event.currentTarget as HTMLElement & { said: string };
    if (step === 0) {
        pill.said = translate(view.locale, open === null ? 'timeline.datesClosed' : 'timeline.datesOpened', { year: String(year) });
        return;
    }
    const next = adjacentDate(view, year, step);
    if (next) {
        pick(new CustomEvent('hcm-date-pick', { detail: { layerId: next.id } }));
        pill.said = `${next.date}, ${next.label}`;
    }
}
