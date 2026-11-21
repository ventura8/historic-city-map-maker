/**
 * A photo's date at the precision the admin knows (`docs/research/photo-date-source.md` §1): a year, a year and a month,
 * or a year, a month and a day. The same rules for the document and for the manifest; `firebase/firestore.rules`
 * (`validPhotoDate`) repeats them.
 */
import { z } from 'zod';

import { coded } from './primitives.js';

export const monthSchema = z.number().int().min(1).max(12);
export const daySchema = z.number().int().min(1).max(31);

interface PhotoDateValue {
    readonly year?: number | undefined;
    readonly yearEnd?: number | undefined;
    readonly month?: number | undefined;
    readonly day?: number | undefined;
}

/** The days of a month of the Gregorian calendar (day 0 of the next month is this month's last). */
function daysInMonth(year: number, month: number): number {
    const date = new Date(0);
    date.setUTCFullYear(year, month, 0);
    return date.getUTCDate();
}

/** A day, when there is one, exists in its month and year; a day without a month is `validation.datePart`'s. */
function dayExists({ year, month, day }: PhotoDateValue): boolean {
    return day === undefined || year === undefined || month === undefined || day <= daysInMonth(year, month);
}

/** A month or a day dates one year, so a range ending in another year refuses them. */
function oneYear({ year, yearEnd, month }: PhotoDateValue): boolean {
    return month === undefined || yearEnd === undefined || yearEnd === year;
}

/** The photo-date rules on a schema of a photo, each reporting its own code at the field to correct. */
export function withPhotoDate<Schema extends z.ZodType<PhotoDateValue>>(schema: Schema): Schema {
    return schema
        .refine((value) => value.month === undefined || value.year !== undefined, coded('validation.datePart', ['month']))
        .refine((value) => value.day === undefined || value.month !== undefined, coded('validation.datePart', ['day']))
        .refine(dayExists, coded('validation.dateImpossible', ['day']))
        .refine(oneYear, coded('validation.dateRange', ['month']));
}
