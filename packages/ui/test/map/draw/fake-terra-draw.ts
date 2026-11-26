/**
 * A stand-in for Terra Draw's constructors (`TerraDrawModules`): a store of features, the four events, the id strategy
 * and the modes' options, with `drag` and `validate` playing the select mode the way Terra Draw 1.37 does (a drag sends
 * `change` `update` and ends with `finish`; a select-mode move is checked by the `validation` of the select flags). Like
 * the real store it refuses a polygon with holes (`ValidatePolygonFeature`) and throws on an update of another geometry
 * type. The real Terra Draw is driven by `terra-draw-real.test.ts`.
 */
import type {
    TdAddResult,
    TdFeature,
    TdFeatureId,
    TdFinishContext,
    TdInstance,
    TdModeOptions,
    TdOptions,
    TdStyles,
    TdValidation,
    TdValidationResult,
    TerraDrawModules,
} from '../../../src/map/draw/terra-draw-types.js';

type Listener = (...args: never[]) => void;

export class FakeMode {
    readonly kind: string;
    readonly options: TdModeOptions | undefined;

    constructor(kind: string, options?: TdModeOptions) {
        this.kind = kind;
        this.options = options;
    }
}

/** What Terra Draw's own store refuses: a polygon with holes (or without a ring). */
function refused(feature: TdFeature): boolean {
    return feature.geometry.type === 'Polygon' && (feature.geometry.coordinates as unknown[]).length !== 1;
}

export class FakeTerraDraw implements TdInstance {
    readonly options: TdOptions;
    readonly store = new Map<TdFeatureId, TdFeature>();
    readonly modes: string[] = [];
    readonly removed: TdFeatureId[][] = [];
    readonly updated: TdFeatureId[] = [];
    readonly styles = new Map<string, TdStyles>();
    started = false;
    stopped = false;
    selected: TdFeatureId | null = null;
    /** What `getFeaturesAtLngLat` answers (a test puts the feature under the pointer here). */
    near: TdFeatureId[] = [];
    /** Every `updateFeatureGeometry` throws (a mode that refuses the geometry). */
    failUpdates = false;
    readonly #listeners = new Map<string, Listener[]>();

    constructor(options: TdOptions) {
        this.options = options;
    }

    start(): void {
        this.started = true;
    }

    stop(): void {
        this.stopped = true;
    }

    setMode(mode: string): void {
        this.modes.push(mode);
    }

    get mode(): string | undefined {
        return this.modes.at(-1);
    }

    getSnapshot(): readonly TdFeature[] {
        return [...this.store.values()];
    }

    addFeatures(features: TdFeature[]): readonly TdAddResult[] {
        return features.map((feature) => {
            const id = feature.id ?? this.options.idStrategy.getId();
            if (!this.options.idStrategy.isValidId(id) || refused(feature)) {
                return { id, valid: false, reason: 'invalid' };
            }
            this.store.set(id, { ...feature, id });
            return { id, valid: true };
        });
    }

    hasFeature(id: TdFeatureId): boolean {
        return this.store.has(id);
    }

    updateFeatureGeometry(id: TdFeatureId, geometry: TdFeature['geometry']): void {
        const feature = this.store.get(id);
        if (feature?.geometry.type !== geometry.type || this.failUpdates) {
            throw new Error(`Feature validation failed: ${String(id)}`);
        }
        this.store.set(id, { ...feature, geometry });
        this.updated.push(id);
        this.#emit('change', [id], 'update', { origin: 'api' });
    }

    removeFeatures(ids: TdFeatureId[]): void {
        this.removed.push(ids);
        for (const id of ids) {
            this.store.delete(id);
        }
    }

    selectFeature(id: TdFeatureId): void {
        this.selected = id;
        this.#emit('select', id);
    }

    deselectFeature(id: TdFeatureId): void {
        this.selected = null;
        this.#emit('deselect', id);
    }

