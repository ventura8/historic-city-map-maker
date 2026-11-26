/**
 * The editors' daily flows and how many in-app inputs each may take (`docs/research/M2c-interfaces.md` §5.6; behaviour
 * A30): clicks, fills, file choices and key presses that commit, as the Setup Assistant's `SETUP_STEP_SPECS` count them.
 * The e2e tier reads these (`@hcm/admin/content/budgets`, CR-M2c-11) and fails a flow that takes more
 * (`S-A30-HAPPY-CONTENT`). `perVertex` adds one input per vertex of a drawn shape, `perMove` one per slider moved.
 *
 * Shared by every workstream: one marked section per area (§11.2); a workstream adds its flows inside its own section.
 */
export interface ContentFlowBudget {
    /** The inputs of the happy path. */
    readonly inputs: number;
    /** What the flow is, as the contract's table says it. */
    readonly how: string;
    /** One more input per vertex (a polygon of n vertices), or per slider moved. */
    readonly per?: 'vertex' | 'move';
}

export const CONTENT_INPUT_BUDGETS = {
    // [section photos] owner: photos
    photoBatch: { inputs: 3, how: 'drop (or choose) the files, Select all, Publish' },
    photoWithoutExif: { inputs: 4, how: "the batch's 3, plus one drag of the pin (or Confirm place at the last pin)" },
    photoDirection: { inputs: 3, how: 'Set direction, a click on what the camera looked at, Save' },
    photoReplace: { inputs: 2, how: 'Replace image in the overflow menu, choose the file' },
    // [end photos]
    // [section pois] owner: pois
    pointPlace: { inputs: 6, how: 'Add place, Point, a click, the Romanian title, the year, Save' },
    polygonPlace: { inputs: 5, how: 'Add place, Area, n clicks (the last on the first vertex), the title, the year, Save', per: 'vertex' },
    geojsonImport: { inputs: 3, how: 'choose the file, one category for the uncategorised features, Import' },
    // [end pois]
    // [section layers] owner: layers-settings
    layerAdjustments: { inputs: 1, how: 'the sliders, Save', per: 'move' },
    // [end layers]
    // [section settings] owner: layers-settings
    category: { inputs: 3, how: 'Add category, the Romanian label (the icon follows it until one is picked), Save' },
    // [end settings]
    // [section ops] owner: ops-screens
    deleteAndUndo: { inputs: 3, how: 'Delete, confirm, Undo' },
    inviteAdmin: { inputs: 3, how: 'Invite, the address, Invite in the dialog (the link is copied at once)' },
    revokeAdmin: { inputs: 3, how: "the admin's row, Remove access, confirm" },
    revertChange: { inputs: 3, how: 'the version, Revert, confirm' },
    cancelJob: { inputs: 3, how: "the job's row, Cancel job, confirm" },
    // [end ops]
    // [section imagery] owner: admin-imagery (docs/research/M3-interfaces.md §1)
    importScene: { inputs: 1, how: 'Import on a free scene (the search ran when the page opened; Search adds one)' },
    approveVersion: { inputs: 1, how: 'Approve on the approval card' },
    uploadGeotiff: { inputs: 3, how: 'Upload, choose the georeferenced file, Approve' },
    chooseStudio: { inputs: 3, how: 'Free: Studio, Download, I uploaded it (plus the upload in Mapbox Studio)' },
    georeferencePair: { inputs: 2, how: 'a click on the scan, a click on the same place on the map (per pair)' },
    joinFrames: {
        inputs: 1,
        how: 'Join frames on a date, a frame or a rendered frame (docs/research/M8-join-interfaces.md §6); Approve is its own',
    },
    cropLayer: { inputs: 2, how: 'Crop, n clicks (the last on the first corner), Save the crop', per: 'vertex' },
    // [end imagery]
    // [section orders] owner: orders (docs/research/M4-interfaces.md §1.6)
    buyScan: { inputs: 2, how: 'Order in EarthExplorer (the purchase there is the admin’s own step), then I ordered it' },
    checkOrderNow: { inputs: 1, how: 'Check now on an ordered scene (the daily watch needs none)' },
    // [end orders]
    // [section autogcp] owner: autogcp (docs/research/M4-interfaces.md §2.5)
    acceptSuggestions: { inputs: 2, how: 'Accept all on the suggestions, Save' },
    // [end autogcp]
    // [section assists-notify] owner: assists-notify (docs/research/M4-interfaces.md §4.5, §5.6)
    suggestTitle: { inputs: 1, how: 'a suggested title (the suggestions come as soon as the place is set)' },
    translateDraft: { inputs: 2, how: 'the draft button of the other language, Save' },
    readNotification: { inputs: 1, how: 'the item in the inbox (it opens its page and is marked read)' },
    pushOn: { inputs: 2, how: 'Notifications on this device, Allow in the browser’s own prompt' },
    // [end assists-notify]
    // [section cities] owner: multi-city (docs/research/M5-interfaces.md §1.5 to §1.8)
    // The M5 UX review (docs/LESSONS.md 252): the name finds the city on OpenStreetMap and its rectangle is drawn for it.
    newCity: { inputs: 2, how: 'the Romanian name (the id and the rectangle follow it), Create the city' },
    newCityDrawn: { inputs: 3, how: 'a name OpenStreetMap does not know, one drag of the rectangle on the map, Create the city' },
    switchCity: { inputs: 2, how: 'the city in the bar, the other city in its menu' },
    inviteToCity: { inputs: 3, how: 'Invite, the address (the role is editor unless changed), Invite in the dialog' },
    setCityRole: { inputs: 3, how: "the admin's row, the role, confirm" },
    setCityLimits: { inputs: 1, how: 'the fields of the city’s budget, Save', per: 'move' },
    // The integrator (DECISIONS-for-review.md §63a): Settings → Publishing.
    publishCity: { inputs: 2, how: 'the switch The city is public, Save' },
    // [end cities]
    // [section export] owner: export (docs/research/M5-interfaces.md §5.6)
    exportCity: { inputs: 2, how: 'Export, then Download once the archive is ready' },
    exportWithRasters: { inputs: 3, how: 'Include the USGS scans, Export, Download' },
    // [end export]
    // [section setup-ux] owner: setup-ux (docs/research/M6-interfaces.md §4.2, §6.2)
    skipUsgs: { inputs: 1, how: 'Do it later on the USGS card (the next step opens)' },
    dismissTrial: { inputs: 1, how: 'It is a paid account on the free-trial reminder of Home' },
    // [end setup-ux]
    // [section install] owner: installer (docs/research/M6-interfaces.md §1.7, §4.2; plus one Google consent in daily use)
    updateMap: { inputs: 1, how: 'Update the map on the card of a target behind the admin (every target behind, one build each)' },
    installOver: { inputs: 2, how: "Install this admin's version anyway on a card newer than the admin, then Install it in the dialog" },
    // [end install]
} as const satisfies Readonly<Record<string, ContentFlowBudget>>;

export type ContentFlow = keyof typeof CONTENT_INPUT_BUDGETS;

/** The budget of `flow` for a shape of `vertices` vertices or `moves` slider moves (zero for the others). */
export function contentFlowBudget(flow: ContentFlow, extra = 0): number {
    const budget: ContentFlowBudget = CONTENT_INPUT_BUDGETS[flow];
    return budget.inputs + (budget.per === undefined ? 0 : extra);
}
