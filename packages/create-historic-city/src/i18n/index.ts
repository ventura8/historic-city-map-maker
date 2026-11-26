/**
 * The CLI's own catalogue (Romanian, the source of truth, and English): `--lang`, else `LANG` (`en_GB.UTF-8` is
 * English), else Romanian.
 */
import { en } from './en.js';
import { ro, type CliKey } from './ro.js';

export type { CliKey } from './ro.js';

export type CliLocale = 'ro' | 'en';

export type Translate = (key: CliKey, params?: Readonly<Record<string, string | number>>) => string;

const CATALOGUES: Readonly<Record<CliLocale, Readonly<Record<CliKey, string>>>> = { ro, en };

/** The language of `--lang`, else of `LANG` (`en_US.UTF-8` → English); Romanian otherwise. */
export function cliLocale(flag: string | undefined, lang: string | undefined): CliLocale {
    const language = (flag ?? lang ?? '').toLowerCase().split(/[_.@-]/)[0];
    return language === 'en' ? 'en' : 'ro';
}

/** The translate function of `locale`; `{name}` placeholders are filled from `params` (unknown ones stay visible). */
export function translator(locale: CliLocale): Translate {
    const catalogue = CATALOGUES[locale];
    return (key, params = {}) =>
        catalogue[key].replace(/\{(\w+)\}/g, (placeholder: string, name: string) => {
            const value = params[name];
            return value === undefined ? placeholder : String(value);
        });
}
