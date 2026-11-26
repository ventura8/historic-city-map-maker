/**
 * Every translated catalogue imported so far (scripts/i18n/import_translations.py, docs/I18N.md): each holds only its family's
 * keys, a text for each, under the export its language names. The admin's build reads these files into `i18n/<locale>.json`.
 */
import { BUNDLED_LOCALES, isUiLocale } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

type Catalogue = Readonly<Record<string, Readonly<Record<string, string>> | undefined>>;

const TRANSLATED = import.meta.glob<Catalogue>(['../../../shared/src/i18n/*/*.ts', '!**/index.ts', '!**/ro.ts', '!**/en.ts'], {
    eager: true,
});
const SOURCES = import.meta.glob<Catalogue>('../../../shared/src/i18n/*/ro.ts', { eager: true });

/** (family folder, language) of a catalogue's path. */
function partsOf(path: string): readonly [string, string] {
    const [folder = '', file = ''] = path.split('/').slice(-2);
    return [folder, file.replace(/\.ts$/u, '')];
}

describe('the translated catalogues', () => {
    const files = Object.entries(TRANSLATED);

    it('happyPath_someAreThere', () => {
        expect(files.filter(([path, module]) => Object.keys(module[partsOf(path)[1]] ?? {}).length > 0).length).toBeGreaterThan(0);
    });

    it.each(files)('happyPath_%s_holdsOnlyItsFamilysKeys', (path, module) => {
        const [folder, locale] = partsOf(path);
        const source = SOURCES[`../../../shared/src/i18n/${folder}/ro.ts`]?.['ro'] ?? {};
        const texts = Object.entries(module[locale] ?? {});

        // A language not translated yet is an empty literal (docs/I18N.md); one that has texts holds only its family's.
        expect(isUiLocale(locale) && !BUNDLED_LOCALES.includes(locale)).toBe(true);
        expect(module[locale]).toBeDefined();
        expect(texts.filter(([key, text]) => !Object.hasOwn(source, key) || text.trim() === '')).toEqual([]);
    });
});
