import '../global-options.js';

import {
    CITY_ICON_LIMITS,
    FIRESTORE_PATHS,
    cityDocSchema,
    type ApiErrorCode,
    type CallableRequest,
    type CallableResponse,
} from '@hcm/shared';
import { mapIconSvg } from '@hcm/shared/tab-icon';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import { iconSeedOf, iconStamp, recordCityIcon, storeCityIcon, type CityIconDeps } from '../api/city-icon.js';
import type { ImageInspection, IconSource } from '../ports/image-processor.js';
import type { Ports } from '../ports/index.js';

export type SetIconDeps = CityIconDeps & Pick<Ports, 'log'>;

const ACCEPTED: ReadonlySet<string> = new Set(CITY_ICON_LIMITS.contentTypes);

/** `1 MB`, as the message names the limit. */
const MAX_TEXT = `${String(CITY_ICON_LIMITS.maxBytes / 1_000_000)} MB`;

type Problem = readonly [ApiErrorCode, Readonly<Record<string, string>>];

/** What is wrong with the image's size, or undefined: too small, too large. */
function sizeProblem(short: number, long: number): Problem | undefined {
    if (short < CITY_ICON_LIMITS.minSide) {
        return ['apiError.cityIcon.tooSmall', { min: String(CITY_ICON_LIMITS.minSide) }];
    }
    return long > CITY_ICON_LIMITS.maxSide ? ['apiError.cityIcon.tooLarge', { max: String(CITY_ICON_LIMITS.maxSide) }] : undefined;
}

/** What is wrong with the image's shape, or undefined: its size, not square enough, animated. */
function shapeProblem(image: ImageInspection): Problem | undefined {
    const short = Math.min(image.width, image.height);
    const long = Math.max(image.width, image.height);
    const sized = sizeProblem(short, long);
    if (sized !== undefined) {
        return sized;
    }
    if (long / short > CITY_ICON_LIMITS.maxRatio) {
        return ['apiError.cityIcon.notSquare', {}];
    }
    return (image.frames ?? 1) > 1 ? ['apiError.cityIcon.animated', {}] : undefined;
}

/** The type the bytes are, from their magic numbers: an unreadable file is `invalid`, anything but PNG or WebP `badType`. */
async function inspected(deps: SetIconDeps, bytes: Uint8Array): Promise<ImageInspection> {
    const image = await deps.images.inspect(bytes).catch(() => {
        throw new ApiError('apiError.cityIcon.invalid');
    });
    if (image.contentType === undefined || !ACCEPTED.has(image.contentType)) {
        throw new ApiError('apiError.cityIcon.badType');
    }
    return image;
}

/** The upload's bytes, once they are a PNG or a WebP of an icon's shape (never trusting a name or a declared type). */
async function checkedUpload(deps: SetIconDeps, base64: string): Promise<Uint8Array> {
    const bytes = new Uint8Array(Buffer.from(base64, 'base64'));
    if (bytes.length > CITY_ICON_LIMITS.maxBytes) {
        throw new ApiError('apiError.cityIcon.tooBig', { max: MAX_TEXT });
    }
    const problem = shapeProblem(await inspected(deps, bytes));
    if (problem !== undefined) {
        throw new ApiError(problem[0], problem[1]);
    }
    return bytes;
}

type Request = CallableRequest<'cities.setIcon'>;

/** What the icon is drawn from: the checked upload, or the default in the city's seed colour (our own SVG). */
async function sourceOf(deps: SetIconDeps, request: Request, seed: string): Promise<IconSource> {
    return request.kind === 'reset' ? { ownSvg: mapIconSvg(seed) } : { upload: await checkedUpload(deps, request.image) };
}

/**
 * `cities.setIcon` (a city's editors; `docs/research/M2-interfaces.md` → *The city's tab icon*; S-A101-*): the city's
 * browser tab icon. An upload is checked from its bytes (PNG or WebP, at most 1 MB, at least 192 px, at most 4096 px,
 * nearly square, one frame) before anything is written; it is fitted inside a square (never cropped) and written as
 * PNGs at 32, 180 and 512 px over the previous ones. A `reset` draws the default again: the Layers panel's map glyph in the
 * city's seed colour. The record goes on `cities/{city}.icon`, which no client may write. A missing city →
 * `apiError.notFound`; a refused image changes nothing.
 */
async function citiesSetIcon(deps: SetIconDeps, caller: VerifiedCaller, request: Request): Promise<CallableResponse<'cities.setIcon'>> {
    const city = await deps.documents.get(FIRESTORE_PATHS.city(request.cityId), cityDocSchema);
    if (city === undefined) {
        throw new ApiError('apiError.notFound');
    }
    const seed = iconSeedOf(city);
    const custom = request.kind === 'upload';
    const stored = await storeCityIcon(deps, request.cityId, await sourceOf(deps, request, seed));
    const icon = custom
        ? { source: 'custom' as const, ...stored, ...iconStamp(deps, caller.uid) }
        : { source: 'default' as const, seedColor: seed, ...stored, ...iconStamp(deps, caller.uid) };
    if (!(await recordCityIcon(deps, request.cityId, icon))) {
        throw new ApiError('apiError.notFound');
    }
    deps.log.info('city icon set', { uid: caller.uid, cityId: request.cityId, source: icon.source });
    return { source: icon.source, url: stored.url, sha256: stored.sha256 };
}

/** The `cities-setIcon` callable. */
export function setIconFunction(getDeps: () => SetIconDeps & CallableDeps) {
    return defineCallable('cities.setIcon', citiesSetIcon, getDeps);
}
