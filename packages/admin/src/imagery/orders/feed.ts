/**
 * The scenes that have an order (`docs/research/M4-interfaces.md` §1.7), live and whatever the filters: Work's orders,
 * and a scene a notification links to while Free only hides it. A city has a handful (each is a scan the admin bought).
 */
import { ORDER_STATES, type UsgsSceneDoc } from '@hcm/shared';

import { LiveList, type ListState, type LiveListDeps } from '../../content/list.js';
import type { ContentQuery } from '../../content/services.js';
import { sceneItemOf, type SceneItem } from '../model.js';

/** Every scene with an order, in any state (Firestore's single-field index on `order.state` serves it). */
export const ORDERS_QUERY: ContentQuery = { where: [['order.state', 'in', [...ORDER_STATES]]] };

/** The orders' list over the city's scenes (`scenes`: the store, clock, collection and schema of the scenes' lists). */
export function ordersList(
    scenes: Omit<LiveListDeps<UsgsSceneDoc, SceneItem>, 'map' | 'changed'>,
    changed: (orders: ListState<SceneItem>) => void,
): LiveList<UsgsSceneDoc, SceneItem> {
    return new LiveList({ ...scenes, map: sceneItemOf, changed });
}
