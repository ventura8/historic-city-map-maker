import { FIRESTORE_PATHS, poiCategoryDocSchema, starterCategoryDocs, type CityDoc } from '@hcm/shared';

import type { DocumentTransaction } from '../ports/documents.js';

/**
 * A new city's starter POI categories (the live manual test of 2026-11-01, finding 35): written by the transaction that
 * creates the city (`cities.create`, `setup.createCity`), stamped as the city is, so a place can be added at once. A
 * new city has no layer, so each id is the slug of its Romanian label (`starterCategoryDocs` of `@hcm/shared`).
 */
export async function createStarterCategories(transaction: DocumentTransaction, cityId: string, city: CityDoc): Promise<void> {
    for (const { id, ...category } of starterCategoryDocs([])) {
        await transaction.create(FIRESTORE_PATHS.poiCategory(cityId, id), poiCategoryDocSchema, {
            ...category,
            createdAt: city.updatedAt,
            updatedBy: city.updatedBy,
            updatedAt: city.updatedAt,
        });
    }
}
