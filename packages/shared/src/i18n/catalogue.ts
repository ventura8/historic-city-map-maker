import { fillPlaceholders, uiText } from './registry.js';
import type { UiLocale } from './locales.js';

/** Translates one key of a catalogue family, filling `{name}` placeholders (unknown ones stay visible). */
export type Translator<Key extends string> = (locale: UiLocale, key: Key, params?: Readonly<Record<string, string>>) => string;

/** The bundled catalogues of a family: Romanian, the source, and English, the fallback, every key of the family in each. */
interface Catalogues<Key extends string> {
    readonly ro: Readonly<Record<Key, string>>;
    readonly en: Readonly<Record<Key, string>>;
}

/**
 * A translate function over one family's catalogues, for the catalogues kept apart from the viewer's (the admin's own
 * texts, `docs/research/M2b-interfaces.md` §1.6): the public viewer imports none of them. Romanian and English are bundled;
 * another language reads the registry its fetched file joined (`registerCatalogue`), and a key it lacks shows in English
 * (`uiText`, `docs/I18N.md` → Fallback).
 */
export function catalogueTranslator<Key extends string>(catalogues: Catalogues<Key>): Translator<Key> {
    return (locale, key, params = {}) => fillPlaceholders(uiText(locale, key, catalogues) ?? '', params, locale);
}
