/** Field comparison of stored documents (`functions/src/history/diff.ts`): what a history entry calls a change. */
import { timestampFromDate } from '@hcm/shared';
import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import { changedKeys, sameValue } from '../../src/history/diff.js';

const INSTANT = new Date('2026-10-12T08:30:00.123Z');

describe('sameValue', () => {
    it.each([
        ['a Firestore timestamp and the plain one of the same instant', Timestamp.fromDate(INSTANT), timestampFromDate(INSTANT)],
        ['equal maps in another key order', { ro: 'Unu', en: 'One' }, { en: 'One', ro: 'Unu' }],
        ['equal lists of maps', [{ lat: 44.4, lng: 26.1 }], [{ lat: 44.4, lng: 26.1 }]],
        ['two NaN', Number.NaN, Number.NaN],
        ['an absent field and undefined', undefined, undefined],
    ])('happyPath_%s_areTheSame', (_case, a, b) => {
        expect(sameValue(a, b)).toBe(true);
    });

    it.each([
        ['two instants a nanosecond apart', new Timestamp(1, 0), new Timestamp(1, 1)],
        ['a timestamp and a map', timestampFromDate(INSTANT), { seconds: '1' }],
        ['lists of another length', [1, 2], [1]],
        ['lists with another element', [1, 2], [1, 3]],
        ['a map with another value', { ro: 'Unu' }, { ro: 'Doi' }],
        ['a map and a list', {}, []],
        ['zero and minus zero', 0, -0],
        ['null and a map', null, {}],
    ])('badPath_%s_differ', (_case, a, b) => {
        expect(sameValue(a, b)).toBe(false);
    });
});

describe('changedKeys', () => {
    it('happyPath_listsTheTopLevelKeysThatDifferSorted', () => {
        const before = { title: { ro: 'Unu' }, published: false, year: 1930, updatedAt: Timestamp.fromDate(INSTANT) };
        const after = { title: { ro: 'Doi' }, published: false, yearEnd: 1940, updatedAt: timestampFromDate(INSTANT) };

        expect(changedKeys(before, after)).toEqual(['title', 'year', 'yearEnd']);
        expect(changedKeys(after, after)).toEqual([]);
    });
});
