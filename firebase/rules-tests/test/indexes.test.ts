/**
 * firebase/firestore.indexes.json (no emulator: the emulator serves every query without indexes, production does
 * not). Every composite index names fields of its collection's zod schema, the admin's list queries have theirs, and
 * the large fields exempt from single-field indexing (texts, geometries, snapshots, theme tokens) exist and are never
 * part of a composite index.
 */
import { readFileSync } from 'node:fs';

import {
    cityDocSchema,
    historyEntryDocSchema,
    inboxItemDocSchema,
    jobDocSchema,
    jobLogDocSchema,
    layerDocSchema,
    layerVersionDocSchema,
    manifestStateDocSchema,
    photoDocSchema,
    poiCategoryDocSchema,
    poiDocSchema,
    roleRequestDocSchema,
    suggestionDocSchema,
    usgsSceneDocSchema,
} from '@hcm/shared';
import { describe, expect, it } from 'vitest';

interface IndexField {
    readonly fieldPath: string;
    readonly order?: string;
    readonly arrayConfig?: string;
}

interface CompositeIndex {
    readonly collectionGroup: string;
    readonly queryScope: string;
    readonly fields: readonly IndexField[];
}

interface FieldOverride {
    readonly collectionGroup: string;
    readonly fieldPath: string;
    readonly indexes: readonly unknown[];
}

interface IndexFile {
    readonly indexes: readonly CompositeIndex[];
    readonly fieldOverrides: readonly FieldOverride[];
}

const config = JSON.parse(readFileSync(new URL('../../firestore.indexes.json', import.meta.url), 'utf8')) as IndexFile;

/** The collection ids (Firestore's `collectionGroup`) of the project and the schema of their documents. */
const SCHEMAS: Readonly<Record<string, { readonly shape: object }>> = {
    cities: cityDocSchema,
    photos: photoDocSchema,
    layers: layerDocSchema,
    pois: poiDocSchema,
    suggestions: suggestionDocSchema,
    roleRequests: roleRequestDocSchema,
    poiCategories: poiCategoryDocSchema,
    jobs: jobDocSchema,
    logs: jobLogDocSchema,
    layerVersions: layerVersionDocSchema,
    usgsScenes: usgsSceneDocSchema,
    history: historyEntryDocSchema,
    manifests: manifestStateDocSchema,
    /** M4: each admin's inbox (docs/research/M4-interfaces.md §5.6). */
    inbox: inboxItemDocSchema,
};

function fieldsOf(collection: string): string[] {
    return Object.keys(SCHEMAS[collection]?.shape ?? {});
}

function describeField(field: IndexField): string {
    return `${field.fieldPath} ${field.order ?? field.arrayConfig ?? ''}`;
}

/** `photos: published ASCENDING, updatedAt DESCENDING`: an index as one readable line. */
function signature(index: CompositeIndex): string {
    return `${index.collectionGroup}: ${index.fields.map(describeField).join(', ')}`;
}

