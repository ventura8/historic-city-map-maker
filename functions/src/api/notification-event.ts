/**
 * How a producer says that something happened (`docs/research/M4-interfaces.md` §5.2): one `notificationEvents/{id}`
 * document per occurrence, created after the producer's own transaction (never inside it: a retried transaction must
 * not emit twice), under an id built from what happened (`notificationEventId`), so a redelivered trigger or a second
 * run finds it (`conflict`) and writes nothing. `notify.onEvent` fans it out to every admin's inbox and devices.
 *
 * Shared plumbing (`api/` is the one place every feature folder may import, CR-M2-3): the imagery dispatcher, the ops
 * tick, the budget alert and the order watch reach it through the `documents` port they already have, so no feature
 * folder imports `notify/`. Emitting never fails its producer: a refused write is logged and the producer goes on.
 */
import {
    FIRESTORE_PATHS,
    NOTIFICATION_SPECS,
    notificationEventDocSchema,
    notificationEventId,
    systemWriter,
    timestampFromDate,
    type NotificationEventDoc,
    type NotificationKind,
    type SystemWriter,
} from '@hcm/shared';

import { UpstreamError } from '../ports/errors.js';
import type { Ports } from '../ports/index.js';

export type EmitDeps = Pick<Ports, 'documents' | 'clock' | 'log'>;

export interface NotificationInput {
    readonly kind: NotificationKind;
    /** What identifies the occurrence (`notificationEventId`'s parts): the same occurrence, the same parts. */
    readonly parts: readonly string[];
    /** The message's `{placeholders}`, plain text. */
    readonly params?: Readonly<Record<string, string>>;
    /** An admin route (`#/imagery/version/<id>`). */
    readonly link: string;
    /** The city it is about; absent for the project's own (the budget, USGS approval, crashes). */
    readonly cityId?: string;
}

/** The event document of `input`, written by `writer` at `now`. */
export function notificationEvent(input: NotificationInput, writer: SystemWriter, now: Date): NotificationEventDoc {
    const at = timestampFromDate(now);
    return {
        kind: input.kind,
        severity: NOTIFICATION_SPECS[input.kind].severity,
        ...(input.cityId === undefined ? {} : { cityId: input.cityId }),
        params: input.params ?? {},
        link: input.link,
        createdAt: at,
        updatedBy: systemWriter(writer),
        updatedAt: at,
    };
}

/**
 * Creates the event once. Resolves `true` when this call wrote it, `false` when it existed already (emitted before) or
 * could not be written (logged: a notification is never worth failing the work it reports).
 */
export async function emitNotification(deps: EmitDeps, writer: SystemWriter, input: NotificationInput): Promise<boolean> {
    try {
        const id = notificationEventId(input.kind, ...input.parts);
        await deps.documents.create(
            FIRESTORE_PATHS.notificationEvent(id),
            notificationEventDocSchema,
            notificationEvent(input, writer, deps.clock.now()),
        );
        return true;
    } catch (error) {
        const repeated = error instanceof UpstreamError && error.failure === 'conflict';
        if (!repeated) {
            deps.log.warn('notification not emitted', { kind: input.kind, error: String(error) });
        }
        return false;
    }
}
