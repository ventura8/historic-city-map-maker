/** Which sheet shows in the docked trailing pane (`viewer-render.ts`): About and its modes are always a dialog. */
import type { ViewerLayout } from './layout.js';
import type { ViewerState } from './store-port.js';

export type DockedSheet = 'layers' | 'photo' | 'poi' | 'photos' | 'unplaced' | 'stories' | 'favorites';

/** About is always a dialog; the layers panel has its own pane when it is always docked. */
function isDockable(sheet: ViewerState['sheet'], layersDocked: boolean): sheet is DockedSheet {
    return ['photo', 'poi', 'photos', 'unplaced', 'stories', 'favorites'].includes(sheet) || (sheet === 'layers' && !layersDocked);
}

/** The sheet that shows in the docked trailing pane, if any (`ready` null: the viewer is not ready). */
export function dockedSheet(
    layout: Pick<ViewerLayout, 'sheetMode' | 'layersDocked'>,
    ready: { readonly state: Pick<ViewerState, 'sheet'> } | null,
): DockedSheet | 'none' {
    if (ready === null || layout.sheetMode !== 'docked') {
        return 'none';
    }
    const sheet = ready.state.sheet;
    return isDockable(sheet, layout.layersDocked) ? sheet : 'none';
}
