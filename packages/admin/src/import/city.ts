import { cityDocSchema, validate, type CityDoc } from '@hcm/shared';
import { z } from 'zod';

/**
 * The bundled `legacy/<city>/city.json` (the seed manifest's city, manifest shape: `center` `[lng, lat]`, `bounds`
 * `[[w, s], [e, n]]`, its own id `bucuresti`) as the fields of the city document `setup.createCity` creates under the
 * project's city id (`infra/project.json`: `bucharest`; CR-M2b-1, CR-M2b-12). The viewer token and the analytics ids
 * are left out: the server writes them (`setup.saveMapbox`, `setup.analyticsConfig`). `imagery` holds the city's target
 * years (M8, `docs/research/M8-join-interfaces.md` §5): the build adds it, a seed manifest has none.
 */

export type LegacyCityFields = Pick<
    CityDoc,
    'name' | 'bounds' | 'center' | 'zoom' | 'minZoom' | 'maxZoom' | 'about' | 'privacy' | 'credits' | 'theme' | 'basemap' | 'imagery'
>;

const position = z.tuple([z.number(), z.number()]);

const manifestCitySchema = z.looseObject({
    center: position,
    bounds: z.tuple([position, position]),
});

/** The copied fields, as the manifest names them. */
const COPIED = ['name', 'zoom', 'minZoom', 'maxZoom', 'about', 'privacy', 'credits', 'theme', 'basemap', 'imagery'] as const;

/** A placeholder stamp and state: validation needs them; `setup.createCity` writes the real ones. */
const SERVER_OWNED = { published: false, updatedBy: 'legacy-import', updatedAt: { seconds: 0, nanoseconds: 0 } };

/** The city document fields of the bundled city, or undefined when it is not a city the document schema accepts. */
export function legacyCityFields(raw: unknown): LegacyCityFields | undefined {
    const parsed = manifestCitySchema.safeParse(raw);
    if (!parsed.success) {
        return undefined;
    }
    const { center, bounds } = parsed.data;
    const copied = Object.fromEntries(COPIED.filter((key) => parsed.data[key] !== undefined).map((key) => [key, parsed.data[key]]));
    const fields = {
        ...copied,
        center: { lng: center[0], lat: center[1] },
        bounds: { west: bounds[0][0], south: bounds[0][1], east: bounds[1][0], north: bounds[1][1] },
    };
    return validate(cityDocSchema, { ...fields, ...SERVER_OWNED }).ok ? (fields as LegacyCityFields) : undefined;
}
