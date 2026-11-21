/**
 * The Firestore REST encoding of the values the admin specs seed and read back through the emulator
 * (`https://firestore.googleapis.com/v1` document `fields`): strings, numbers, booleans, null, timestamps (`Date`),
 * arrays and maps. A timestamp reads back as its ISO 8601 text.
 */

type FirestoreValue =
    | { readonly stringValue: string }
    | { readonly integerValue: string }
    | { readonly doubleValue: number }
    | { readonly booleanValue: boolean }
    | { readonly nullValue: null }
    | { readonly timestampValue: string }
    | { readonly arrayValue: { readonly values?: readonly FirestoreValue[] } }
    | { readonly mapValue: { readonly fields?: Readonly<Record<string, FirestoreValue>> } };

export type FirestoreFields = Readonly<Record<string, FirestoreValue>>;

function encodeNumber(value: number): FirestoreValue {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
}

function encodeObject(value: object): FirestoreValue {
    if (value instanceof Date) {
        return { timestampValue: value.toISOString() };
    }
    if (Array.isArray(value)) {
        return { arrayValue: { values: value.map(encodeValue) } };
    }
    return { mapValue: { fields: encodeFields(value as Readonly<Record<string, unknown>>) } };
}

const PRIMITIVES: ReadonlySet<string> = new Set(['string', 'number', 'boolean']);

function encodePrimitive(value: string | number | boolean): FirestoreValue {
    if (typeof value === 'string') {
        return { stringValue: value };
    }
    return typeof value === 'number' ? encodeNumber(value) : { booleanValue: value };
}

/** One value; throws on a type Firestore has no REST encoding for here (a function, a symbol, undefined). */
function encodeValue(value: unknown): FirestoreValue {
    if (value === null) {
        return { nullValue: null };
    }
    if (typeof value === 'object') {
        return encodeObject(value);
    }
    if (PRIMITIVES.has(typeof value)) {
        return encodePrimitive(value as string | number | boolean);
    }
    throw new TypeError(`no Firestore encoding for a ${typeof value}`);
}

export function encodeFields(data: Readonly<Record<string, unknown>>): FirestoreFields {
    return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, encodeValue(value)]));
}

/** One value back as plain data. */
function decodeValue(value: FirestoreValue): unknown {
    if ('integerValue' in value) {
        return Number(value.integerValue);
    }
    if ('arrayValue' in value) {
        return (value.arrayValue.values ?? []).map(decodeValue);
    }
    if ('mapValue' in value) {
        return decodeFields(value.mapValue.fields ?? {});
    }
    return Object.values(value)[0] as unknown;
}

export function decodeFields(fields: FirestoreFields): Record<string, unknown> {
    return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeValue(value)]));
}
