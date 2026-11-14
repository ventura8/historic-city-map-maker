/**
 * M9 (`docs/research/M9-calibration.md` §2, §7): what the pipeline measured when it looked for a frame with no landmark
 * (`layerVersionDocSchema.calibration`), and the last proved model of a pass (`cities/{city}/imageryPasses/{key}`), which
 * `imagery.onJobWrite` writes and only the pipeline reads, as the first place to look for that pass's next frame. The Python
 * twin is `hcm_pipeline/steps/locate.py`, `calibrate/prior.py`, held to these by the golden documents.
 */
import { z } from 'zod';

import { stamp } from './firestore-common.js';
import { idSchema, isoDateSchema, latLngSchema } from './primitives.js';

/** How the frame was found; `none` when nothing proved it. */
export const CALIBRATION_HOWS = ['votes', 'pass', 'points', 'matcher', 'local-ai', 'none'] as const;

export type CalibrationHow = (typeof CALIBRATION_HOWS)[number];

/** The first gate of the proof a frame failed. */
export const CALIBRATION_REFUSALS = [
    'no-votes',
    'few-inliers',
    'low-share',
    'narrow',
    'small',
    'cross-validation',
    'gross',
    'rival',
] as const;

/** At most this many vertices in a measured outline. */
export const CALIBRATION_OUTLINE_MAX = 32;

/** A frame's edge over the city, measured. */
export const measuredOutlineSchema = z.array(latLngSchema).min(3).max(CALIBRATION_OUTLINE_MAX);

const count = z.number().int().min(0);
const metres = z.number().min(0);
const percent = z.number().min(0).max(100);

/** The orientation, and the similarity from the first guess to where the frame lies, around the window's centre. */
export const calibrationModelSchema = z.strictObject({
    camera: z.enum(['panoramic', 'corners']),
    rotation: z.number().int(),
    mirrored: z.boolean(),
    scale: z.number(),
    rotationDeg: z.number(),
    dxM: z.number(),
    dyM: z.number(),
});

/** What the local matcher ran on (`docs/research/M10-local-ai.md`). */
export const PROPOSER_DEVICES = ['gpu', 'cpu'] as const;

/** Who proposed the place a proof then held: shown to the admin, read by no gate. `support` is the matcher's own count. */
export const calibrationProposerSchema = z.strictObject({
    name: z.string().regex(/^[a-z0-9-]{1,40}$/),
    device: z.enum(PROPOSER_DEVICES),
    deviceName: z.string().min(1).max(120).optional(),
    seconds: metres,
    support: count,
    /** Why not the graphics card: there is none, it ran out of memory and this request ran again on the processor, or (M26) other programs held it. */
    fallback: z.enum(['no-gpu', 'out-of-memory', 'gpu-busy']).optional(),
});

/**
 * M15 (*Joint solve*, pipeline `calibrate/joint.py`): what became of a frame accepted earlier that overlaps this one: `used`, its film
 * ties held it still in the fit; `few`, too few of its tiles held to count; `disagrees`, its ties sat `offsetM` from the rest, so it
 * was left out.
 */
export const ALIGNMENT_STATUSES = ['used', 'few', 'disagrees'] as const;

export type AlignmentStatus = (typeof ALIGNMENT_STATUSES)[number];

/** At most this many frames are held still for one frame (`MAX_PARTNERS`, pipeline `steps/aligning.py`). */
export const ALIGNMENT_MAX_PARTNERS = 12;

const alignmentPartnerSchema = z.strictObject({
    versionId: idSchema,
    year: z.number().int().optional(),
    /** The ties measured, and the tiles tried. */
    ties: count,
    tried: count,
    status: z.enum(ALIGNMENT_STATUSES),
    /** Ground metres between its ties and the map of the frame's own tiles and its other partners. */
    offsetM: metres.optional(),
});

/** The frames a fit was joined to, each held still: none of them moved. */
export const calibrationAlignmentSchema = z.strictObject({
    partners: z.array(alignmentPartnerSchema).min(1).max(ALIGNMENT_MAX_PARTNERS),
});

export type CalibrationAlignment = z.infer<typeof calibrationAlignmentSchema>;

