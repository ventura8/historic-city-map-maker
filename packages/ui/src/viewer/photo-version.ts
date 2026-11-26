/**
 * A photo's versions (the owner 2026-11-09): the original (`image`) and, when the photo has them, an improved and a colorized
 * one, each with its own credit. The detail sheet and the full-size view show the same version: the visitor's pick
 * (`photoVersion`, the URL hash's `pv=`) when the photo has it, else the improved one when there is one, else the original
 * (colorized is never the default). A segmented button switches between them, only when there is more than one.
 */
import { translate, type ViewerLocale, type Photo, type PhotoImage, type PhotoView } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { EMPTY } from './empty.js';

type Versioned = Pick<Photo, 'image' | 'versions'>;

/** The versions `photo` has, in order: the original, then improved and colorized. */
export function photoViews(photo: Versioned): PhotoView[] {
    return ['original', ...(['improved', 'colorized'] as const).filter((view) => photo.versions?.[view] !== undefined)];
}

/** Whether the photo has more than its original: only then is there a switch. */
export function hasVersions(photo: Versioned): boolean {
    return photoViews(photo).length > 1;
}

/** The version shown for the visitor's `pick` (null: none). */
export function shownView(photo: Versioned, pick: PhotoView | null): PhotoView {
    const views = photoViews(photo);
    if (pick !== null && views.includes(pick)) {
        return pick;
    }
    return views.includes('improved') ? 'improved' : 'original';
}

/** The image of version `view` (the original when the photo does not have it). */
export function viewImage(photo: Versioned, view: PhotoView): PhotoImage {
    return (view === 'original' ? undefined : photo.versions?.[view]) ?? photo.image;
}

/** "Colorized by …" under a version that names who made it; nothing for the original. */
function creditOf(photo: Versioned, view: PhotoView): string | undefined {
    return view === 'original' ? undefined : photo.versions?.[view]?.credit;
}

export function viewCredit(photo: Versioned, view: PhotoView, locale: ViewerLocale): TemplateResult {
    const credit = creditOf(photo, view);
    const key = view === 'colorized' ? 'photoVersion.colorizedBy' : 'photoVersion.improvedBy';
    return credit === undefined ? EMPTY : html`<p class="supporting">${translate(locale, key, { credit })}</p>`;
}

/** The fired event: `hcm-photo-version` with `{view}`, which the viewer turns into `store.setPhotoVersion`. */
function photoVersionEvent(view: PhotoView): CustomEvent<{ readonly view: PhotoView }> {
    return new CustomEvent('hcm-photo-version', { bubbles: true, composed: true, detail: { view } });
}

/** The switch between the versions (`hasVersions`: a photo with only its original has none). */
export function versionSwitch(photo: Versioned, view: PhotoView, locale: ViewerLocale, host: EventTarget): TemplateResult {
    const options = photoViews(photo).map((value) => ({ value, label: translate(locale, `photoVersion.${value}`) }));
    const onChange = (event: CustomEvent<{ readonly value: PhotoView }>): void => {
        host.dispatchEvent(photoVersionEvent(event.detail.value));
    };
    return html`<hcm-segmented-button
        class="versions"
        .options=${options}
        .value=${view}
        .label=${translate(locale, 'photo.versions')}
        @hcm-change=${onChange}
    ></hcm-segmented-button>`;
}
