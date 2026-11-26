/**
 * What a conflict banner says first (`docs/research/M2c-interfaces.md` §5.1; S-A38-BAD-CONFLICT; `DECISIONS-for-review.md`
 * §42c): who saved the other version and when ("Saved by Ana on 17 Oct 2026, 14:02."), then the fields both changed by
 * their names in the admin's language. The name is the admin's Google name or address as `admins.list` gives it (the
 * shell asks once a conflict appears); until it is known, "another admin". Text only.
 */
import type { UiLocale } from '@hcm/shared';

import { contentText } from '../shell/text.js';
import { fieldNames } from './field-names.js';
import { formatWhen, whoText } from './states.js';

/** Who reads the page and the names the shell knows (`AreaPage.self`, `AreaPage.people`). */
export interface WhoPort {
    readonly self: string | null;
    readonly people: Readonly<Record<string, string>>;
}

export const NOBODY: WhoPort = { self: null, people: {} };

/** A draft's conflict as the banners read it. */
export interface ConflictPort {
    readonly by: string;
    readonly at: string;
    readonly fields: readonly string[];
}

/** "Saved by Ana on 17 Oct 2026, 14:02." ("Saved by Ana." when the version is no time). */
export function savedByText(locale: UiLocale, conflict: Pick<ConflictPort, 'by' | 'at'>, who: WhoPort): string {
    const name = whoText(locale, conflict.by, who.self, who.people);
    if (Number.isNaN(Date.parse(conflict.at))) {
        return contentText(locale, 'adminContent.common.savedByWho', { who: name });
    }
    return contentText(locale, 'adminContent.common.savedBy', { who: name, date: formatWhen(locale, conflict.at) });
}

/** The fields of a conflict, by their names ("Title, Year"). */
export function conflictFields(locale: UiLocale, conflict: Pick<ConflictPort, 'fields'>): string {
    return fieldNames(locale, conflict.fields);
}
