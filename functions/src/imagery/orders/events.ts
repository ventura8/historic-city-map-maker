/**
 * The order watch's notifications (`docs/research/M4-interfaces.md` §5.1, §5.2): one event document per occurrence,
 * created after the transaction that caused it, under an id built from what happened, so a tick that runs twice writes
 * it once (`create` finds it: ignored). `notify.onEvent` fans each one out to every admin's inbox and devices. A
 * reminder's id also names the order (its `orderedAt`), so an order marked again after it expired or was taken back is
 * reminded again.
 */
import {
    FIRESTORE_PATHS,
    NOTIFICATION_SPECS,
    SENSOR_SPECS,
    notificationEventDocSchema,
    notificationEventId,
    timestampFromDate,
    timestampToDate,
    type NotificationEventDoc,
    type UsgsSceneDoc,
} from '@hcm/shared';

import { UpstreamError } from '../../ports/errors.js';
import type { Ports } from '../../ports/index.js';
import { IMAGERY_WRITER } from '../records.js';
import type { CityNow, OrderedScene } from './scene-order.js';

/** What happened to an order that the admins are told. */
export type OrderEvent =
    | { readonly kind: 'order.delivered' }
    | { readonly kind: 'order.imported'; readonly versionId: string }
    | { readonly kind: 'order.reminder'; readonly day: number }
    | { readonly kind: 'order.expired'; readonly days: number };

interface EventShape {
    readonly parts: readonly string[];
    readonly params: Readonly<Record<string, string>>;
    readonly link: string;
}

/** The scene as a message names it, in either language: its camera and date (`KH-4A Corona 1966-07-12`). */
function sceneName(scene: Pick<UsgsSceneDoc, 'sensor' | 'acquisitionDate'>): string {
    return `${SENSOR_SPECS[scene.sensor].name} ${scene.acquisitionDate}`;
}

function shapeOf(cityId: string, scene: OrderedScene, event: OrderEvent): EventShape {
    const name = { scene: sceneName(scene) };
    const sceneLink = `#/imagery/scene/${scene.entityId}`;
    const orderedAt = String(timestampToDate(scene.order.orderedAt).getTime());
    switch (event.kind) {
        case 'order.delivered':
            return { parts: [cityId, scene.entityId], params: name, link: sceneLink };
        case 'order.imported':
            return { parts: [cityId, scene.entityId], params: name, link: `#/imagery/version/${event.versionId}` };
        case 'order.reminder':
            return {
                parts: [cityId, scene.entityId, String(event.day), orderedAt],
                params: { ...name, days: String(event.day) },
                link: sceneLink,
            };
        case 'order.expired':
            return { parts: [cityId, scene.entityId, orderedAt], params: { ...name, days: String(event.days) }, link: sceneLink };
    }
}

/** Creates the event once (an existing one was emitted already); a failure is logged, never the watch's. */
export async function emitOrderEvent(
    deps: Pick<Ports, 'documents' | 'log'>,
    at: CityNow,
    scene: OrderedScene,
    event: OrderEvent,
): Promise<void> {
    const { cityId, now } = at;
    const shape = shapeOf(cityId, scene, event);
    const id = notificationEventId(event.kind, ...shape.parts);
    const stamp = timestampFromDate(now);
    const doc: NotificationEventDoc = {
        kind: event.kind,
        severity: NOTIFICATION_SPECS[event.kind].severity,
        cityId,
        params: shape.params,
        link: shape.link,
        createdAt: stamp,
        updatedBy: IMAGERY_WRITER,
        updatedAt: stamp,
    };
    try {
        await deps.documents.create(FIRESTORE_PATHS.notificationEvent(id), notificationEventDocSchema, doc);
    } catch (error) {
        if (!(error instanceof UpstreamError && error.failure === 'conflict')) {
            deps.log.error('order notification not written', { cityId, kind: event.kind, error: String(error) });
        }
    }
}
