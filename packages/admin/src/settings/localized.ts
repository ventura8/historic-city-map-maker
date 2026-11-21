/**
 * Texts in both languages as the editors' fields change them (`docs/research/M2c-interfaces.md` §1.6, §8.2, §8.5):
 * Romanian is the source and stays as typed (an empty Romanian text is the schema's `validation.tooSmall` at its field),
 * English is optional and an empty English text removes it (the viewer falls back to Romanian). An optional text whose
 * both languages are empty is removed whole.
 */
import type { UiLocale } from '@hcm/shared';

export interface LocalizedText {
    readonly ro: string;
    readonly en?: string | undefined;
}

/** `current` with `locale`'s text set to `text`. */
export function withText(current: LocalizedText | undefined, locale: UiLocale, text: string): LocalizedText {
    const base = current ?? { ro: '' };
    if (locale === 'ro') {
        return base.en === undefined ? { ro: text } : { ro: text, en: base.en };
    }
    return text.trim() === '' ? { ro: base.ro } : { ro: base.ro, en: text };
}

/** The same for an optional text: removed (undefined) once both languages are empty. */
export function withOptionalText(current: LocalizedText | undefined, locale: UiLocale, text: string): LocalizedText | undefined {
    const next = withText(current, locale, text);
    return next.ro.trim() === '' && next.en === undefined ? undefined : next;
}

/** The text a field shows for `locale` ('' when absent). */
export function textOf(current: LocalizedText | undefined, locale: UiLocale): string {
    return (locale === 'ro' ? current?.ro : current?.en) ?? '';
}
