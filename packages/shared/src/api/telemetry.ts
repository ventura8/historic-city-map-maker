/**
 * Crash reporting (PLAN Addendum 2; `docs/research/M2-interfaces.md` §3.4; scenarios V20, A22, A24). The viewer and
 * the admin POST {@link errorReportSchema} to the public HTTPS function `telemetry.reportError` (`text/plain`, so the
 * browser sends no preflight; `keepalive`, no credentials), which checks the origin, limits the rate, redacts again and
 * writes one structured log entry Cloud Error Reporting ingests ({@link reportedErrorEventSchema}). The Setup
 * Assistant's "Crash reports" panel lists the grouped errors through the admin callable `telemetry.listGroups`.
 */
import { z } from 'zod';

import { idSchema } from '../schemas/primitives.js';
import { isoTimeSchema } from './common.js';

/** Where an error was caught (the engine's `ErrorSource`). */
export const ERROR_SOURCES = ['window', 'promise', 'boundary'] as const;

/** The Error Reporting service of a report, decided by the origin it came from (never by the body). */
export const ERROR_SERVICES = ['viewer', 'admin'] as const;

/** A larger body is refused with 413 before it is parsed. */
export const ERROR_REPORT_MAX_BYTES = 16 * 1024;

/**
 * The rate limits of `telemetry.reportError`, per function instance (no Firestore write per report: the endpoint is
 * public). A client is a salted hash of its IP address that lives in memory only.
 *
 * They cap the worst-case logging cost (`DECISIONS-for-review.md` §42f): with `maxInstances: 2`, at most 30 accepted
 * reports a minute reach Cloud Logging project-wide, each one entry of at most {@link REPORTED_EVENT_MAX_BYTES} of payload
 * (about 17 KiB with the entry's own fields), so at most about 22 GiB in a 31-day month even under a flood of valid
 * reports: within Cloud Logging's free 50 GiB a month.
 */
export const ERROR_REPORT_LIMITS = { perClientPerMinute: 10, perInstancePerMinute: 15 } as const;

/** The UTF-8 size of a logged `ReportedErrorEvent` at most: a longer one is logged with its `message` cut to fit. */
export const REPORTED_EVENT_MAX_BYTES = 16 * 1024;

/** No query and no fragment: the page's origin and path only. */
const PAGE_URL = /^https?:\/\/[^\s?#]+$/;

/**
 * The body the engine's `ErrorReporter` sends (`ErrorReportPayload` of `packages/engine/src/telemetry/telemetry-port.ts`,
 * the same shape; `cityId`, `locale` and `windowClass` are empty before the manifest has loaded).
 */
export const errorReportSchema = z.strictObject({
    message: z.string().min(1).max(1000),
    stack: z.string().max(8000).optional(),
    release: z.string().min(1).max(64),
    cityId: z.union([idSchema, z.literal('')]),
    page: z.string().max(2048).regex(PAGE_URL),
    viewport: z.strictObject({ width: z.number().int().min(0).max(20_000), height: z.number().int().min(0).max(20_000) }),
    windowClass: z.string().max(32),
    locale: z.string().max(16),
    fatal: z.boolean(),
    source: z.enum(ERROR_SOURCES),
    /** The admin's route id (`georef`, `setup`) or the viewer's open panel (`photo`, `story`, `map`): never an id of data. */
    route: z
        .string()
        .max(40)
        .regex(/^[a-z][a-z0-9-]*$/)
        .optional(),
});

export type ErrorReport = z.infer<typeof errorReportSchema>;

export const REPORTED_ERROR_EVENT_TYPE = 'type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent';

/**
 * The `jsonPayload` of the log entry the endpoint writes (severity ERROR). `message` is the redacted stack when there is
 * one, else the message; `context.reportLocation` is always set, so Error Reporting also groups errors whose stack it
 * cannot parse (Firefox and Safari stack formats). `hcm` carries the rest of the report, already redacted.
 */
export const reportedErrorEventSchema = z.strictObject({
    '@type': z.literal(REPORTED_ERROR_EVENT_TYPE),
    message: z.string().min(1).max(10_000),
    serviceContext: z.strictObject({ service: z.enum(ERROR_SERVICES), version: z.string().min(1).max(64) }),
    context: z.strictObject({
        /** `userAgent` is never the browser's string: only `clientLabel`'s family, major version and device class. */
        httpRequest: z.strictObject({ url: z.string().max(2048), userAgent: z.string().max(60).optional() }),
        reportLocation: z.strictObject({
            filePath: z.string().max(2048),
            lineNumber: z.number().int().min(0),
            functionName: z.string().max(200),
        }),
    }),
    hcm: z.strictObject({
        cityId: z.string().max(40),
        windowClass: z.string().max(32),
        locale: z.string().max(16),
        viewport: z.strictObject({ width: z.number().int().min(0), height: z.number().int().min(0) }),
        fatal: z.boolean(),
        source: z.enum(ERROR_SOURCES),
        /** The admin's route id or the viewer's panel when the error happened. */
        route: z.string().max(40).optional(),
    }),
});

export type ReportedErrorEvent = z.infer<typeof reportedErrorEventSchema>;

/** The top stack frames a crash group shows. */
export const CRASH_TOP_FRAMES = 5;

export const ERROR_GROUP_RESOLUTIONS = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'MUTED'] as const;

/** `telemetry.listGroups`: the "Crash reports" panel (Error Reporting `groupStats.list` over REST). */
export const listGroupsRequestSchema = z.strictObject({
    hours: z.union([z.literal(24), z.literal(168), z.literal(720)]),
    pageSize: z.number().int().min(1).max(50),
    pageToken: z.string().max(500).optional(),
});

export const listGroupsResponseSchema = z.strictObject({
    groups: z
        .array(
            z.strictObject({
                groupId: z.string().min(1).max(200),
                /** The first line of the representative message, redacted; rendered as text only. */
                message: z.string().max(500),
                service: z.string().max(100),
                version: z.string().max(64).optional(),
                count: z.number().int().min(0),
                firstSeen: isoTimeSchema,
                lastSeen: isoTimeSchema,
                resolution: z.enum(ERROR_GROUP_RESOLUTIONS),
                /** The representative's top stack frames (at most {@link CRASH_TOP_FRAMES}), redacted; text only. */
                frames: z.array(z.string().max(300)).max(5).optional(),
                /** How many distinct users Error Reporting counted (it counts none for our reports without a user). */
                affectedUsers: z.number().int().min(0).optional(),
                /** The page (origin and path) of the representative report, redacted. */
                page: z.string().max(2048).optional(),
                /** The representative's browser and device class (`clientLabel`, e.g. `Safari 18 mobile`). */
                client: z.string().max(60).optional(),
            }),
        )
        .max(50),
    nextPageToken: z.string().max(500).optional(),
});

export type ListGroupsRequest = z.infer<typeof listGroupsRequestSchema>;
export type ListGroupsResponse = z.infer<typeof listGroupsResponseSchema>;
