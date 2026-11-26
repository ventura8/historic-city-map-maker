/**
 * Linking a layer to a tileset or tile server that already exists (`docs/research/M2c-interfaces.md` §8.1, CR-M2c-27;
 * behaviour A15): the admin pastes a Mapbox tileset id (`owner.name`, or `mapbox://owner.name`) or an https tile address
 * with `{z}`, `{x}` and `{y}`, names the layer and its year, and `layers.link` creates it unpublished. The dialog checks
 * what the server checks before anything is sent (a tileset of another Mapbox account, a credential in the address, the
 * schema), and names the origins the public site's CSP must allow for a tile server.
 */
import {
    layerLinkRequestSchema,
    layerSourceRefusal,
    sourceOrigins,
    validate,
    type ApiErrorCode,
    type LayerKind,
    type LayerLinkRequest,
    type LayerSource,
    type ValidationIssue,
} from '@hcm/shared';

/** What the admin typed; numbers stay text until the request is built (a half-typed year is not an error yet). */
export interface LinkForm {
    readonly address: string;
    readonly tileSize: 256 | 512;
    readonly labelRo: string;
    readonly labelEn: string;
    readonly year: string;
    readonly kind: LayerKind;
    readonly attribution: string;
}

export const EMPTY_LINK_FORM: LinkForm = { address: '', tileSize: 256, labelRo: '', labelEn: '', year: '', kind: 'map', attribution: '' };

const MAPBOX_URL = /^mapbox:\/\//;
const TILESET = /^[a-z0-9_-]{1,32}\.[A-Za-z0-9_-]{1,64}$/;

/** The source an address names: a Mapbox tileset by its id, else a tile template (validated by the request's schema). */
export function sourceOf(address: string, tileSize: 256 | 512): LayerSource {
    const trimmed = address.trim().replace(MAPBOX_URL, '');
    return TILESET.test(trimmed) ? { type: 'mapbox', tilesetId: trimmed } : { type: 'xyz', tiles: [address.trim()], tileSize };
}

function optionalText(text: string): string | undefined {
    const trimmed = text.trim();
    return trimmed === '' ? undefined : trimmed;
}

/** The year as typed, as a number (NaN for anything else: the schema then names the field). */
function yearOf(text: string): number {
    return /^\d{1,4}$/.test(text.trim()) ? Number(text.trim()) : Number.NaN;
}

/** The request as the form stands (unvalidated; `linkCheck` validates it). */
export function linkRequestOf(cityId: string, form: LinkForm): Record<string, unknown> {
    const en = optionalText(form.labelEn);
    const attribution = optionalText(form.attribution);
    return {
        cityId,
        source: sourceOf(form.address, form.tileSize),
        label: en === undefined ? { ro: form.labelRo.trim() } : { ro: form.labelRo.trim(), en },
        year: yearOf(form.year),
        kind: form.kind,
        ...(attribution === undefined ? {} : { attribution }),
    };
}

export type LinkCheck =
    | { readonly ok: true; readonly request: LayerLinkRequest; readonly origins: readonly string[] }
    | { readonly ok: false; readonly issues: readonly ValidationIssue[]; readonly refusal: LinkRefusal | null };

export interface LinkRefusal {
    readonly code: ApiErrorCode;
    readonly params?: Readonly<Record<string, string>>;
}

/** Issues at the form's fields: `source.tiles.0` and `source.tilesetId` are the address, `label.ro` the Romanian name. */
function formIssues(issues: readonly ValidationIssue[]): ValidationIssue[] {
    return issues.map((issue) => ({ ...issue, path: issue.path.startsWith('source') ? 'address' : issue.path }));
}

/**
 * Whether the form may be sent: the request's schema, then the policy of `layerSourceRefusal` for a city whose Mapbox
 * account is `mapboxUser` (null before Mapbox is set up). A tile server's origins come back for the CSP note.
 */
export function linkCheck(cityId: string, form: LinkForm, mapboxUser: string | null): LinkCheck {
    const result = validate(layerLinkRequestSchema, linkRequestOf(cityId, form));
    if (!result.ok) {
        return { ok: false, issues: formIssues(result.issues), refusal: null };
    }
    const refusal = layerSourceRefusal(result.value.source, mapboxUser);
    if (refusal !== null) {
        return { ok: false, issues: [{ path: 'address', code: 'validation.value' }], refusal };
    }
    return { ok: true, request: result.value, origins: sourceOrigins(result.value.source) };
}
