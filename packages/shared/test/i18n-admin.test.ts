import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ADMIN_CONTENT_CATALOGUES, translateAdminContent } from '../src/i18n/admin-content/index.js';
import { en as setupEn } from '../src/i18n/admin-setup/en.js';
import { translateAdminSetup } from '../src/i18n/admin-setup/index.js';
import { ro as setupRo } from '../src/i18n/admin-setup/ro.js';
import { en as shellEn } from '../src/i18n/admin-shell/en.js';
import { translateAdminShell } from '../src/i18n/admin-shell/index.js';
import { ro as shellRo } from '../src/i18n/admin-shell/ro.js';
import { catalogueTranslator } from '../src/i18n/catalogue.js';
import { PROVISION_ITEMS, SERVICE_STATES } from '../src/schemas/firestore-ops.js';

const byText = (a: string, b: string): number => a.localeCompare(b);

/** Romanian with the cedilla forms (ş, ţ) instead of the comma-below letters (ș, ț): wrong in every catalogue. */
const CEDILLA = /[şţŞŢ]/;

const FAMILIES = [
    ['admin shell', shellRo, shellEn],
    ['Setup Assistant', setupRo, setupEn],
    ['admin editors', ADMIN_CONTENT_CATALOGUES.ro, ADMIN_CONTENT_CATALOGUES.en],
] as const;

describe('admin catalogues', () => {
    it.each(FAMILIES)('happyPath_the %s catalogues have the same keys in both languages', (_name, ro, en) => {
        expect(Object.keys(en).toSorted(byText)).toEqual(Object.keys(ro).toSorted(byText));
    });

    it.each(FAMILIES)('badPath_the %s catalogues use comma-below diacritics only', (_name, ro, en) => {
        const wrong = [...Object.values(ro), ...Object.values(en)].filter((text) => CEDILLA.test(text));

        expect(wrong).toEqual([]);
    });

    it.each(['ro', 'en'] as const)('badPath_no %s step name contains another, so a step row is found by its name alone', (locale) => {
        // A job's steps list `<name> <state>`; "Pregătirea dalelor" inside "Pregătirea dalelor pentru hartă" made the e2e's
        // row lookup see two rows, and the owner two steps that read alike (docs/LESSONS.md 403).
        const catalogue: Readonly<Record<string, string>> = ADMIN_CONTENT_CATALOGUES[locale];
        const names = Object.entries(catalogue)
            .filter(([key]) => key.startsWith('adminContent.jobs.stepName.'))
            .map(([, text]) => text);
        const inside = names.flatMap((name) =>
            names.filter((other) => other !== name && other.includes(name)).map((other) => `${name} | ${other}`),
        );

        expect(names.length).toBeGreaterThan(20);
        expect(inside).toEqual([]);
    });

    it('happyPath_theShellExplainsTheGoogleConsentInBothLanguages', () => {
        expect(translateAdminShell('ro', 'adminShell.auth.notOwner', { projectId: 'demo-hcm' })).toBe(
            'Doar proprietarul proiectului Google Cloud demo-hcm poate configura harta.',
        );
        expect(translateAdminShell('en', 'adminShell.oauth.unverifiedHow', { domain: 'demo-hcm.firebaseapp.com' })).toBe(
            'If so, open the advanced options and continue to demo-hcm.firebaseapp.com.',
        );
    });

    it('happyPath_everyDoctorItemAndServiceStateHasALabel', () => {
        const items = PROVISION_ITEMS.map((id) => translateAdminSetup('en', `adminSetup.provision.item.${id}`));
        const states = SERVICE_STATES.map((state) => translateAdminSetup('ro', `adminSetup.state.${state}`));

        expect(items).toHaveLength(PROVISION_ITEMS.length);
        expect(items.every((label) => label.length > 0)).toBe(true);
        expect(states).toEqual(['De făcut', 'În așteptare', 'Gata', 'Necesită atenție', 'Indisponibil acum']);
    });

    it('badPath_anUnknownPlaceholderStaysVisible', () => {
        expect(translateAdminSetup('ro', 'adminSetup.import.progress', { done: '3' })).toBe('Fotografii importate: 3 din {total}');
    });
});

/**
 * The editors' texts are one catalogue folder per area (CR-M2c-25 of docs/research/M2c-interfaces.md): each area edits its
 * own files. Every folder keeps its areas' marked sections, the same in both languages, and every key carries its section's
 * prefix, so no area's text lands in another's folder and the merge of `ADMIN_CONTENT_CATALOGUES` overrides nothing.
 */
