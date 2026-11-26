/**
 * A place's structured facts (`docs/research/M17-stories.md` §13, the owner 2026-11-22): who built it, when it was built,
 * demolished or abandoned, its style, floors and height, its uses over time, its heritage code (LMI, the Romanian list of
 * historical monuments), its addresses past and present and related places. The same object on the place's document and
 * in the manifest (`facts`); every field is optional, and the place's sheet shows the ones it has.
 */
import { z } from 'zod';

import { coded, idSchema, localizedPartial, plainText, yearSchema } from './primitives.js';

export const MAX_FACT_ITEMS = 20;

/**
 * The LMI code: county (one or two letters), category (I to IV), kind (m, a, s, f), value (A national, B local), a
 * five-digit number and optional parts (`B-II-m-A-18925`, `B-II-m-B-19750.02`).
 */
export const LMI_CODE_PATTERN = /^[A-Z]{1,2}-(I|II|III|IV)-[masf]-[AB]-\d{5}(\.\d{1,3}){0,2}$/;

/** `yearStart` never after `yearEnd`. */
function spanOk(item: { readonly yearStart?: number | undefined; readonly yearEnd?: number | undefined }): boolean {
    return item.yearStart === undefined || item.yearEnd === undefined || item.yearStart <= item.yearEnd;
}

const useSchema = z
    .strictObject({ use: localizedPartial(200), yearStart: yearSchema.optional(), yearEnd: yearSchema.optional() })
    .refine(spanOk, coded('validation.yearRange', ['yearEnd']));

const addressSchema = z
    .strictObject({
        text: plainText(300),
        yearStart: yearSchema.optional(),
        yearEnd: yearSchema.optional(),
        /** The address today. */
        current: z.boolean().optional(),
    })
    .refine(spanOk, coded('validation.yearRange', ['yearEnd']));

export const placeFactsSchema = z
    .strictObject({
        architects: z.array(plainText(200)).min(1).max(10).optional(),
        yearBuilt: yearSchema.optional(),
        yearDemolished: yearSchema.optional(),
        yearAbandoned: yearSchema.optional(),
        style: localizedPartial(200).optional(),
        floors: z.number().int().min(0).max(200).optional(),
        heightM: z.number().min(0).max(1000).optional(),
        uses: z.array(useSchema).min(1).max(MAX_FACT_ITEMS).optional(),
        lmiCode: z.string().regex(LMI_CODE_PATTERN).optional(),
        addresses: z.array(addressSchema).min(1).max(MAX_FACT_ITEMS).optional(),
        relatedPlaceIds: z
            .array(idSchema)
            .min(1)
            .max(MAX_FACT_ITEMS)
            .refine((ids) => new Set(ids).size === ids.length, coded('validation.duplicateId'))
            .optional(),
    })
    .refine(
        (facts) => facts.yearBuilt === undefined || facts.yearDemolished === undefined || facts.yearBuilt <= facts.yearDemolished,
        coded('validation.yearRange', ['yearDemolished']),
    );

export type PlaceFacts = z.infer<typeof placeFactsSchema>;