/** The partners of one status in words' parameters: their years, and their ties together. */
export type AlignedWith = Readonly<Record<'years' | 'ties', string>>;

/** What the version page says of an alignment (M15, `calibration-card.ts`): the lines of each status, by name. */
const ALIGNED_LINES = [
    ['used', ['aligned', 'stayed']],
    ['disagrees', ['leftOut']],
] as const;

/** A line the version page says of an alignment. */
export type AlignedLine = 'aligned' | 'stayed' | 'leftOut';

/** The version page's lines of an alignment: the partners held still, those left out; a status nobody has, and `few`, say nothing. */
export function alignedWith(alignment: CalibrationAlignment | undefined): readonly (readonly [AlignedLine, AlignedWith])[] {
    return ALIGNED_LINES.flatMap(([status, lines]) => {
        const some = alignment?.partners.filter((partner) => partner.status === status) ?? [];
        const params = {
            years: some.map(({ year }) => year ?? '').join(', '),
            ties: String(some.reduce((sum, partner) => sum + partner.ties, 0)),
        };
        return some.length > 0 ? lines.map((line) => [line, params] as const) : [];
    });
}

export const calibrationSchema = z.strictObject({
    how: z.enum(CALIBRATION_HOWS),
    model: calibrationModelSchema.optional(),
    proposer: calibrationProposerSchema.optional(),
    votes: z.strictObject({ agreed: count, tiles: count }).optional(),
    /** The proof's tiles: `{agreed} of {tried}` agree. */
    tiles: z.strictObject({ agreed: count, tried: count }).optional(),
    /** Blocked 5-fold, in metres on the ground. */
    crossValidatedM: metres.optional(),
    /** The share of the city's bounds the frame reaches. */
    coveredPct: percent.optional(),
    /** How much of what the frame covers of the window the agreeing tiles span: the rest renders on the polynomial's word alone. */
    measuredPct: percent.optional(),
    /** The exposure's edge through the proved map, clipped to the city's bounds: `imagery/join.ts` prefers it to its estimate. */
    outline: measuredOutlineSchema.optional(),
    /** Checks over 100 m that were dropped from the checkpoints. */
    checksDropped: count.optional(),
    /** The admin's points that seeded the search. */
    seedPoints: count.optional(),
    /** Orientations the bounded crop lost to `MAX_SCAN_PIXELS`. */
    cutOrientations: count.optional(),
    refusal: z.enum(CALIBRATION_REFUSALS).optional(),
    alignment: calibrationAlignmentSchema.optional(),
    /**
     * A whole frame shown shrunk (nothing proved): where the scene's corners put the city in the scan's pixels, most voted first; the
     * georeferencer opens on the first (admin sweep 2026-11-14, bug 6: a 15,034-pixel Corona strip opened whole, the city a few pixels).
     */
    expected: z.array(z.strictObject({ x: count, y: count, width: count, height: count })).max(4).optional(),
});

export type Calibration = z.infer<typeof calibrationSchema>;

/** `cities/{city}/imageryPasses/{key}`: server-written, read by the pipeline alone, no client rule. */
export const imageryPassDocSchema = z.strictObject({
    model: calibrationModelSchema,
    /** The frame it was proved on. */
    entityId: idSchema,
    date: isoDateSchema,
    ...stamp,
});

export type ImageryPassDoc = z.infer<typeof imageryPassDocSchema>;

/** Mission and camera letter of an entity id, its frame number left out (`D3C1203-300415F006`: `D3C1203-300415`, `F`). */
const ENTITY = /^(.+)([A-Z])\d+$/;

/** The pass's prefix of an entity id: what its frames share before their date, undefined for an id of another form. */
export function passPrefixOf(entityId: string): string | undefined {
    const found = ENTITY.exec(entityId);
    return found === null ? undefined : `${String(found[1])}-${String(found[2])}-`;
}

/** The key of a frame's pass: mission, camera letter and date, as the pipeline's `calibrate/prior.py` `pass_key` spells it. */
export function passKeyOf(entityId: string, date: string): string | undefined {
    const prefix = passPrefixOf(entityId);
    return prefix === undefined ? undefined : `${prefix}${date}`;
}
