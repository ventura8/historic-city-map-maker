/**
 * Reading Google's JSON answers without trusting their shape: every helper answers undefined (or an empty list) as soon
 * as a step is not what it should be, so a client never throws on an unexpected field and never casts.
 */

export type JsonObject = Readonly<Record<string, unknown>>;

export function isRecord(value: unknown): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The value when it is an object, else an empty one. */
export function asRecord(value: unknown): JsonObject {
    return isRecord(value) ? value : {};
}

/** The value at `path` inside nested objects, or undefined as soon as a step is not an object. */
export function at(value: unknown, ...path: readonly string[]): unknown {
    return path.reduce<unknown>((current, key) => (isRecord(current) ? current[key] : undefined), value);
}

/** The string at `path`, or undefined. */
export function stringAt(value: unknown, ...path: readonly string[]): string | undefined {
    const found = at(value, ...path);
    return typeof found === 'string' ? found : undefined;
}

/** The entries of an array; not an array → empty. */
export function list(value: unknown): readonly unknown[] {
    return Array.isArray(value) ? (value as readonly unknown[]) : [];
}

/** The strings of an array (other entries dropped); not an array → empty. */
export function strings(value: unknown): string[] {
    return list(value).filter((entry): entry is string => typeof entry === 'string');
}

/** The objects of an array (other entries dropped). */
export function records(value: unknown): JsonObject[] {
    return list(value).filter(isRecord);
}

/** The last segment of a resource name (`projects/1/keys/abc` → `abc`). */
export function lastSegment(name: string): string {
    return name.slice(name.lastIndexOf('/') + 1);
}

/** JSON equality of two plain values with object keys in any order (arrays keep their order). */
export function sameJson(left: unknown, right: unknown): boolean {
    return canonical(left) === canonical(right);
}

function sortKeys(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(sortKeys);
    }
    if (isRecord(value)) {
        return Object.fromEntries(
            Object.keys(value)
                .sort((a, b) => a.localeCompare(b))
                .map((key) => [key, sortKeys(value[key])]),
        );
    }
    return value;
}

function canonical(value: unknown): string {
    return JSON.stringify(sortKeys(value));
}

/** `actual` reduced to the keys `spec` has, in nested objects and arrays alike (Google adds defaults to what it stores). */
function onlySpecKeys(actual: unknown, spec: unknown): unknown {
    if (Array.isArray(actual) && Array.isArray(spec)) {
        return actual.map((item: unknown, index) => onlySpecKeys(item, spec[index]));
    }
    if (!isRecord(actual) || !isRecord(spec)) {
        return actual;
    }
    return Object.fromEntries(Object.keys(spec).map((key) => [key, onlySpecKeys(actual[key], spec[key])]));
}

/** True when `actual` holds every value of `spec` (extra keys Google added are ignored; arrays keep their order and length). */
export function matchesSpec(actual: unknown, spec: unknown): boolean {
    return sameJson(onlySpecKeys(actual, spec), spec);
}

/** The same strings in any order. */
export function sameSet(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((item) => right.includes(item));
}
