import { describe, expect, it } from 'vitest';

import { asRecord, at, lastSegment, list, matchesSpec, records, sameJson, sameSet, stringAt, strings } from '../../src/google/json.js';

/** Reading Google's answers without trusting their shape. */

describe('json helpers', () => {
    it('happyPath_pathsArraysAndNames', () => {
        const body = { a: { b: 'c' }, items: ['x', 1, { y: 2 }] };

        expect(at(body, 'a', 'b')).toBe('c');
        expect(stringAt(body, 'a', 'b')).toBe('c');
        expect(strings(body.items)).toEqual(['x']);
        expect(records(body.items)).toEqual([{ y: 2 }]);
        expect(lastSegment('projects/1/keys/abc')).toBe('abc');
    });

    it('badPath_anythingUnexpectedIsUndefinedOrEmpty', () => {
        expect(at('text', 'a')).toBeUndefined();
        expect(at({ a: [1] }, 'a', '0')).toBeUndefined();
        expect(stringAt({ a: 1 }, 'a')).toBeUndefined();
        expect(list({ not: 'a list' })).toEqual([]);
        expect(asRecord(['not', 'an object'])).toEqual({});
        expect(asRecord({ a: 1 })).toEqual({ a: 1 });
    });

    it('happyPath_aSpecMatchesWhateverGoogleAddedAroundIt', () => {
        const spec = { filter: { projects: ['p'] }, rules: [{ percent: 0.5 }] };
        const stored = { filter: { projects: ['p'], credits: 'ALL' }, rules: [{ percent: 0.5, basis: 'CURRENT' }], etag: 'x' };

        expect(matchesSpec(stored, spec)).toBe(true);
        expect(matchesSpec({ ...stored, rules: [{ percent: 0.9 }] }, spec)).toBe(false);
        expect(matchesSpec(undefined, spec)).toBe(false);
        expect(sameJson({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    });

    it('badPath_setsDifferInLengthOrMembers', () => {
        expect(sameSet(['a', 'b'], ['b', 'a'])).toBe(true);
        expect(sameSet(['a'], ['a', 'b'])).toBe(false);
        expect(sameSet(['a', 'c'], ['a', 'b'])).toBe(false);
    });
});
