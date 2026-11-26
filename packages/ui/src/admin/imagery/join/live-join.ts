/** A leaf module (M8, `docs/research/M8-join-interfaces.md` §6): the Work list, the version page and the join's chunk all ask this. */
import type { UiLocale } from '@hcm/shared';

import { contentText } from '../../shell/text.js';
import type { VersionItemPort } from '../imagery-port.js';

/** The camera and frame an id ends in, in short (`D3C1202-200149F039`: F039). */
const FRAME_NAME = /([AFL])(\d{3})\d{0,3}$/;

/** A frame's short name: its camera and number, when its id says them. */
export function frameName(entityId: string): string {
    const [, camera, frame] = FRAME_NAME.exec(entityId) ?? [];
    return frame === undefined ? entityId : `${camera ?? ''}${frame}`;
}

/**
 * What tells a version of a date from the others of that date, which share its label: a join's "Joined frames", a frame's name;
 * nothing for an upload.
 */
export function versionMark(locale: UiLocale, origin: VersionItemPort['origin'], entityId: string | undefined): string | null {
    if (origin === 'join') {
        return contentText(locale, 'adminContent.imagery.origin.join');
    }
    return entityId === undefined ? null : frameName(entityId);
}

/**
 * `partOf` names a join that is still live: it is in the unfinished list, and not failed (a failed join frees its frames,
 * and a stale `partOf` is ignored).
 */
export function liveJoin(versions: readonly VersionItemPort[], partOf: string | null): boolean {
    return partOf !== null && versions.some((version) => version.id === partOf && version.state !== 'failed');
}

/**
 * The live join over any of these frames, or null. Read from the join's own source: a frame it holds may be published and out of the
 * unfinished list, or not imported yet and without a version on the plan's row.
 */
export function liveJoinOver(versions: readonly VersionItemPort[], entityIds: readonly string[]): string | null {
    const live = versions.find(
        (version) => version.origin === 'join' && version.state !== 'failed' && version.entityIds.some((id) => entityIds.includes(id)),
    );
    return live?.id ?? null;
}
