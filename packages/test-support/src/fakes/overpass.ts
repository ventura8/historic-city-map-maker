import { fixtureResponse, type FixtureName } from '../api-fixtures/index.js';
import { jsonResponse, route, type Route } from './routes.js';
import type { FailureMode, ServiceFake } from './service.js';

/**
 * OpenStreetMap data from the Overpass API (docs/research/M3-interfaces.md §5.5, §13): the pipeline's `reference` step
 * asks once for the window's highways, railways, waterways and water areas (`[out:json]`, `out geom`) and draws them. The
 * answer is a few of Bucharest's lines (`overpass/interpreter.bucharest.json`), or the synthetic world's when the e2e
 * world registers it; rate limiting (429) and an overloaded server (504) are failure modes. Called by the pipeline only.
 */

export interface OverpassState {
    /** The OSM JSON to answer instead of the fixture's (the synthetic world's lines), or undefined. */
    answer: (() => unknown) | undefined;
}

const INTERPRETER = 'https://overpass-api.de/api/interpreter';

const FAILURES: Readonly<Partial<Record<FailureMode, FixtureName>>> = {
    rateLimited: 'overpass/error.rate-limited',
    unavailable: 'overpass/error.unavailable',
};

/** The fake Overpass API. */
export function createOverpassFake(state: OverpassState): ServiceFake {
    const interpret: Route['answer'] = async () =>
        state.answer === undefined ? fixtureResponse('overpass/interpreter.bucharest') : jsonResponse(await state.answer());
    return {
        name: 'overpass',
        routes: [
            route('POST', INTERPRETER, 'overpass.interpreter', interpret),
            route('GET', INTERPRETER, 'overpass.interpreter.get', interpret),
        ],
        failure: (mode) => {
            const name = FAILURES[mode];
            return name === undefined ? undefined : fixtureResponse(name);
        },
        scenarios: {},
        snapshot: () => ({ custom: state.answer !== undefined }),
    };
}
