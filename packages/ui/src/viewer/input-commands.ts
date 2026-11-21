/**
 * What the viewer's keyboard shortcuts and gamepad do (docs/research/viewer-input.md §1): one command set over
 * `ViewerStorePort`, so both inputs act alike and each command is tested without the element. A year or opacity change
 * says its new value in a toast, which is also the announcement for a screen reader.
 */
import { clamp, overlayLabel, type Photo } from '@hcm/shared';

import { layoutFor } from './layout.js';
import type { ViewerState, ViewerStorePort } from './store-port.js';
import { photosNearYear, stopIndex, timelineStops } from './timeline-model.js';
import { closeSheet, selectPhoto } from './viewer-actions.js';
import { lightboxPhotos } from './viewer-lightbox.js';

export type InputCommand =
    'year-next' | 'year-previous' | 'opacity-up' | 'opacity-down' | 'photo-next' | 'photo-previous' | 'layers' | 'help' | 'close';

const OPACITY_STEP = 0.1;
const PHOTO_COMMANDS: readonly InputCommand[] = ['photo-next', 'photo-previous', 'close'];
const DIALOG_COMMANDS: readonly InputCommand[] = ['help', 'close'];

/** The neighbour of `index` in a list of `length`, wrapping around; from nowhere (-1) the first or the last. */
export function wrapped(index: number, step: number, length: number): number {
    return index < 0 && step < 0 ? length - 1 : (index + step + length) % length;
}

/** About, the help panel and Settings: the same dialog, in the browser's top layer. */
export function isDialogSheet(sheet: ViewerState['sheet']): boolean {
    return sheet === 'about' || dialogMode(sheet) !== 'about';
}

/** What the dialog shows while `sheet` is open: the help panel, Settings, or About. */
export function dialogMode(sheet: ViewerState['sheet']): 'about' | 'help' | 'settings' {
    return sheet === 'help' || sheet === 'settings' ? sheet : 'about';
}

/** What a modal surface in front keeps for itself, or null with none. */
function surfaceCommands(state: ViewerState): readonly InputCommand[] | null {
    if (state.lightbox) {
        return PHOTO_COMMANDS;
    }
    return isDialogSheet(state.sheet) ? DIALOG_COMMANDS : null;
}

/** Whether the state lets `command` act: a modal surface in front keeps its own, a viewer without a map has no map commands. */
export function commandAllowed(state: ViewerState, command: InputCommand): boolean {
    if (state.status !== 'ready') {
        return false;
    }
    const kept = surfaceCommands(state);
    if (kept !== null) {
        return kept.includes(command);
    }
    return state.webgl || PHOTO_COMMANDS.includes(command) || DIALOG_COMMANDS.includes(command);
}

function stepYear(store: ViewerStorePort, step: number): void {
    const state = store.getState();
    const stops = timelineStops(state.manifest?.layers ?? []);
    const year = stops[clamp(stopIndex(stops, state.year) + step, 0, stops.length - 1)] ?? null;
    store.setYear(year);
    store.showToast(year === null ? 'timeline.present' : 'timeline.year', { year: String(year) });
}

function stepOpacity(store: ViewerStorePort, step: number): void {
    const state = store.getState();
    const layer = state.overlays.find((overlay) => overlay.kind === 'raster' && overlay.visible);
    if (layer === undefined) {
        store.showToast('input.noLayer');
        return;
    }
    const percent = Math.round(clamp(layer.opacity + step, 0, 1) * 100);
    store.setOverlayOpacity(layer.id, percent / 100, true);
    store.showToast('layers.opacityChanged', { name: overlayLabel(layer, state.locale), percent: String(percent) });
}

/** The photos a step goes through: those near the year, all of them at "today"; in the lightbox, the list it counts. */
function steppedPhotos(state: ViewerState): readonly Photo[] {
    const all = state.manifest?.photos ?? [];
    if (state.lightbox) {
        return lightboxPhotos(all, state.year, state.selectedPhotoId);
    }
    return state.year === null ? all : photosNearYear(all, state.year);
}

function stepPhoto(store: ViewerStorePort, step: number): void {
    const state = store.getState();
    const list = steppedPhotos(state);
    const photo =
        list[
            wrapped(
                list.findIndex((candidate) => candidate.id === state.selectedPhotoId),
                step,
                list.length,
            )
        ];
    if (photo === undefined) {
        store.showToast('input.noPhoto');
        return;
    }
    selectPhoto(store, photo.id);
}

/** Opens `sheet`, or closes it when it is open. */
function toggleSheet(store: ViewerStorePort, sheet: 'layers' | 'help'): void {
    store.openSheet(store.getState().sheet === sheet ? 'none' : sheet);
}

/** Where the panel is always docked nothing opens, and the photo or place open beside it stays: the viewer only moves the focus. */
function toggleLayers(store: ViewerStorePort): void {
    const { windowClass, compactHeight, dockable } = store.getState();
    if (!layoutFor(windowClass, compactHeight, dockable).layersDocked) {
        toggleSheet(store, 'layers');
    }
}

function toggleHelp(store: ViewerStorePort): void {
    toggleSheet(store, 'help');
}

function closeFront(store: ViewerStorePort): void {
    if (store.getState().lightbox) {
        store.setLightbox(false);
    } else {
        closeSheet(store);
    }
}

const ACTIONS: Readonly<Record<InputCommand, readonly [(store: ViewerStorePort, step: number) => void, number]>> = {
    'year-next': [stepYear, 1],
    'year-previous': [stepYear, -1],
    'opacity-up': [stepOpacity, OPACITY_STEP],
    'opacity-down': [stepOpacity, -OPACITY_STEP],
    'photo-next': [stepPhoto, 1],
    'photo-previous': [stepPhoto, -1],
    layers: [toggleLayers, 0],
    help: [toggleHelp, 0],
    close: [closeFront, 0],
};

/** Runs `command` on the store (the caller has asked `commandAllowed`). */
export function runInputCommand(store: ViewerStorePort, command: InputCommand): void {
    const [action, step] = ACTIONS[command];
    action(store, step);
}
