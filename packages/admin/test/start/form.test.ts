import { describe, expect, it } from 'vitest';

import {
    areaProblem,
    censusBoxOf,
    cityIdProblem,
    EMPTY_FORM,
    nextProjectId,
    planOf,
    projectIdProblem,
    suggestProjectId,
    withCityId,
    withName,
} from '../../src/start/form.js';

const COMPLETE = { ...withName(EMPTY_FORM, 'Fostul Bacău'), area: { west: '26.85', south: '46.5', east: '26.98', north: '46.62' } };

describe('the start form', () => {
    it('happyPath_theNameLeadsTheIdsUntilTheOwnerTypesThem', () => {
        expect(COMPLETE).toMatchObject({ cityId: 'fostul-bacau', displayName: 'Fostul Bacau', projectId: 'harta-fostul-bacau' });
        const typed = withCityId(COMPLETE, 'bacau');
        expect(typed).toMatchObject({ cityId: 'bacau', projectId: 'harta-bacau' });
        expect(withName(typed, 'Alt nume')).toMatchObject({ cityId: 'bacau' });
    });

    it.each([
        ['Sf. Gheorghe', 'Sf Gheorghe'],
        ['Cluj, vechi!', 'Cluj vechi!'],
        ['Târgu Mureș', 'Targu Mures'],
        ['București și împrejurimile lui, cele vechi', 'Bucuresti si imprejurimile lui'],
    ])('badPath_aNameGoogleWouldRefuseIsCleaned_%s', (name, displayName) => {
        const form = withName(EMPTY_FORM, name);
        expect(form.displayName).toBe(displayName);
        expect(planOf({ ...form, cityId: 'oras', projectId: 'harta-oras' })?.displayName).toBe(displayName);
    });

    it('happyPath_theCensusSearchesTheRectangleOnlyOnceItCanBeACity', () => {
        expect(censusBoxOf(COMPLETE)).toEqual([26.85, 46.5, 26.98, 46.62]);
        expect(censusBoxOf(EMPTY_FORM)).toBeNull();
        expect(censusBoxOf({ ...COMPLETE, area: { ...COMPLETE.area, east: '40' } })).toBeNull();
    });

    it('edge_aNameLeftTooShortTakesTheProjectsId', () => {
        expect(planOf({ ...withName(EMPTY_FORM, '.,;'), cityId: 'oras', projectId: 'harta-oras' })?.displayName).toBe('harta-oras');
    });

    it('badPath_aDecimalCommaIsADecimalPoint', () => {
        const comma = { ...COMPLETE, area: { west: '26,85', south: '46,5', east: '26,98', north: '46,62' } };
        expect(areaProblem(comma)).toBeNull();
        expect(planOf(comma)?.city.bounds).toEqual({ west: 26.85, south: 46.5, east: 26.98, north: 46.62 });
    });

    it('badPath_whatIsNoNumberIsSaidSo', () => {
        expect(areaProblem({ ...COMPLETE, area: { ...COMPLETE.area, west: 'vest' } })).toBe('start.plan.areaNumber');
        expect(areaProblem({ ...COMPLETE, area: { ...COMPLETE.area, west: '' } })).toBe('start.plan.areaIncomplete');
    });

    it('happyPath_anEmptiedNameEmptiesWhatFollowedIt', () => {
        expect(withName(COMPLETE, '  ')).toMatchObject({ cityId: '', displayName: '' });
        expect(withName(withCityId(COMPLETE, 'bacau'), '')).toMatchObject({ cityId: 'bacau' });
    });

    it('happyPath_thePlanCarriesTheCityAndItsRectangle', () => {
        expect(planOf({ ...COMPLETE, nameEn: 'Old Bacău' })).toMatchObject({
            projectId: 'harta-fostul-bacau',
            create: true,
            city: { id: 'fostul-bacau', name: { ro: 'Fostul Bacău', en: 'Old Bacău' }, bounds: { west: 26.85, north: 46.62 } },
        });
        expect(planOf(withName(EMPTY_FORM, 'Bacău'))?.city).not.toHaveProperty('bounds');
    });

    it('happyPath_anExistingProjectIsThePickedOne', () => {
        const plan = planOf({ ...COMPLETE, create: false, picked: 'my-project-1', displayName: 'ab' });
        expect(plan).toMatchObject({ projectId: 'my-project-1', create: false, displayName: 'my-project-1' });
    });

    it.each([
        [{ west: '1', south: '', east: '', north: '' }, 'start.plan.areaIncomplete'],
        [{ west: 'x', south: '1', east: '2', north: '3' }, 'start.plan.areaNumber'],
        [{ west: '2', south: '1', east: '1', north: '3' }, 'start.plan.areaBounds'],
        [{ west: '1', south: '1', east: '1.001', north: '1.001' }, 'start.plan.areaTooSmall'],
        [{ west: '1', south: '1', east: '9', north: '2' }, 'start.plan.areaTooBig'],
    ])('badPath_aRectangleThatIsNoCity_%j', (area, key) => {
        const form = { ...COMPLETE, area };
        expect(areaProblem(form)).toBe(key);
        expect(planOf(form)).toBeNull();
    });

    it('badPath_idsThatCannotBe', () => {
        expect(cityIdProblem({ ...COMPLETE, cityId: 'engine' })).toBe('start.plan.cityIdInvalid');
        expect(cityIdProblem({ ...COMPLETE, cityId: '' })).toBeNull();
        expect(cityIdProblem(COMPLETE)).toBeNull();
        expect(projectIdProblem({ ...COMPLETE, projectId: 'Nu E Bun' })).toBe('start.plan.projectIdInvalid');
        expect(projectIdProblem({ ...COMPLETE, projectId: '' })).toBeNull();
        expect(projectIdProblem({ ...COMPLETE, projectId: 'Nu E Bun', create: false })).toBeNull();
        expect(planOf({ ...COMPLETE, projectId: 'Nu E Bun' })).toBeNull();
    });

    it('edge_aLongOrShortIdStillMakesAProjectId', () => {
        expect(suggestProjectId('a'.repeat(23) + '-b')).toBe(`harta-${'a'.repeat(23)}`.slice(0, 29));
        expect(suggestProjectId('')).toBe('harta-oras');
        expect(nextProjectId('fostul-bacau')).toBe('fostul-bacau-2');
        expect(nextProjectId('fostul-bacau-2')).toBe('fostul-bacau-3');
    });
});
