/** A place the photo and layer editors' place picker offers (M17 §12); a port type of its own, so the area ports import nothing else. */
export interface PlacePickPort {
    readonly id: string;
    readonly title: { readonly ro: string; readonly en?: string | undefined };
}
