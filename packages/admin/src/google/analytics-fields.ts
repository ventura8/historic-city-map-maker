import { at, records, stringAt } from './json.js';
import type { GoogleTransport } from './transport.js';

/**
 * Which of the map's measurement names the Statistics view may ask GA4's Data API for (§203; the fix of 2026-11-13 for
 * "Google Analytics does not know the map's measurement names yet" shown while Setup's step g had registered all 23):
 * the property's metadata (`v1beta` `getMetadata`) lists the custom dimensions and metrics its reports can use today. A
 * report that names one it does not list is not asked (Google would refuse the whole batch with a 400), and the view says
 * why, from the Analytics Admin API's registered names:
 *
 * - `notRegistered`: a name is not registered on the property at all (Setup's Create the measurement reports never ran);
 * - `notReady`: every missing name is registered, but GA4's reports cannot use it yet (Google needs up to 48 hours);
 * - `noData`: every name is usable, but no event carried one yet (values show 24 to 48 hours after the events, and only
 *   for events sent after the name was registered).
 */

export type PendingReason = 'notRegistered' | 'notReady' | 'noData';

export interface StatisticsPending {
    readonly reason: PendingReason;
    /** The parameter names concerned (for the logs and the tests; the page says it in words). */
    readonly names: readonly string[];
}

/** GA4's value for an event without the parameter (or sent before the name was registered). */
export const NOT_SET = '(not set)';

const DATA_API = 'https://analyticsdata.googleapis.com/v1beta';
const CUSTOM_FIELD = /^(?:average|count)?[cC]ustomEvent:(\w+)$/;

/** The parameter of a custom field (`customEvent:step_id`, `averageCustomEvent:duration_ms`), else undefined. */
function parameterOf(field: string): string | undefined {
    return CUSTOM_FIELD.exec(field)?.[1];
}

/** The custom parameters of `fields`, each once. */
export function parametersOf(fields: readonly string[]): readonly string[] {
    return [...new Set(fields.map(parameterOf).filter((name): name is string => name !== undefined))];
}

/** The custom parameters the property's reports can use today, from its metadata. */
export async function usableParameters(transport: GoogleTransport, property: string, role: string): Promise<ReadonlySet<string>> {
    const answer = await transport.call({ operation: 'analytics-data.getMetadata', url: `${DATA_API}/${property}/metadata`, role });
    const fields = [...records(at(answer, 'dimensions')), ...records(at(answer, 'metrics'))].map((item) => stringAt(item, 'apiName') ?? '');
    return new Set(parametersOf(fields));
}

/** Why some of `wanted` are missing from `usable`: not registered at all, or registered and not ready yet; null when none is. */
export async function missingParameters(
    transport: GoogleTransport,
    where: { readonly property: string; readonly role: string },
    wanted: readonly string[],
    usable: ReadonlySet<string>,
): Promise<StatisticsPending | null> {
    const { property, role } = where;
    const missing = wanted.filter((name) => !usable.has(name));
    if (missing.length === 0) {
        return null;
    }
    // Setup's own chunk (`analytics-reports`), fetched as it is: sharing it statically would move it into `editor-shared`.
    const { registeredParameters } = await import('./analytics-reports.js');
    const registered = await registeredParameters(transport, property, role);
    const unknown = missing.filter((name) => !registered.has(name));
    return unknown.length > 0 ? { reason: 'notRegistered', names: unknown } : { reason: 'notReady', names: missing };
}
