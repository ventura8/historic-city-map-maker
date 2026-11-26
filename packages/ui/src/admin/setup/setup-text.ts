/**
 * The Setup Assistant's texts in the page's language: a {@link SetupMessage} from any of its three catalogues
 * (`adminSetup.*`, `adminShell.*`, `apiError.*`), dates, times and amounts through `Intl`. Rendered as text only.
 */
import {
    PROVISION_ITEMS,
    translateAdminSetup,
    translateAdminShell,
    translateApiError,
    type AdminSetupKey,
    type AdminShellKey,
    type UiLocale,
    type ProvisionItem,
} from '@hcm/shared';

import type { GoogleScopeName, SetupMessage, SetupMessageKey, SetupStepId } from './setup-port.js';

const SCOPE_NAMES: ReadonlySet<string> = new Set<GoogleScopeName>([
    'cloudReadOnly',
    'cloudBilling',
    'cloudPlatform',
    'analyticsEdit',
    'analyticsRead',
]);

const STEP_NAMES: ReadonlySet<string> = new Set<SetupStepId>([
    'signIn',
    'billing',
    'provision',
    'deploy',
    'claim',
    'mapbox',
    'platform',
    'sources',
    'usgs',
    'analytics',
    'legacyImport',
]);

const ITEM_NAMES: ReadonlySet<string> = new Set<ProvisionItem>(PROVISION_ITEMS);

function isScopeName(value: string): value is GoogleScopeName {
    return SCOPE_NAMES.has(value);
}

function isStepName(value: string): value is SetupStepId {
    return STEP_NAMES.has(value);
}

function isItemName(value: string): value is ProvisionItem {
    return ITEM_NAMES.has(value);
}

function isSetupKey(key: SetupMessageKey): key is AdminSetupKey {
    return key.startsWith('adminSetup.');
}

function isShellKey(key: SetupMessageKey): key is AdminShellKey {
    return key.startsWith('adminShell.');
}

/** A scope by Google's own label of it (anything else as it is). */
function scopeLabel(locale: UiLocale, scope: string): string {
    return isScopeName(scope) ? translateAdminShell(locale, `adminShell.oauth.scope.${scope}`) : scope;
}

/** What a doctor item waits for: another item or a step, by its label (anything else as it is). */
function itemLabel(locale: UiLocale, item: string): string {
    if (isItemName(item)) {
        return translateAdminSetup(locale, `adminSetup.provision.item.${item}`);
    }
    return isStepName(item) ? translateAdminSetup(locale, `adminSetup.step.${item}`) : item;
}

/** An ISO 8601 time as the app keeps it (`2026-10-31T14:05:00.000Z`), not one already written out for the page. */
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** A `time` parameter in ISO 8601 (finding 34's "Last checked {time}") is shown as a date and time in the page's language. */
function timeParam(locale: UiLocale, time: string | undefined): Readonly<Record<string, string>> {
    return time !== undefined && ISO_TIME.test(time) ? { time: formatDateTime(locale, time) } : {};
}

/**
 * A `scope` parameter is shown by Google's label of the scope, an `item` parameter by the item's or step's label, an ISO
 * `time` as a date and time.
 */
function localizedParams(locale: UiLocale, params: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
    const { scope, item, time } = params;
    return {
        ...params,
        ...(scope === undefined ? {} : { scope: scopeLabel(locale, scope) }),
        ...(item === undefined ? {} : { item: itemLabel(locale, item) }),
        ...timeParam(locale, time),
    };
}

/** The message in `locale`. */
export function setupText(locale: UiLocale, message: SetupMessage): string {
    const params = localizedParams(locale, message.params ?? {});
    const { key } = message;
    if (isSetupKey(key)) {
        return translateAdminSetup(locale, key, params);
    }
    return isShellKey(key) ? translateAdminShell(locale, key, params) : translateApiError(locale, key, params);
}

/** Shorthand for a Setup Assistant key. */
export function setupLabel(locale: UiLocale, key: AdminSetupKey, params?: Readonly<Record<string, string>>): string {
    return translateAdminSetup(locale, key, params);
}

/** The `Intl` tags where the bare code would not do (British English); any other language formats by its code. */
const INTL_LOCALES: Partial<Readonly<Record<UiLocale, string>>> = { ro: 'ro-RO', en: 'en-GB' };

export function intlLocale(locale: UiLocale): string {
    return INTL_LOCALES[locale] ?? locale;
}

/** "12 oct. 2026" / "12 Oct 2026" (Bucharest time: the map's city). */
export function formatDate(locale: UiLocale, iso: string): string {
    return new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: 'medium', timeZone: 'Europe/Bucharest' }).format(new Date(iso));
}

/** "12 oct. 2026, 14:05" / "12 Oct 2026, 14:05". */
export function formatDateTime(locale: UiLocale, iso: string): string {
    return new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Bucharest' }).format(
        new Date(iso),
    );
}

/** A US-dollar amount as the cost lines write it after "USD" (up to two decimals: 0.5, 35). */
export function formatUsd(locale: UiLocale, amount: number): string {
    return new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: 2 }).format(amount);
}

/** A day (`2026-11-13`) written out in the page's language. */
export function formatDay(locale: UiLocale, day: string): string {
    return new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));
}

/** "5 USD" / "US$5": the budget in its currency, whole units. */
export function formatMoney(locale: UiLocale, amount: number, currency: string): string {
    return new Intl.NumberFormat(intlLocale(locale), {
        style: 'currency',
        currency,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(amount);
}
