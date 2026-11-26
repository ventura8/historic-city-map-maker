/**
 * M28 (`docs/research/M28-sources.md`): which imagery and data sources a city's map uses, chosen on Setup's **Sources** step
 * and changed later from Settings (`cities/{city}.sources`). A leaf module: `firestore.ts` imports it for the city document,
 * so it imports nothing of the document schemas. What each source is, costs and needs lives in `sources-catalogue.ts`.
 */
import { z } from 'zod';

/** The sources the owner may turn on or off, in the order the step lists them. */
export const SOURCE_TOGGLES = ['usgs', 'usgsOrders', 'landsat', 'archives', 'contributors', 'openData', 'localAi', 'cloudAi'] as const;

export type SourceToggle = (typeof SOURCE_TOGGLES)[number];

/**
 * The sources that come with the imagery and are never turned off: Sentinel-2 is the alignment reference of every frame. The
 * app's platform (Google Cloud with Firebase and Firestore, Mapbox) is not a source: each has its own Setup step (the owner,
 * 2026-11-13), and the step's cost summary shows it as a fixed line.
 */
export const REQUIRED_SOURCES = ['sentinel2'] as const;

export type RequiredSource = (typeof REQUIRED_SOURCES)[number];

export type SourceId = SourceToggle | RequiredSource;

export type SourceChoices = Readonly<Record<SourceToggle, boolean>>;

/**
 * The defaults (the owner's rule: free and open sources on, paid ones off until chosen): a scan order costs money (USD 30 a
 * frame plus 5 an order) and the cloud AI is billed per use, so both start off; everything else is free or the owner's own.
 */
export const DEFAULT_SOURCES: SourceChoices = {
    usgs: true,
    usgsOrders: false,
    landsat: true,
    archives: true,
    contributors: true,
    openData: true,
    localAi: true,
    cloudAi: false,
};

/** `cities/{city}.sources`: each field optional (an absent one takes its default); the field's presence is "chosen". */
export const citySourcesSchema = z.strictObject(
    Object.fromEntries(SOURCE_TOGGLES.map((id) => [id, z.boolean().optional()])) as Record<SourceToggle, z.ZodOptional<z.ZodBoolean>>,
);

export type CitySources = z.infer<typeof citySourcesSchema>;

/**
 * A city's choices with the defaults filled in. Paid scans need the declassified imagery: with it off they read off whatever
 * was stored.
 */
export function sourcesOf(stored: CitySources | undefined): SourceChoices {
    const choices = Object.fromEntries(SOURCE_TOGGLES.map((id) => [id, stored?.[id] ?? DEFAULT_SOURCES[id]])) as Record<
        SourceToggle,
        boolean
    >;
    return { ...choices, usgsOrders: choices.usgs && choices.usgsOrders };
}

/** Whether the map needs a USGS account: the declassified frames and Landsat both come through USGS's M2M API. */
export function needsUsgsAccount(choices: SourceChoices): boolean {
    return choices.usgs || choices.landsat;
}
