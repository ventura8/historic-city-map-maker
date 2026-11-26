import { describe, expect, test } from 'vitest';

import { adminPartFrom, excludedPositions, inPart, shardRangeFrom, shardRangeOf, sliceBounds, type QueuedTest } from '../split.js';

/** e2e/split.ts: how a split run takes its part of the queue (scripts/ci/e2e-split.sh, DECISIONS-for-review.md §32f). */

describe('shardRangeOf', () => {
    test('happyPath_oneSliceOrARange', () => {
        expect(shardRangeOf('2/3')).toEqual({ first: 2, last: 2, total: 3 });
        expect(shardRangeOf('1-3/5')).toEqual({ first: 1, last: 3, total: 5 });
    });

    test.each(['', 'x', '0/3', '4/3', '3-2/5', '1-6/5', '1/0'])('badPath_refuses_%s', (value) => {
        expect(() => shardRangeOf(value)).toThrow(`got "${value}"`);
    });
});

describe('shardRangeFrom', () => {
    test('happyPath_unsetOrEmptyIsTheWholeQueue', () => {
        expect(shardRangeFrom(undefined)).toBeNull();
        expect(shardRangeFrom('')).toBeNull();
        expect(shardRangeFrom('4-5/5')).toEqual({ first: 4, last: 5, total: 5 });
    });
});

describe('adminPartFrom', () => {
    test('happyPath_aPartOrNone', () => {
        expect(adminPartFrom(undefined)).toBeNull();
        expect(adminPartFrom('')).toBeNull();
        expect(adminPartFrom('2/2')).toEqual({ first: 2, last: 2, total: 2 });
        expect(adminPartFrom('1-2/3')).toEqual({ first: 1, last: 2, total: 3 });
    });

    test.each(['1', '0/2', '3/2', '2-1/2', 'a/b'])('badPath_refuses_%s', (value) => {
        expect(() => adminPartFrom(value)).toThrow(
            `E2E_ADMIN_PART must be "index/total" or "first-last/total" within 1..total, got "${value}"`,
        );
    });
});

describe('inPart', () => {
    test('happyPath_roundRobin', () => {
        const positions = [0, 1, 2, 3, 4];
        expect(positions.filter((position) => inPart(position, { first: 1, last: 1, total: 2 }))).toEqual([0, 2, 4]);
        expect(positions.filter((position) => inPart(position, { first: 2, last: 2, total: 2 }))).toEqual([1, 3]);
        expect(positions.filter((position) => inPart(position, { first: 1, last: 2, total: 3 }))).toEqual([0, 1, 3, 4]);
        expect(positions.filter((position) => inPart(position, { first: 3, last: 3, total: 3 }))).toEqual([2]);
        expect(positions.filter((position) => inPart(position, null))).toEqual(positions);
    });
});

describe('sliceBounds', () => {
    test('happyPath_theSlicesOfBothMachinesMeet', () => {
        const head = sliceBounds(613, { first: 1, last: 3, total: 5 });
        const tail = sliceBounds(613, { first: 4, last: 5, total: 5 });
        expect(head.from).toBe(0);
        expect(head.to).toBe(tail.from);
        expect(tail.to).toBe(613);
    });

    test('badPath_anEmptyQueueHasEmptySlices', () => {
        expect(sliceBounds(0, { first: 1, last: 1, total: 2 })).toEqual({ from: 0, to: 0 });
    });
});

describe('excludedPositions', () => {
    const queue: QueuedTest[] = [
        { dependency: true, tier: 'setup' },
        { dependency: true, tier: 'admin' },
        { dependency: false, tier: 'admin' },
        { dependency: false, tier: 'smoke' },
        { dependency: false, tier: 'tour' },
        { dependency: false, tier: 'fn' },
        { dependency: false, tier: 'fn' },
    ];

    test('happyPath_theAdminAndDependencyTestsStayAndTheOthersAreSliced', () => {
        const head = excludedPositions(queue, { first: 1, last: 1, total: 2 });
        const tail = excludedPositions(queue, { first: 2, last: 2, total: 2 });
        expect(head).toEqual([5, 6]);
        expect(tail).toEqual([3, 4]);
    });

    test('badPath_aQueueOfAdminTestsOnlyExcludesNothing', () => {
        expect(excludedPositions(queue.slice(0, 3), { first: 2, last: 2, total: 2 })).toEqual([]);
    });
});
