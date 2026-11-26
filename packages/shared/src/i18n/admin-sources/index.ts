import { en as guidedEn } from '../admin-sources-guided/en.js';
import { ro as guidedRo, type AdminSourcesGuidedKey } from '../admin-sources-guided/ro.js';
import { en as finderEn } from '../admin-sources-finder/en.js';
import { ro as finderRo, type AdminSourcesFinderKey } from '../admin-sources-finder/ro.js';
import { catalogueTranslator, type Translator } from '../catalogue.js';
import { en } from './en.js';
import { ro, type AdminSourcesMainKey } from './ro.js';

/** Every text of Setup's Platform and Sources steps (M28): the cards' own, the collections drawn from by hand, translation and the country finder. */
export type AdminSourcesKey = AdminSourcesMainKey | AdminSourcesGuidedKey | AdminSourcesFinderKey;

const RO: Readonly<Record<AdminSourcesKey, string>> = { ...ro, ...guidedRo, ...finderRo };
const entry = catalogueTranslator<AdminSourcesKey>({ ro: RO, en: { ...en, ...guidedEn, ...finderEn } });

/**
 * A catalogue line holds at most 140 columns (`check_i18n.py`), so a long text continues in `<key>+2`, `<key>+3` …; the
 * text is its parts joined with a space.
 */
function parts(key: AdminSourcesKey): readonly AdminSourcesKey[] {
    const keys: AdminSourcesKey[] = [key];
    for (let next = `${key}+2`; next in RO; next = `${key}+${String(keys.length + 1)}`) {
        keys.push(next as AdminSourcesKey);
    }
    return keys;
}

/** The texts of Setup's Platform and Sources steps (M28, `docs/research/M28-sources.md`), long ones joined from their parts. */
export const translateAdminSources: Translator<AdminSourcesKey> = (locale, key, params) =>
    parts(key)
        .map((part) => entry(locale, part, params))
        .join(' ');
