import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { Plugin } from 'vite';

/**
 * The interface's languages beyond Romanian and English, out of the admin's and the start page's bundles (`docs/I18N.md`
 * → Loading). Their builds write `i18n/<locale>.json` next to their module: `{"locale": "<code>", "messages": {…}}`, every
 * catalogue family of that language merged (each key carries its family's prefix: `adminShell.…`, `start.…`), its keys
 * sorted. The page fetches the file the first time the language is chosen (`packages/admin/src/state/ui-language.ts`); a
 * key the file lacks shows in English. Nothing is bundled: the files are data, as the engine's languages are
 * (`i18n-catalogues.ts`).
 */

/** The folder of the files next to the page's module. */
export const UI_CATALOGUE_FOLDER = 'i18n';

const STRING = String.raw`'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"`;
/** One entry, the shape `scripts/ci/check_i18n.py` holds every catalogue to: `'key': 'text',` on one line. */
const ENTRY = new RegExp(String.raw`^\s*(${STRING})\s*:\s*(${STRING}|` + '`[^`$]*`' + String.raw`)\s*,?\s*$`);
/** A translation's key whose text Prettier moved to the next line (too long for one). */
const KEY_ONLY = new RegExp(String.raw`^\s*(?:${STRING})\s*:\s*$`);

/** The text of a JavaScript string literal of a catalogue (single, double or back quotes; no `${…}`). */
export function literalText(token: string): string {
    const inner = token.slice(1, -1);
    if (token.startsWith('`')) {
        return inner;
    }
    const asJson = inner.replace(/\\(.)|"/gsu, (match: string, escaped: string | undefined) => {
        if (escaped === undefined) {
            return String.raw`\"`;
        }
        return escaped === "'" ? "'" : match;
    });
    return JSON.parse(`"${asJson}"`) as string;
}

/** The lines of a catalogue with each wrapped entry joined again. */
function unwrappedLines(source: string): string[] {
    const lines: string[] = [];
    for (const line of source.split('\n')) {
        const previous = lines.at(-1);
        if (previous !== undefined && KEY_ONLY.test(previous)) {
            lines[lines.length - 1] = `${previous} ${line.trim()}`;
        } else {
            lines.push(line);
        }
    }
    return lines;
}

/** Every `'key': 'text'` entry of a catalogue file (`<folder>/<locale>.ts`). */
export function catalogueEntries(source: string): Record<string, string> {
    const entries: Record<string, string> = {};
    for (const match of unwrappedLines(source).map((line) => ENTRY.exec(line))) {
        if (match !== null) {
            entries[literalText(String(match[1]))] = literalText(String(match[2]));
        }
    }
    return entries;
}

/** The catalogue folders of `root` (`packages/shared/src/i18n`): itself, then every folder in it, `families` only when given. */
export function familyFolders(root: string, families?: readonly string[]): string[] {
    const inside = readdirSync(root)
        .filter((name) => statSync(join(root, name)).isDirectory())
        .filter((name) => families === undefined || families.includes(name))
        .toSorted((a, b) => a.localeCompare(b));
    return [...(families === undefined ? [root] : []), ...inside.map((name) => join(root, name))];
}

/** Every family's texts of `locale` merged; a family without the language adds nothing (its keys fall back to English). */
export function localeTexts(folders: readonly string[], locale: string): Record<string, string> {
    const files = folders
        .map((folder) => join(folder, `${locale}.ts`))
        .filter((file) => statSync(file, { throwIfNoEntry: false })?.isFile());
    return Object.assign({}, ...files.map((file) => catalogueEntries(readFileSync(file, 'utf8')))) as Record<string, string>;
}

/** One language's file, as the page fetches it. */
export function uiCatalogueFile(locale: string, messages: Readonly<Record<string, string>>): string {
    const sorted = Object.fromEntries(Object.entries(messages).toSorted(([a], [b]) => (a < b ? -1 : 1)));
    return JSON.stringify({ locale, messages: sorted });
}

export interface UiCataloguesOptions {
    /** `packages/shared/src/i18n`. */
    readonly root: string;
    /** The languages to write: every interface language but the bundled two. */
    readonly locales: readonly string[];
    /** Only these families' folders (the start page: `start`, `api`); every folder and the viewer's main family when absent. */
    readonly families?: readonly string[];
}

/**
 * The Vite plugin: once the bundle is written, one file per language, an empty one for a language not translated yet (its
 * every key then shows in English, `docs/I18N.md` → Fallback).
 */
export function uiCataloguesPlugin(options: UiCataloguesOptions): Plugin {
    return {
        name: 'hcm-ui-catalogues',
        generateBundle() {
            const folders = familyFolders(options.root, options.families);
            for (const locale of options.locales) {
                const source = uiCatalogueFile(locale, localeTexts(folders, locale));
                this.emitFile({ type: 'asset', fileName: `${UI_CATALOGUE_FOLDER}/${locale}.json`, source });
            }
        },
    };
}