describe('composite indexes', () => {
    it.each(config.indexes.map((index) => [signature(index), index] as const))('happyPath_%s_namesSchemaFields', (_signature, index) => {
        const unknown = index.fields.filter((field) => !fieldsOf(index.collectionGroup).includes(field.fieldPath.split('.')[0] ?? ''));

        expect(unknown).toEqual([]);
        // History's recent changes are the one collection-group query (docs/research/M2c-interfaces.md §9.2, CR-M2c-6).
        expect([index.queryScope, index.collectionGroup === 'history' || index.queryScope === 'COLLECTION']).toEqual([
            expect.stringMatching(/^COLLECTION(_GROUP)?$/),
            true,
        ]);
        expect(index.fields.length).toBeGreaterThanOrEqual(2);
    });

    it.each([
        'photos: published ASCENDING, updatedAt DESCENDING',
        'photos: processing ASCENDING, updatedAt DESCENDING',
        'photos: license ASCENDING, updatedAt DESCENDING',
        'photos: rightsReview ASCENDING, updatedAt DESCENDING',
        'pois: category ASCENDING, updatedAt DESCENDING',
        'pois: published ASCENDING, updatedAt DESCENDING',
        'layers: published ASCENDING, order ASCENDING',
        'jobs: status ASCENDING, createdAt DESCENDING',
        'jobs: status ASCENDING, createdAt ASCENDING',
        'history: action ASCENDING, updatedAt DESCENDING',
        // M3 (docs/research/M3-interfaces.md §2.8): the tick's due jobs, a layer's jobs and versions, the Imagery area's lists.
        'jobs: status ASCENDING, retryAt ASCENDING',
        'jobs: layerId ASCENDING, createdAt DESCENDING',
        'layerVersions: layerId ASCENDING, createdAt DESCENDING',
        'layerVersions: state ASCENDING, updatedAt DESCENDING',
        'usgsScenes: downloadAvailable ASCENDING, rank.score DESCENDING',
        'usgsScenes: status ASCENDING, rank.score DESCENDING',
        // M4 (docs/research/M4-interfaces.md §5.6): an admin's unread items, newest first.
        'inbox: read ASCENDING, createdAt DESCENDING',
        // M7 (docs/research/M7-local-worker.md §8): worker.claim's oldest queued local jobs.
        'jobs: runOn ASCENDING, status ASCENDING, createdAt ASCENDING',
    ])('happyPath_theAdminQueryHasItsIndex_%s', (wanted) => {
        expect(config.indexes.filter((index) => index.queryScope === 'COLLECTION').map(signature)).toContain(wanted);
    });

    // The recent changes ask one city's entries (`cityId ==`, CR-M2c-14), then filter by action, by entity or both.
    it.each([
        'history: cityId ASCENDING, updatedAt DESCENDING',
        'history: cityId ASCENDING, action ASCENDING, updatedAt DESCENDING',
        'history: cityId ASCENDING, entity ASCENDING, updatedAt DESCENDING',
        'history: cityId ASCENDING, entity ASCENDING, action ASCENDING, updatedAt DESCENDING',
    ])('happyPath_historysRecentChangesHaveTheirCollectionGroupIndex_%s', (wanted) => {
        expect(config.indexes.filter((index) => index.queryScope === 'COLLECTION_GROUP').map(signature)).toContain(wanted);
    });

    it('badPath_everyCollectionGroupIndexStartsWithTheCity', () => {
        const unscoped = config.indexes
            .filter((index) => index.queryScope === 'COLLECTION_GROUP' && index.fields[0]?.fieldPath !== 'cityId')
            .map(signature);

        expect(unscoped).toEqual([]);
    });

    it('badPath_noIndexIsDeclaredTwice', () => {
        const signatures = config.indexes.map((index) => `${index.queryScope} ${signature(index)}`);

        expect(new Set(signatures).size).toBe(signatures.length);
    });
});

describe('single-field exemptions', () => {
    // No override adds an index: the recent changes, filtered by city, use the composite indexes above (CR-M2c-14).
    it.each(config.fieldOverrides.map((override) => [`${override.collectionGroup}.${override.fieldPath}`, override] as const))(
        'happyPath_%s_isASchemaFieldWithoutIndexes',
        (_name, override) => {
            expect(fieldsOf(override.collectionGroup)).toContain(override.fieldPath);
            expect(override.indexes).toEqual([]);
        },
    );

    it('badPath_noCompositeIndexUsesAnExemptField', () => {
        const exempt = new Set(
            config.fieldOverrides
                .filter((override) => override.indexes.length === 0)
                .map((override) => `${override.collectionGroup}.${override.fieldPath}`),
        );
        const clashes = config.indexes.flatMap((index) =>
            index.fields.filter((field) => exempt.has(`${index.collectionGroup}.${field.fieldPath}`)).map(() => signature(index)),
        );

        expect(clashes).toEqual([]);
    });

    it('badPath_unknownCollectionsHaveNoFields', () => {
        expect(fieldsOf('gcps')).toEqual([]);
    });
});
