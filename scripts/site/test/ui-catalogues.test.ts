/** The interface's languages beyond ro and en as `i18n/<locale>.json` next to the admin and the start page (docs/I18N.md). */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
    catalogueEntries,
    familyFolders,
    literalText,
    localeTexts,
    uiCatalogueFile,
    uiCataloguesPlugin,
    UI_CATALOGUE_FOLDER,
} from '../src/ui-catalogues.js';

/** A catalogue tree: the main family, `admin-shell` and `start`, French in two of them. */
function tree(): string {
    const root = mkdtempSync(join(tmpdir(), 'hcm-ui-catalogues-'));
    for (const folder of ['admin-shell', 'start']) {
        mkdirSync(join(root, folder));
        writeFileSync(join(root, folder, 'ro.ts'), 'export const ro = {};\n');
    }
    writeFileSync(join(root, 'fr.ts'), "export const fr = {\n    'theme.label': 'Thème',\n};\n");
    writeFileSync(join(root, 'admin-shell', 'fr.ts'), "export const fr = {\n    'adminShell.appName': 'Administration',\n};\n");
    return root;
}

describe('familyFolders', () => {
    it('happyPath_everyFolderAndTheMainFamily', () => {
        const root = tree();
        expect(familyFolders(root)).toEqual([root, join(root, 'admin-shell'), join(root, 'start')]);
    });

    it('happyPath_onlyTheNamedFamilies', () => {
        const root = tree();
        expect(familyFolders(root, ['start'])).toEqual([join(root, 'start')]);
    });
});

describe('localeTexts', () => {
    it('happyPath_everyFamilysTextsOfTheLanguageMerged', () => {
        const root = tree();
        expect(localeTexts(familyFolders(root), 'fr')).toEqual({ 'theme.label': 'Thème', 'adminShell.appName': 'Administration' });
    });

    it('badPath_aLanguageWithNoFileHasNoText', () => {
        const root = tree();
        expect(localeTexts(familyFolders(root), 'nl')).toEqual({});
    });
});

describe('catalogueEntries', () => {
    it('happyPath_everyQuoteAndAWrappedEntry', () => {
        const source = [
            "import type { K } from './ro.js';",
            'export const fr: Readonly<Partial<Record<K, string>>> = {',
            "    'a.single': 'l\\'aide \\u00e9 \"x\"',",
            '    "a.double": "l\'aide \\"y\\"",',
            "    'a.back': `tout`,",
            "    'a.wrapped':",
            "        'un texte trop long',",
            '};',
        ].join('\n');
        expect(catalogueEntries(source)).toEqual({
            'a.single': 'l\'aide é "x"',
            'a.double': 'l\'aide "y"',
            'a.back': 'tout',
            'a.wrapped': 'un texte trop long',
        });
    });

    it('badPath_aLineThatIsNoEntryIsNoText', () => {
        expect(catalogueEntries("export const fr = {\n    [computed]: 'x',\n    'k': `with ${x}`,\n};")).toEqual({});
        expect(literalText("'back\\\\slash'")).toBe('back\\slash');
    });
});

describe('uiCatalogueFile and the plugin', () => {
    it('happyPath_theFileNamesTheLanguageWithItsKeysSorted', () => {
        expect(uiCatalogueFile('fr', { b: 'B', a: 'A', c: 'C' })).toBe('{"locale":"fr","messages":{"a":"A","b":"B","c":"C"}}');
    });

    it('happyPath_thePluginWritesOneFilePerLanguage_anEmptyOneForALanguageNotTranslatedYet', () => {
        const root = tree();
        const emitted: { fileName: string; source: string }[] = [];
        const plugin = uiCataloguesPlugin({ root, locales: ['fr', 'nl'], families: ['admin-shell'] });
        const generate = plugin.generateBundle as (this: { emitFile(file: { fileName: string; source: string }): void }) => void;
        generate.call({
            emitFile: (file) => {
                emitted.push(file);
            },
        });
        expect(emitted.map((file) => file.fileName)).toEqual([`${UI_CATALOGUE_FOLDER}/fr.json`, `${UI_CATALOGUE_FOLDER}/nl.json`]);
        expect(JSON.parse(emitted[0]?.source ?? '{}')).toEqual({ locale: 'fr', messages: { 'adminShell.appName': 'Administration' } });
        expect(JSON.parse(emitted[1]?.source ?? '{}')).toEqual({ locale: 'nl', messages: {} });
    });
});
