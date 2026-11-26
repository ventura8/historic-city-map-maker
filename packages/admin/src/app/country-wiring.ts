/**
 * M28 (`docs/research/M28-sources.md` §10): the list of the city's country over the Firestore SDK. `ops.tick` writes one
 * `countrySources/{country}` per country, naming its cities; the admin reads the few lists there are and keeps the one that
 * names this city. A list the schema refuses is skipped (the next refresh writes it again).
 */
import { FIRESTORE_PATHS, cityDocSchema, timestampToDate } from '@hcm/shared';
import { countrySourcesDocSchema, type CountrySourcesDoc } from '@hcm/shared/sources';

import type { FirebasePorts } from '../firebase/ports.js';
import type { CountryList } from '../setup/sources-state.js';

type Documents = Pick<FirebasePorts, 'documents'>['documents'];

/** The city's name in the institutions' language (else Romanian, the name every city has). */
async function cityName(documents: Documents, cityId: string, language: string): Promise<string | null> {
    const name = cityDocSchema.shape.name.safeParse((await documents.get(FIRESTORE_PATHS.city(cityId)))?.['name']);
    if (!name.success) {
        return null;
    }
    return language === 'en' ? (name.data.en ?? name.data.ro) : name.data.ro;
}

function listOf(doc: CountrySourcesDoc, name: string | null): CountryList {
    return {
        country: doc.country,
        language: doc.language,
        origin: doc.origin,
        factsCheckedOn: doc.factsCheckedOn ?? null,
        refreshedAt: timestampToDate(doc.refreshedAt).toISOString(),
        places: doc.places,
        cityName: name,
    };
}

/** The list naming `cityId`, or null while none does. */
export async function readCountryList(documents: Documents, cityId: string): Promise<CountryList | null> {
    const rows = await documents.query(FIRESTORE_PATHS.countrySources, []);
    const lists = rows.map((row) => countrySourcesDocSchema.safeParse(row.data));
    const found = lists.find((parsed) => parsed.success && parsed.data.cities.includes(cityId));
    if (found?.success !== true) {
        return null;
    }
    return listOf(found.data, await cityName(documents, cityId, found.data.language));
}
