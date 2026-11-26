// Server-written test documents beside documents.ts (at its size limit): the dispatcher's slots and (M28 §10) a country's list.
import { past, systemStamp, type Data } from './world.js';

/** M28: a country's list of where old maps and images are, as ops.tick writes it. */
export function countrySourcesDoc(): Data {
    return {
        country: 'RO',
        language: 'ro',
        cities: ['matrix-city'],
        places: [],
        origin: 'curated',
        factsCheckedOn: '2026-11-14',
        refreshedAt: past(),
        updatedBy: 'system:ops',
        updatedAt: past(),
    };
}

/** The dispatcher's execution slots (CR-M3-47). */
export function opsDispatchDoc(): Data {
    return { slots: { 'rules-city/job-1966': { at: past() } }, ...systemStamp('imagery') };
}