    setModeStyles(mode: string, styles: TdStyles): void {
        this.styles.set(mode, styles);
    }

    getFeaturesAtLngLat(): readonly TdFeature[] {
        return this.near.flatMap((id) => {
            const feature = this.store.get(id);
            return feature === undefined ? [] : [feature];
        });
    }

    on(event: string, listener: Listener): void {
        this.#listeners.set(event, [...(this.#listeners.get(event) ?? []), listener]);
    }

    #emit(event: string, ...args: unknown[]): void {
        for (const listener of this.#listeners.get(event) ?? []) {
            (listener as (...values: unknown[]) => void)(...args);
        }
    }

    #mode(kind: string): FakeMode | undefined {
        return (this.options.modes as FakeMode[]).find((candidate) => candidate.kind === kind);
    }

    /** The validation of the shape mode named `mode` (as Terra Draw calls it when a feature is added). */
    validate(mode: string, geometry: TdFeature['geometry'], updateType?: string): TdValidationResult | undefined {
        const context = updateType === undefined ? {} : { updateType };
        return this.#mode(mode)?.options?.validation?.({ type: 'Feature', geometry, properties: { mode } }, context);
    }

    /** The validation the select mode runs on a moved feature of the shape mode `mode` (its `flags`). */
    validateMove(mode: string, geometry: TdFeature['geometry'], updateType: string): TdValidationResult | undefined {
        const flags = this.#mode('select')?.options?.flags?.[mode] as { feature?: { validation?: TdValidation } } | undefined;
        return flags?.feature?.validation?.({ type: 'Feature', geometry, properties: { mode } }, { updateType });
    }

    /** A drag of feature `id` to `geometry`: one `change`, then `finish` when `final`. */
    drag(id: TdFeatureId, geometry: TdFeature['geometry'], final: boolean): void {
        const feature = this.store.get(id);
        if (feature !== undefined) {
            this.store.set(id, { ...feature, geometry });
        }
        this.#emit('change', [id], 'update');
        if (final) {
            this.#emit('finish', id, { mode: 'select', action: 'dragCoordinate' } satisfies TdFinishContext);
        }
    }

    /** Plays any event (a `change` of a guidance point, a `select` of another feature). */
    play(event: string, ...args: unknown[]): void {
        this.#emit(event, ...args);
    }
}

export interface FakeTerraDrawModules extends TerraDrawModules {
    readonly instances: FakeTerraDraw[];
    readonly adapters: { readonly map: unknown; readonly coordinatePrecision: number }[];
}

function modeConstructor(kind: string): new (options?: TdModeOptions) => FakeMode {
    return class extends FakeMode {
        constructor(options?: TdModeOptions) {
            super(kind, options);
        }
    };
}

/** Fresh constructors; `instances` and `adapters` keep what the adapter created, in order. */
export function fakeTerraDrawModules(): FakeTerraDrawModules {
    const instances: FakeTerraDraw[] = [];
    const adapters: { readonly map: unknown; readonly coordinatePrecision: number }[] = [];
    return {
        instances,
        adapters,
        TerraDraw: class extends FakeTerraDraw {
            constructor(options: TdOptions) {
                super(options);
                instances.push(this);
            }
        },
        TerraDrawPointMode: modeConstructor('point'),
        TerraDrawLineStringMode: modeConstructor('linestring'),
        TerraDrawPolygonMode: modeConstructor('polygon'),
        TerraDrawRectangleMode: modeConstructor('rectangle'),
        TerraDrawSelectMode: modeConstructor('select'),
        TerraDrawRenderMode: modeConstructor('static'),
        TerraDrawMapboxGLAdapter: class {
            readonly options: { readonly map: unknown; readonly coordinatePrecision: number };

            constructor(options: { readonly map: unknown; readonly coordinatePrecision: number }) {
                this.options = options;
                adapters.push(options);
            }
        },
    };
}
