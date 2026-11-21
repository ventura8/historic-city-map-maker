/**
 * Object helpers every feature folder may use (`api/` is shared plumbing; feature folders never import each other,
 * CR-M2-3 and CR-M2-31): Firestore refuses `undefined` values, so absent fields are left out rather than set.
 */

/** Every key of `T`, each one possibly `undefined` (what a builder has before the absent ones are dropped). */
type Loose<T> = { [K in keyof T]-?: T[K] | undefined };

/**
 * `value` without its `undefined` properties: an absent field, as `exactOptionalPropertyTypes` and Firestore want it
 * (the Admin SDK refuses `undefined` values).
 */
export function compact<T extends object>(value: Loose<T>): T {
    return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as T;
}

/** `value` without `keys` (server-owned fields a new result replaces, a field that no longer applies). */
export function omit<T extends object, K extends keyof T>(value: T, keys: readonly K[]): Omit<T, K> {
    const dropped = new Set<PropertyKey>(keys);
    return Object.fromEntries(Object.entries(value).filter(([key]) => !dropped.has(key))) as Omit<T, K>;
}
