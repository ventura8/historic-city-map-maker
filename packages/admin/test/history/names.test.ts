import { describe, expect, it } from 'vitest';

import type { ContentStore } from '../../src/content/services.js';
import type { HistoryItem } from '../../src/history/entries.js';
import { CreatedNames } from '../../src/history/names.js';
import { CITY } from '../content/world.js';

function item(overrides: Partial<HistoryItem>): HistoryItem {
    return {
        ...{ entryId: 'e', path: 'p', entity: 'poi', entityId: 'gara', action: 'update', changedFields: ['title'], by: 'u', at: '' },
        ...{ revertOf: null, previous: { title: { ro: 'Gara veche' } }, name: { ro: 'Gara veche' } },
        ...overrides,
    };
}

const CREATED = { action: 'create', previous: null, name: null, changedFields: [] } as const;

/** A store whose reads answer when the test says; it counts the listeners attached and stopped. */
function heldStore(): {
    readonly store: Pick<ContentStore, 'watchDoc'>;
    readonly answer: (path: string, data: Readonly<Record<string, unknown>> | null | 'fail') => void;
    readonly attached: string[];
    readonly stopped: string[];
} {
    const attached: string[] = [];
    const stopped: string[] = [];
    const pending = new Map<string, (data: Readonly<Record<string, unknown>> | null | 'fail') => void>();
    const store: Pick<ContentStore, 'watchDoc'> = {
        watchDoc: (path, _schema, listener, failed) => {
            attached.push(path);
            pending.set(path, (data) => {
                if (data === 'fail') {
                    failed({ kind: 'failed', code: 'internal' });
                    return;
                }
                listener(data === null ? null : { id: path, path, data: data as never, version: '', pending: false });
            });
            return () => {
                stopped.push(path);
            };
        },
    };
    return { store, answer: (path, data) => pending.get(path)?.(data), attached, stopped };
}

describe('CreatedNames', () => {
    it('happyPath_aCreationTakesTheNameOfTheVersionItMadeOrOfTheDocumentNow', () => {
        const held = heldStore();
        let changes = 0;
        const names = new CreatedNames(held.store, CITY, () => {
            changes += 1;
        });
        const items = [
            item({ entryId: 'rename', previous: { title: { ro: 'Gara veche', en: 'Old station' } } }),
            item({ entryId: 'made', ...CREATED }),
            item({ entryId: 'photo', entity: 'photo', entityId: 'foto', ...CREATED }),
        ];

        const first = names.named(items);
        expect(first.map((named) => named.name)).toEqual([{ ro: 'Gara veche' }, { ro: 'Gara veche', en: 'Old station' }, null]);
        expect(held.attached).toEqual([`cities/${CITY}/photos/foto`]);

        held.answer(`cities/${CITY}/photos/foto`, { title: { ro: 'Foto nouă' } });
        expect(changes).toBe(1);
        expect(held.stopped).toEqual([`cities/${CITY}/photos/foto`]);
        expect(names.named(items)[2]?.name).toEqual({ ro: 'Foto nouă' });
        // Read once: asking again reads nothing more.
        names.named(items);
        expect(held.attached).toHaveLength(1);
    });

    it('badPath_aGoneDocumentOrAFailedReadKeepsNoNameAndAClosedPageStopsWhatWaits', () => {
        const held = heldStore();
        const names = new CreatedNames(held.store, CITY, () => undefined);
        const items = [
            item({ entryId: 'gone', entityId: 'tram', ...CREATED }),
            item({ entryId: 'broken', entityId: 'moara', ...CREATED }),
            item({ entryId: 'waiting', entityId: 'han', ...CREATED }),
            item({ entryId: 'city', entity: 'city', entityId: CITY, ...CREATED }),
        ];

        names.named(items);
        names.named(items);
        held.answer(`cities/${CITY}/pois/tram`, null);
        held.answer(`cities/${CITY}/pois/moara`, 'fail');

        expect(names.named(items).map((named) => named.name)).toEqual([null, null, null, null]);
        names.stop();
        expect(held.attached).toEqual([
            `cities/${CITY}/pois/tram`,
            `cities/${CITY}/pois/moara`,
            `cities/${CITY}/pois/han`,
            `cities/${CITY}`,
        ]);
        expect(held.stopped.toSorted((a, b) => a.localeCompare(b))).toEqual(held.attached.toSorted((a, b) => a.localeCompare(b)));
    });

    it('happyPath_aStoreThatAnswersAtOnceIsStoppedAtOnce', () => {
        const stopped: string[] = [];
        const store: Pick<ContentStore, 'watchDoc'> = {
            watchDoc: (path, _schema, listener) => {
                listener({ id: 'x', path, data: { label: { ro: 'Biserici' } } as never, version: '', pending: false });
                return () => {
                    stopped.push(path);
                };
            },
        };
        const names = new CreatedNames(store, CITY, () => undefined);

        const named = names.named([item({ entity: 'poiCategory', entityId: 'biserici', ...CREATED })]);

        expect(named[0]?.name).toEqual({ ro: 'Biserici' });
        expect(stopped).toEqual([`cities/${CITY}/poiCategories/biserici`]);
    });
});
