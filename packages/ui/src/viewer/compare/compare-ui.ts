/**
 * Swipe compare's surface as the engine's compare session drives it (M4, docs/research/M4-interfaces.md §3): the session
 * passes what to show (`CompareUiProps`, every text already in the visitor's language but the element's own labels) and
 * hears what the visitor did (`CompareUiEvents`); `createCompareUi` puts an `<hcm-compare>` right after the viewer's map
 * container, in the viewer's map pane, and takes it away again. The element lives in the engine's lazy compare chunk:
 * it is reached only through `@hcm/ui/viewer/compare`, never from `@hcm/ui`'s root.
 */
import { deepActiveElement, restoreFocus } from '../../components/focus.js';
import type { CompareUiFactory } from './compare-types.js';
import { defineHcmCompare, HCM_COMPARE_TAG, type HcmCompare } from './hcm-compare.js';

/** Whether the focus is on compare's surface (inside its shadow root). */
function focusedIn(element: HcmCompare): boolean {
    return element.renderRoot.contains(deepActiveElement(element.ownerDocument));
}

/** The browser's compare surface (`CompareUiFactory`). */
export const createCompareUi: CompareUiFactory = (anchor, mapboxCssUrl, events) => {
    const doc = anchor.ownerDocument;
    defineHcmCompare();
    const opener = deepActiveElement(doc);
    const element = doc.createElement(HCM_COMPARE_TAG);
    element.mapboxCssUrl = mapboxCssUrl;
    element.events = events;
    anchor.after(element);
    return {
        update: (props) => {
            element.props = props;
        },
        mapContainer: () => element.mapContainer(),
        remove: () => {
            const hadFocus = focusedIn(element);
            element.remove();
            if (hadFocus) {
                restoreFocus(opener);
            }
        },
    };
};
