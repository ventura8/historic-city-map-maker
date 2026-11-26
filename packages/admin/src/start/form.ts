/**
 * The start page's form (`docs/research/M14-start-your-map.md` §8): the city's names, its id and rectangle, and the
 * project. What it says about a value is the New city flow's own rule (`isUsableCityId`, `cityBoundsProblem`); the plan
 * is what the deploy takes.
 */
import { PROJECT_ID_PATTERN, cityBoundsProblem, isUsableCityId, suggestCityId, type CityBounds, type StartKey } from '@hcm/shared';

import { parsePlan, PROJECT_NAME_CHARACTERS, type StartPlan } from './plan.js';

const AREA_EDGES = ['west', 'south', 'east', 'north'] as const;

export type AreaEdge = (typeof AREA_EDGES)[number];

export interface StartForm {
    readonly nameRo: string;
    readonly nameEn: string;
    readonly cityId: string;
    readonly cityIdEdited: boolean;
    readonly area: Readonly<Record<AreaEdge, string>>;
    /** A new project, or one the owner has. */
    readonly create: boolean;
    readonly displayName: string;
    readonly projectId: string;
    readonly projectIdEdited: boolean;
    /** The id picked from the owner's projects. */
    readonly picked: string;
}

export const EMPTY_FORM: StartForm = {
    nameRo: '',
    nameEn: '',
    cityId: '',
    cityIdEdited: false,
    area: { west: '', south: '', east: '', north: '' },
    create: true,
    displayName: '',
    projectId: '',
    projectIdEdited: false,
    picked: '',
};

const MAX_PROJECT_ID = 30;
const MIN_PROJECT_ID = 6;
const DISPLAY_NAME_MAX = 30;
const MIN_DISPLAY_NAME = 4;
/** A project's id for a city: the shape `PROJECT_ID_PATTERN` asks, from the city's own id. */
const PROJECT_PREFIX = 'harta-';

function withoutTrailingHyphens(text: string): string {
    return text.endsWith('-') ? withoutTrailingHyphens(text.slice(0, -1)) : text;
}

/** A project's id for the city's id, when the owner typed none. */
export function suggestProjectId(cityId: string): string {
    const body = withoutTrailingHyphens(`${PROJECT_PREFIX}${cityId}`.slice(0, MAX_PROJECT_ID));
    return body.length >= MIN_PROJECT_ID ? body : `${PROJECT_PREFIX}oras`;
}

const NOT_IN_A_PROJECT_NAME = new RegExp(`[^${PROJECT_NAME_CHARACTERS}]+`, 'g');

/** The project's display name for a city's: Google's characters only (`Sf. Gheorghe` is `Sf Gheorghe`), within its length. */
function projectDisplayName(name: string): string {
    const clean = name.normalize('NFD').replace(/\p{M}/gu, '').replace(NOT_IN_A_PROJECT_NAME, ' ').replace(/ {2,}/g, ' ');
    return clean.trim().slice(0, DISPLAY_NAME_MAX).trim();
}

/** The form after the Romanian name changes: what follows it, unless the owner typed it. */
export function withName(form: StartForm, nameRo: string): StartForm {
    if (nameRo.trim() === '') {
        return { ...form, nameRo, displayName: '', cityId: form.cityIdEdited ? form.cityId : '' };
    }
    const cityId = form.cityIdEdited ? form.cityId : suggestCityId(nameRo);
    return {
        ...form,
        nameRo,
        cityId,
        displayName: projectDisplayName(nameRo),
        projectId: form.projectIdEdited ? form.projectId : suggestProjectId(cityId),
    };
}

export function withCityId(form: StartForm, cityId: string): StartForm {
    return {
        ...form,
        cityId,
        cityIdEdited: true,
        projectId: form.projectIdEdited ? form.projectId : suggestProjectId(cityId),
    };
}