const CONTENT_FOLDERS = {
    'admin-content': ['common', 'map', 'field'],
    'admin-photos': ['photos'],
    'admin-pois': ['pois'],
    'admin-layers': ['layers'],
    'admin-settings': ['settings'],
    'admin-ops': ['admins', 'history', 'jobs', 'crashes', 'statistics'],
    'admin-imagery': ['imagery'],
    'admin-georef': ['georef'],
    'admin-orders': ['orders'],
    'admin-notify': ['notify', 'assist'],
    'admin-review': ['review', 'contribute'],
    'admin-stories': ['stories'],
    'admin-cities': ['cities', 'budgets'],
    'admin-export': ['export'],
} as const;
const SECTION_START = /^\s*\/\/ \[section ([a-z]+)\]/;
const SECTION_END = /^\s*\/\/ \[end ([a-z]+)\]/;
const ENTRY_KEY = /^\s*'([^']+)':/;

interface Scan {
    readonly order: string[];
    readonly ends: string[];
    readonly misplaced: string[];
    readonly keys: string[];
    open: string | null;
}

function captured(pattern: RegExp, line: string): string | null {
    return pattern.exec(line)?.[1] ?? null;
}

/** A key outside every section, or outside its own section's prefix, is misplaced. */
function checkKey(scan: Scan, key: string | null): void {
    if (key === null) {
        return;
    }
    scan.keys.push(key);
    if (!key.startsWith(`adminContent.${scan.open ?? '-'}.`)) {
        scan.misplaced.push(key);
    }
}

function scanLine(scan: Scan, line: string): void {
    const start = captured(SECTION_START, line);
    const end = captured(SECTION_END, line);
    if (start !== null) {
        scan.order.push(start);
        scan.open = start;
    } else if (end !== null) {
        scan.ends.push(end);
        scan.open = null;
    } else {
        checkKey(scan, captured(ENTRY_KEY, line));
    }
}

/** The sections of a catalogue's source in order, their end markers, every key and every misplaced key. */
function sectionsOf(source: string): Omit<Scan, 'open'> {
    const scan: Scan = { order: [], ends: [], misplaced: [], keys: [], open: null };
    for (const line of source.split('\n')) {
        scanLine(scan, line);
    }
    return { order: scan.order, ends: scan.ends, misplaced: scan.misplaced, keys: scan.keys };
}

function catalogueSource(folder: string, file: string): string {
    return readFileSync(resolve(import.meta.dirname, '../src/i18n', folder, file), 'utf8');
}

const FOLDER_FILES = Object.entries(CONTENT_FOLDERS).flatMap(([folder, sections]) =>
    ['ro.ts', 'en.ts'].map((file) => [folder, file, sections] as const),
);

describe("the admin editors' catalogues", () => {
    it.each(FOLDER_FILES)('happyPath_%s/%s keeps its marked sections, in order', (folder, file, sections) => {
        const scan = sectionsOf(catalogueSource(folder, file));

        expect({ order: scan.order, ends: scan.ends, misplaced: scan.misplaced }).toEqual({
            order: sections,
            ends: sections,
            misplaced: [],
        });
    });

    it.each(['ro.ts', 'en.ts'])('happyPath_the folders of %s hold every key once, and the merge holds them all', (file) => {
        const keys = Object.keys(CONTENT_FOLDERS).flatMap((folder) => sectionsOf(catalogueSource(folder, file)).keys);
        const locale = file === 'ro.ts' ? 'ro' : 'en';

        expect(new Set(keys).size).toBe(keys.length);
        expect(keys.toSorted(byText)).toEqual(Object.keys(ADMIN_CONTENT_CATALOGUES[locale]).toSorted(byText));
    });

    it('happyPath_translatesInBothLanguages', () => {
        expect(translateAdminContent('ro', 'adminContent.admins.revokeConfirm', { name: 'Ana' })).toBe('Retragi accesul pentru Ana?');
        expect(translateAdminContent('en', 'adminContent.common.save')).toBe('Save');
    });

    it('badPath_aKeyInAnotherAreasSectionOrOutsideEverySectionIsReported', () => {
        const source = [
            '    // [section photos] owner: photos',
            "    'adminContent.photos.empty': 'x',",
            "    'adminContent.pois.empty': 'y',",
            '    // [end photos]',
            "    'adminContent.jobs.empty': 'z',",
        ].join('\n');

        expect(sectionsOf(source)).toEqual({
            order: ['photos'],
            ends: ['photos'],
            misplaced: ['adminContent.pois.empty', 'adminContent.jobs.empty'],
            keys: ['adminContent.photos.empty', 'adminContent.pois.empty', 'adminContent.jobs.empty'],
        });
    });
});

describe('catalogueTranslator', () => {
    const translate = catalogueTranslator<'greeting'>({ ro: { greeting: 'Salut, {name}!' }, en: { greeting: 'Hello, {name}!' } });

    it('happyPath_fillsThePlaceholdersOfTheChosenLocale', () => {
        expect(translate('en', 'greeting', { name: 'Ana' })).toBe('Hello, Ana!');
        expect(translate('ro', 'greeting', { name: 'Ana' })).toBe('Salut, Ana!');
    });

    it('badPath_withoutParamsThePlaceholderStaysVisible', () => {
        expect(translate('ro', 'greeting')).toBe('Salut, {name}!');
    });
});
