/**
 * History's words (`docs/research/M2c-interfaces.md` §9.2): the entities, the actions, an entry's one-line summary and a
 * document's name in the admin's language.
 */
import type { AdminContentKey, UiLocale } from '@hcm/shared';

import { fieldNames } from '../editing/field-names.js';
import { formatWhen, whoText } from '../editing/states.js';
import { contentText } from '../shell/text.js';
import type { HistoryActionFilterPort, HistoryActionPort, HistoryEntityPort, HistoryItemPort } from './history-port.js';

export const ENTITY_FILTERS: readonly (HistoryEntityPort | 'all')[] = ['all', 'photo', 'poi', 'story', 'poiCategory', 'layer', 'city'];

export const ACTION_FILTERS: readonly HistoryActionFilterPort[] = ['all', 'update', 'create', 'delete', 'revert'];

const ENTITIES: Readonly<Record<HistoryEntityPort | 'all', AdminContentKey>> = {
    all: 'adminContent.history.entity.all',
    city: 'adminContent.history.entity.city',
    layer: 'adminContent.history.entity.layer',
    photo: 'adminContent.history.entity.photo',
    poi: 'adminContent.history.entity.poi',
    poiCategory: 'adminContent.history.entity.poiCategory',
    story: 'adminContent.history.entity.story',
};

const ONE_ENTITY: Readonly<Record<HistoryEntityPort, AdminContentKey>> = {
    city: 'adminContent.history.one.city',
    layer: 'adminContent.history.one.layer',
    photo: 'adminContent.history.one.photo',
    poi: 'adminContent.history.one.poi',
    poiCategory: 'adminContent.history.one.poiCategory',
    story: 'adminContent.history.one.story',
};

const ACTIONS: Readonly<Record<HistoryActionFilterPort, AdminContentKey>> = {
    all: 'adminContent.history.action.all',
    update: 'adminContent.history.action.update',
    create: 'adminContent.history.action.create',
    delete: 'adminContent.history.action.delete',
    revert: 'adminContent.history.action.revert',
};

const DONE: Readonly<Record<HistoryActionPort, AdminContentKey>> = {
    update: 'adminContent.history.done.update',
    create: 'adminContent.history.done.create',
    delete: 'adminContent.history.done.delete',
    revert: 'adminContent.history.done.revert',
};

export function entityFilterText(locale: UiLocale, entity: HistoryEntityPort | 'all'): string {
    return contentText(locale, ENTITIES[entity]);
}

export function actionFilterText(locale: UiLocale, action: HistoryActionFilterPort): string {
    return contentText(locale, ACTIONS[action]);
}

/** A document's name as the entry knew it, else its kind and id ("Place gara-de-nord"). */
export function nameText(locale: UiLocale, item: Pick<HistoryItemPort, 'name' | 'entity' | 'entityId'>): string {
    if (item.name !== null) {
        return locale === 'en' && item.name.en !== undefined ? item.name.en : item.name.ro;
    }
    return contentText(locale, 'adminContent.history.unnamed', { kind: contentText(locale, ONE_ENTITY[item.entity]), id: item.entityId });
}

function localizedIn(value: unknown): { readonly ro: string; readonly en?: string } | null {
    const name = value as { readonly ro?: unknown; readonly en?: unknown } | null | undefined;
    if (typeof name?.ro !== 'string') {
        return null;
    }
    return typeof name.en === 'string' ? { ro: name.ro, en: name.en } : { ro: name.ro };
}

/** The name a document carries now (a title, a label, a city's name), or null. */
export function currentName(data: Readonly<Record<string, unknown>> | null | undefined): HistoryItemPort['name'] {
    if (data === null || data === undefined) {
        return null;
    }
    return localizedIn(data['title']) ?? localizedIn(data['label']) ?? localizedIn(data['name']);
}

/** "Changed by you on 17 Oct 2026, 14:02". */
export function summaryText(
    locale: UiLocale,
    item: HistoryItemPort,
    self: string | null,
    people: Readonly<Record<string, string>>,
): string {
    return contentText(locale, DONE[item.action], { who: whoText(locale, item.by, self, people), date: formatWhen(locale, item.at) });
}

/** The changed fields, by their names in the admin's language ("Title, Changed on"; an unknown field as stored). */
export function fieldsText(locale: UiLocale, item: HistoryItemPort): string {
    return item.changedFields.length === 0
        ? contentText(locale, 'adminContent.history.noFields')
        : contentText(locale, 'adminContent.history.fields', { fields: fieldNames(locale, item.changedFields) });
}