type AreaFields =
    | { readonly kind: 'empty' | 'partial' | 'notNumber'; readonly bounds?: undefined }
    | { readonly kind: 'area'; readonly bounds: CityBounds };

/** An edge as a number: a decimal comma, which a Romanian keyboard offers, is a decimal point. */
const edgeNumber = (text: string): number => Number(text.replace(',', '.'));

/** The rectangle's four fields as numbers: `empty` when all four are blank, `partial` when some are. */
function areaOf(form: StartForm): AreaFields {
    const texts = AREA_EDGES.map((edge) => form.area[edge].trim());
    if (texts.every((text) => text === '')) {
        return { kind: 'empty' };
    }
    if (texts.includes('')) {
        return { kind: 'partial' };
    }
    const numbers = texts.map(edgeNumber);
    if (!numbers.every(Number.isFinite)) {
        return { kind: 'notNumber' };
    }
    const [west, south, east, north] = numbers as [number, number, number, number];
    return { kind: 'area', bounds: { west, south, east, north } };
}

const AREA_PROBLEMS: Readonly<Record<NonNullable<ReturnType<typeof cityBoundsProblem>>, StartKey>> = {
    'validation.bounds': 'start.plan.areaBounds',
    'validation.tooSmall': 'start.plan.areaTooSmall',
    'validation.tooBig': 'start.plan.areaTooBig',
};

const AREA_FIELD_PROBLEMS: Readonly<Record<'empty' | 'partial' | 'notNumber', StartKey | null>> = {
    empty: null,
    partial: 'start.plan.areaIncomplete',
    notNumber: 'start.plan.areaNumber',
};

/** Why the rectangle cannot be a city, or null. */
export function areaProblem(form: StartForm): StartKey | null {
    const { kind, bounds } = areaOf(form);
    if (kind !== 'area') {
        return AREA_FIELD_PROBLEMS[kind];
    }
    const problem = cityBoundsProblem(bounds);
    return problem === null ? null : AREA_PROBLEMS[problem];
}

/** The rectangle as the imagery census takes it (M29), once it can be a city; null before. */
export function censusBoxOf(form: StartForm): readonly [number, number, number, number] | null {
    const { bounds } = areaOf(form);
    return bounds === undefined || areaProblem(form) !== null ? null : [bounds.west, bounds.south, bounds.east, bounds.north];
}

export function cityIdProblem(form: StartForm): StartKey | null {
    return form.cityId === '' || isUsableCityId(form.cityId) ? null : 'start.plan.cityIdInvalid';
}

export function projectIdProblem(form: StartForm): StartKey | null {
    return !form.create || form.projectId === '' || PROJECT_ID_PATTERN.test(form.projectId) ? null : 'start.plan.projectIdInvalid';
}

function displayNameOf(form: StartForm, id: string): string {
    const name = form.displayName.trim();
    return name.length >= MIN_DISPLAY_NAME ? name : id.slice(0, DISPLAY_NAME_MAX);
}

/** The plan the form makes, or null while something is missing or wrong. */
export function planOf(form: StartForm): StartPlan | null {
    const area = areaOf(form);
    if (areaProblem(form) !== null) {
        return null;
    }
    const projectId = form.create ? form.projectId : form.picked;
    const nameEn = form.nameEn.trim();
    return parsePlan({
        projectId,
        displayName: displayNameOf(form, projectId),
        create: form.create,
        city: {
            id: form.cityId,
            name: nameEn === '' ? { ro: form.nameRo.trim() } : { ro: form.nameRo.trim(), en: nameEn },
            ...(area.bounds === undefined ? {} : { bounds: area.bounds }),
        },
    });
}

/** A free id to offer after a taken one (§3): the same with the next number. */
export function nextProjectId(projectId: string): string {
    const match = /^(.*?)-(\d+)$/.exec(projectId);
    const stem = (match?.[1] ?? projectId).slice(0, MAX_PROJECT_ID - 3);
    return `${stem}-${String(Number(match?.[2] ?? 1) + 1)}`;
}
