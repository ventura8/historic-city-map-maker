/**
 * The bootstrap record (`docs/research/M2b-interfaces.md` §3.2): what steps (a)–(d) found before the server exists,
 * kept in `sessionStorage` under `hcm:admin:bootstrap:<projectId>` so a reload keeps the detected steps. It never
 * holds an access or ID token, an e-mail address, a secret or a billing account's display name: every field is a
 * state, an id or a message key, and a parameter value that `redactText` would change is refused. A malformed or
 * foreign record is dropped when read. After the claim, `setup.recordCloud` stores it and the record is deleted.
 */
import { PROVISION_ITEMS, SERVICE_STATES, redactText, setupInstallSchema, type ServiceState, type SetupInstall } from '@hcm/shared';

import { isSetupMessageKey, type MessageParams, type SetupMessageKey } from './messages.js';
import type { ProvisionItemResult, SessionStore } from './ports.js';

export const BOOTSTRAP_STEPS = ['signIn', 'billing', 'provision', 'deploy'] as const;

type BootstrapStep = (typeof BOOTSTRAP_STEPS)[number];

export interface StepHealth {
    readonly state: ServiceState;
    /** ISO 8601. */
    readonly checkedAt: string;
    readonly detail?: SetupMessageKey;
    readonly params?: MessageParams;
}

export interface BootstrapRecord {
    readonly version: 1;
    readonly projectId: string;
    readonly updatedAt: string;
    readonly steps: Partial<Record<BootstrapStep, StepHealth>>;
    readonly billing?: {
        /** `billingAccounts/<id>`, never the display name. */
        readonly accountName?: string;
        readonly budgetId?: string;
        readonly budgetAmount?: number;
        readonly currency?: string;
        /** M6 setup-ux (A60): the account appeared while the card waited, a likely free trial since then (ISO 8601). */
        readonly trialSince?: string;
    };
    readonly provision?: { readonly items: readonly ProvisionItemResult[] };
    readonly deploy?: { readonly ready: number; readonly total: number; readonly failed?: readonly string[] };
    // [section install] owner: installer (M6, docs/research/M6-interfaces.md §1.7): each install target's state.
    readonly install?: SetupInstall;
    // [end install]
}

const KEY_PREFIX = 'hcm:admin:bootstrap:';

export function bootstrapRecordKey(projectId: string): string {
    return `${KEY_PREFIX}${projectId}`;
}

type Check = (value: unknown) => boolean;

interface Field {
    readonly check: Check;
    readonly optional: boolean;
}

const required = (check: Check): Field => ({ check, optional: false });
const optional = (check: Check): Field => ({ check, optional: true });

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fieldHolds(field: Field, value: unknown): boolean {
    return value === undefined ? field.optional : field.check(value);
}

/** An object with exactly these known fields (unknown keys, such as `__proto__` or a stray token, fail). */
function shape(fields: Readonly<Record<string, Field>>): Check {
    const known = new Set(Object.keys(fields));
    return (value) =>
        isObject(value) &&
        Object.keys(value).every((key) => known.has(key)) &&
        Object.entries(fields).every(([key, field]) => fieldHolds(field, value[key]));
}

const matches =
    (pattern: RegExp): Check =>
    (value) =>
        typeof value === 'string' && pattern.test(value);

const oneOf =
    (values: readonly string[]): Check =>
    (value) =>
        typeof value === 'string' && values.includes(value);

const numberIn =
    (min: number, max: number): Check =>
    (value) =>
        typeof value === 'number' && value >= min && value <= max;

const integerIn =
    (min: number, max: number): Check =>
    (value) =>
        Number.isInteger(value) && numberIn(min, max)(value);

const listOf =
    (check: Check, max: number): Check =>
    (value) =>
        Array.isArray(value) && value.length <= max && value.every(check);

const PARAM_NAME = /^[a-zA-Z]{1,30}$/;
const MAX_PARAMS = 10;

/** A short plain value that `redactText` leaves alone: no token, no e-mail address, no URL query. */
function isParamValue(value: unknown): boolean {
    return typeof value === 'string' && value.length <= 200 && redactText(value) === value;
}

function isParams(value: unknown): boolean {
    return (
        isObject(value) &&
        Object.keys(value).length <= MAX_PARAMS &&
        Object.entries(value).every(([name, param]) => PARAM_NAME.test(name) && isParamValue(param))
    );
}

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const ACCOUNT_NAME = /^billingAccounts\/[A-Z0-9-]{1,40}$/;
const BUDGET_ID = /^billingAccounts\/[A-Z0-9-]{1,40}\/budgets\/[a-z0-9-]{1,64}$/;
const FUNCTION_NAME = /^[a-z][A-Za-z0-9-]{0,62}$/;

const isHealth = shape({
    state: required(oneOf(SERVICE_STATES)),
    checkedAt: required(matches(ISO_TIME)),
    detail: optional(isSetupMessageKey),
    params: optional(isParams),
});

const isItem = shape({
    id: required(oneOf(PROVISION_ITEMS)),
    state: required(oneOf(SERVICE_STATES)),
    detail: optional(isSetupMessageKey),
    params: optional(isParams),
});

const isRecord = shape({
    version: required((value) => value === 1),
    projectId: required(matches(PROJECT_ID)),
    updatedAt: required(matches(ISO_TIME)),
    steps: required(shape(Object.fromEntries(BOOTSTRAP_STEPS.map((step) => [step, optional(isHealth)])))),
    billing: optional(
        shape({
            accountName: optional(matches(ACCOUNT_NAME)),
            budgetId: optional(matches(BUDGET_ID)),
            budgetAmount: optional(numberIn(0, 1_000_000)),
            currency: optional(matches(/^[A-Z]{3}$/)),
            trialSince: optional(matches(ISO_TIME)),
        }),
    ),
    provision: optional(shape({ items: required(listOf(isItem, PROVISION_ITEMS.length)) })),
    deploy: optional(
        shape({
            ready: required(integerIn(0, 500)),
            total: required(integerIn(0, 500)),
            failed: optional(listOf(matches(FUNCTION_NAME), 50)),
        }),
    ),
    // [section install] owner: installer (M6): states, releases, build ids and API codes only (`setupInstallSchema`).
    install: optional((value) => setupInstallSchema.safeParse(value).success),
    // [end install]
});

/** True when `value` is a well-formed record (the checks `readBootstrapRecord` applies). */
export function isBootstrapRecord(value: unknown): value is BootstrapRecord {
    return isRecord(value);
}

function parse(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

/** The project's record, or null; a malformed or foreign one is removed. */
export function readBootstrapRecord(store: SessionStore, projectId: string): BootstrapRecord | null {
    const key = bootstrapRecordKey(projectId);
    const text = store.get(key);
    if (text === null) {
        return null;
    }
    const value = parse(text);
    if (isBootstrapRecord(value) && value.projectId === projectId) {
        return value;
    }
    store.remove(key);
    return null;
}

/** Stores `record` when it is well-formed; a record that would hold anything else is not written (and says so). */
export function writeBootstrapRecord(store: SessionStore, record: BootstrapRecord): boolean {
    if (!isBootstrapRecord(record)) {
        return false;
    }
    store.set(bootstrapRecordKey(record.projectId), JSON.stringify(record));
    return true;
}

export function clearBootstrapRecord(store: SessionStore, projectId: string): void {
    store.remove(bootstrapRecordKey(projectId));
}
