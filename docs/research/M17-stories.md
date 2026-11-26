# M17: stories

The owner's decision (2026-11-08): a new kind of content, the **story**. A story is a titled text in Romanian and English (more
languages later), linked to photos, places and years, read in the public map and edited in the admin with history and revert
like a photo or a place. Uploaders may write stories that wait in the review queue of M13 (`M13-roles.md`); moderators and staff
approve them. No HTML comes from data: the text is a small safe format our own templates render. The pictures inside a story are
the city's own photos only. The manifest gains an additive `stories` list, and the static export carries it.

This file is the contract, written before the code; §10 says what was built.

## 1. The document

`cities/{city}/stories/{story}` (`storyDocSchema`, `packages/shared/src/schemas/story.ts`):

| Field | Type | Notes |
| --- | --- | --- |
| `title` | `{ro, en?}`, 1 to 200 | Required, never blank. |
| `body` | `{ro, en?}`, 1 to 10 000 | The story text (§3). Optional while a draft: a published story without it is refused by the editor and skipped by the builder. |
| `yearStart`, `yearEnd` | 1800 to 2100 | Either may be absent, never inverted (`validYearSpan`, as a place). |
| `photoIds` | ids, at most 20 | Photos the story is about; the first is its cover. |
| `poiIds` | ids, at most 20 | Places the story is about. |
| `published` | bool | |
| `reviewStatus`, `reviewNote`, `reviewedBy`, `reviewedAt`, `credit` | M13's `reviewFields` | Server-owned but for an uploader's `reviewStatus: 'pending'` on create. |
| `createdAt`, `createdBy`, `updatedBy`, `updatedAt` | the stamp | As every client write. |

`CLIENT_WRITES.story`: `title`, `body`, `yearStart`, `yearEnd`, `photoIds`, `poiIds`, `credit`, `published` and the stamp; a create
adds `createdAt`, `createdBy` (and an uploader's `reviewStatus`).

## 2. Who may do what

The rules copy the place's (`firebase/firestore.rules`, `match /stories/{story}`), so M13's table holds with one more row:

| Action | stranger | uploader | moderator | editor | owner | other city's member |
| --- | --- | --- | --- | --- | --- | --- |
| `stories` read | no | own only | yes | yes | yes | no |
| `stories` create | no | pending only, unpublished | no | yes | yes | no |
| `stories` update | no | own, while pending, never `published` | yes, `published` only through `review.decide` while pending | yes | yes | no |
| `stories` delete | no | own, pending or refused | no | yes | yes | no |
| `stories/*/history` read | no | no | yes | yes | yes | no |

- `review.decide` takes `entity: 'story'`: approve publishes it, refuse keeps it private; `seenAt` binds the approval to what the
  reviewer read, as for a place. A story without its text answers `apiError.review.storyEmpty` to an approval (the builder would
  list nothing, and the approved story would no longer be the uploader's to write); refusing it stays open.
- `history.revert` takes `entity: 'story'`, and a moderator may revert one (photo, place, story).
- The audit triggers `history.onStoryWrite` and the publish trigger `publish.onStoryWrite` join the families.

## 3. The text format

A story's body is the Markdown subset of the city's texts (`text/markdown.ts`): paragraphs separated by a blank line, a single
line break kept, `**bold**`, `_italic_` or `*italic*`, `[label](https://…)` links (https only: anything else stays literal text
and the schema refuses it, `validation.markdownLink`), `\` escaping. Stories add one block (`text/story.ts`, `parseStory`):

```text
![The National Theatre, 1937](photo:p-teatru)
```

A paragraph that is **exactly** an image of `photo:<id>` (an id of `ID_PATTERN`, a caption of at most 300 characters, possibly
empty) is a figure of that photo. Anything else that looks like an image (an https picture, a `photo:` inside a sentence, a
`javascript:` target) stays plain text, so no address outside the city's photos is ever loaded. Nothing in the format produces
HTML: the parser returns a tree (`paragraph` with inline nodes, or `figure` with a photo id and a caption), and the viewer walks
it with Lit templates (`renderStory`), as it does the About text.

The body's figures are not references the manifest checks: a photo unpublished later must not take a story down with it. The
viewer leaves out a figure whose photo the manifest does not list. `photoIds` and `poiIds` are checked (§4).

## 4. The manifest (additive)

`stories` is an optional list (at most `MAX_STORIES`, 1000), emitted only when not empty, so a manifest from before it stays valid
and every 1.x engine reads it (`docs/ENGINE_API.md`, *Additions before 1.0.0*; no release is tagged yet). An entry is `{id, title,
body, yearStart?, yearEnd?, photoIds?, poiIds?, credit?}`, the texts `{ro, en?}` (Romanian is the fallback, as a photo's).

- `manifestRuleIssues`: unique story ids; every `photoIds` entry a photo of `photos` or `unplaced`; every `poiIds` entry a place
  of `pois` (`validation.reference`).
- The builder lists published, review-cleared stories with a body, sorted by id, and drops from `photoIds` and `poiIds` what the
  manifest does not list (an unpublished photo leaves the story, never the story the manifest), as it does a place's photos.
- The static export keeps `stories`, and drops from each story's `photoIds` the photos it does not carry (the unplaced ones).

## 5. The public map

A story may link aerial photos as it links any photo: since 2026-11-16 an aerial photo is a photo of the kind `aerial`
(`docs/research/M28-sources.md` → *Aerial photos are photos*), never a layer, so `photoIds` covers both kinds.

**An aerial photo's viewed area** (the owner, 2026-11-22): beside its cone (direction and field of view), an aerial photo
has `viewedArea`, the ground it shows: four `{lat, lng}` corners in order, a rectangle (taken straight down) or a
trapezoid (taken at an angle). `viewedAreaSchema` (`packages/shared/src/schemas/primitives.ts`) keeps it a convex
quadrilateral that never crosses itself (`isConvexQuad`, `packages/shared/src/geo/area.ts`; refused with
`validation.viewedArea`), the rules keep it a list of four and only on a placed photo, and the manifest carries it
(`functions/src/publish/assemble.ts`). In the admin, the photo editor's *Place and direction* shows, for a placed aerial
photo, **Draw the area in front of the camera** (`areaAhead`: a trapezoid 100 to 400 m along the direction, as
wide as the field of view), then **Reset the area to the direction and field of view** and **Remove the area**; the map
loads the area into the drawing tools beside the pin (`photo-area`, `packages/admin/src/photos/map.ts`), so each corner
is dragged; a fifth corner or a crossing is refused with `adminContent.photos.area.refused`. The public map draws the
area translucent and dashed-outlined (`hcm-photos-area-fill` / `-line`, `packages/ui/src/map/photos.ts`) only while the
photo is selected (the engine's `focus`) or hovered (the adapter's), at every zoom. Scenarios A195, V77.

- **Where a story is found**: a Stories item in the map's menu (when the city has any) opens the list, newest year last; a
  photo's sheet and a place's sheet list the stories that name them; a story's own link is the hash `#story=<id>` (and
  `&story=<id>` after the view), which the Share button copies while a story is open.
- **The list** (`<hcm-story-list>`): the cover thumbnail (the first linked photo, else the first figure), the title and the years.
- **The story** (`<hcm-story-sheet>`): the title, the years, the body with its figures (the photo's thumbnail and the caption;
  a click opens that photo), the linked places and photos as buttons that open them, and the contributor's credit. On a phone
  it is the same bottom sheet as a photo's, resizable, with the text at the body size and a line length the sheet sets.
- **The timeline**: opening a story with a year moves the timeline to the stop nearest its first year, so the map shows the
  city as the story tells it; closing the story leaves the timeline where it is. A link that carries both `story=` and `layers=`
  (the visitor moved the timeline with the story open, then shared) opens the story with the link's own layers and their year.
- An unknown id in the hash shows `error.unknownStory` and opens nothing.

## 6. The admin

- `#/stories` lists the city's stories (title, years, Unpublished, Waiting for review) with New story; `#/stories/<id>` opens the
  editor: title and text in both languages, the years, the linked photos and places (chips, added from the city's photos and
  places by title), Published (staff), Save with the conflict banner, Discard, Delete with a confirmation, and Versions
  (`#/history/story/<id>`, where Revert restores a version).
- The editor follows the city role as the rules do: a moderator gets no New story and no Delete (the rules refuse both); an
  uploader deletes only their own waiting or refused story; Versions shows to staff only, since `#/history` is not a route of
  a moderator or an uploader (`LIMITED_ROUTES`). A moderator's revert of a story stays `history.revert` (S-A100-HAPPY-REVERT)
  until the history route opens to moderators for their entities.
- New story asks for the Romanian title and creates the document unpublished (pending for an uploader), then opens it.
- An uploader sees and edits only their own stories while they wait; a moderator sees all; the navigation shows Stories to both.
- The review queue lists waiting stories with the photos and places, and Approve or Refuse as for a place.
- The area is its own lazy chunk (`stories`, a measured row in `scripts/ci/check_bundle_budget.py`); its texts are a catalogue
  folder of their own (`packages/shared/src/i18n/admin-stories/`), merged into the admin's catalogues in the entry, which has room.

## 7. Threats and what stops them

| Threat | Control |
| --- | --- |
| Script or markup in a story | The format is parsed to a tree and rendered with Lit's text bindings; no `innerHTML`, no HTML parser |
| A picture from anywhere | Only `photo:<id>` figures exist; any other image syntax is text; the picture comes from the manifest's photo entry |
| A `javascript:` or `http:` link | Kept as text and refused by the schema (`validation.markdownLink`) |
| An uploader publishes their story | `published == false` on create, `published` not in their update list, `review.decide` is the door |
| An uploader swaps the text just before approval | `seenAt` (`apiError.review.changed`) |
| A moderator approves a story saved with its title only | `apiError.review.storyEmpty`; the story stays pending and the uploader's |
| A pending story reaches the public | The builder drops `pending` and `refused` whatever `published` says |
| A huge story | 10 000 characters per language in the schema and the rules; 1000 stories per manifest |

## 8. Scenarios

Viewer V50 (menu, list, story, figures, timeline, link; bad: an unknown id, markup stays text, a figure of a photo not listed, a
link's own layers kept over the story's year);
admin A100 (create, edit, publish, history and revert; bad: an http link refused, an uploader's story waits and cannot publish, a
story without text is not approved, a moderator gets no New story, Delete or Versions);
`functions` and `rules` rows for the builder, `review.decide`, `history.revert`, the export and the rules. The rows are in `e2e/scenarios.json`.

## 9. Left for later

- More languages than Romanian and English follow the catalogue work of the 16 languages.
- A story's own AI assists (translation drafts) and the Contribute page's "write a story" for strangers.

## 10. As built

Built on `track/stories` (2026-11-08), as designed above, with these details:

- **Code.** The format: `packages/shared/src/text/story.ts` (`parseStory`, `storyFigureIds`, `storyRejectedLinks`); the schemas:
  `packages/shared/src/schemas/story.ts` (`storySchema`, `MAX_STORIES`) and `storyDocSchema` in `firestore.ts`; the manifest rule
  `storyReferences` in `manifest-rules.ts`; the hash's `story=` in `url/hash.ts`. The functions: `storyEntry` in
  `functions/src/publish/assemble.ts`, `exportedStories` in `functions/src/export/plan.ts`, `decideText` in
  `functions/src/photos/review-decide.ts` (a place and a story alike), `REVIEWED_ENTITIES` in `functions/src/history/revert.ts`.
  The rules: `validStory` and `match /stories/{story}`. The viewer: `withStory` in `packages/engine/src/core/state.ts`, `openStory`
  in the store, `<hcm-stories>` (`packages/ui/src/viewer/hcm-stories.ts`) in the sheet of `viewer-stories.ts`, `relatedStories` in
  the photo's and the place's sheet, the menu's Stories (icon `museum`, already in the icon font). The admin: `packages/admin/src/stories/`
  (the store on `EditDraft`, `LiveDoc`, `LiveList` and `readOnce`, all already in `editor-shared`), `<hcm-stories-page>`
  (`packages/ui/src/admin/stories/`), the route `stories` after Places (an uploader's and a moderator's navigation include it), and
  the review queue's third list (`storyItem` in `packages/admin/src/review/rows.ts`).
- **The editor.** New story takes a Romanian title and creates the document at once, unpublished (pending for an uploader): the
  editor then works on a stored document as the layer editor does, with Save of the changed fields, the conflict banner, Discard and
  Delete after a confirmation. A published story without a text is refused at the text (`storyIssues`). The pickers read the city's
  photos and places once (an uploader's own only, which is what the rules let them read).
- **An uploader's New story.** The admin's create is a transaction that reads the id first, and the place's read rule denies a
  document that does not exist; the stories rule lets an uploader read an id with no document (`resource == null`), which says
  nothing (`docs/LESSONS.md` 445; the same gap likely stands for an uploader's own place or photo created in the admin).
- **Notifications.** `review.waiting` comes for free: `history.onStoryWrite` runs the same `tellReviewers` as every audited entity.
- **Budgets** (measured on the NUC, gzip level 9): the `stories` chunk 4.4 KB after the review of 2026-11-08 (row 5 KB, new), `review` 5.0 of 5, the admin's total
  647.9 of 650, the entry 379.2 of 450, `engine.mjs` 96.3 of 100, `engine.iife.js` 124.0 of 125. No row rose. `editor-shared` reached
  13,001 bytes of 13,000 once the new area imported the kit it shares; `packages/ui/src/viewer/markdown.ts` moved to the
  `editor-texts` group (`packages/admin/vite.config.ts`), which brings it to 12.8 (DECISIONS §102).
- **Left for later.** A story's AI translation draft; a picker for figures (the text names a photo by its id, which the photo's
  address in the admin shows); more languages; the Contribute page's "write a story" for someone without a role.

## 11. At the merge with the improvements (2026-11-08)

Home's *What needs you* (M18 item 7) lists the stories waiting in the review queue, *Stories to review*, a link to `#/review`; an uploader is not asked that count (S-A40-HAPPY-STORIES-TO-REVIEW, S-A40-BAD-UPLOADER-NO-STORY-COUNT; DECISIONS §104c).

## 12. A place's media (the owner, 2026-11-22)

A place (POI) shows its own media, sorted by kind: **old maps** of that place (small-area plans, the 1906 exhibition plan of
Parcul Carol), **aerial** photos, **exterior** (street) photos and **interior** photos. Built on what exists:

| Field | Where | Notes |
| --- | --- | --- |
| `kind` | photo document and manifest photo | `ground` (absent: street or exterior), `aerial`, and now `interior` (`PHOTO_KINDS`). |
| `placeIds` | photo document and manifest photo (placed or unplaced) | 1 to 10 POI ids, each once (`placeIdsSchema`, `MAX_MEDIA_PLACES`); the rules check list, size and uniqueness. |
| `placeIds` | layer document and manifest layer | The same, for a small-area map: a normal georeferenced layer whose footprint is its `bounds`. |
| `photoIds` | place (existing) | The place's own ordered list; the place editor now moves each photo up or down. |

- **The order** (`placeMedia`, `packages/shared/src/overlays/place-media.ts`): the place's `photoIds` first, in order, then the
  photos naming it in `placeIds` by year; maps naming it by year. Unknown ids are skipped.
- **The manifest**: the builder copies `placeIds` and drops ids of places it does not list (`stillListed`); the manifest rule
  `mediaPlaces` refuses a `placeIds` entry that is not a place of `pois` (`validation.reference`). The viewer reads only the manifest.
- **The viewer**: the place's sheet (`<hcm-poi-detail>`) has a **Media** section with one chip per kind it has (Hărți / Aeriene /
  Exterior / Interior; `poi.media.*` in the 16 catalogues). A photo opens the photo sheet; a map fires `hcm-layer-show`, which
  switches the layer on and to the front at its year (`pickLayer`) and fits its bounds (`viewForLayer`). The photo list gets an
  Interior filter when a photo is interior.
- **The admin**: the photo editor's kind (Street, Aerial, Interior) and **Places** (`placeLinksField`,
  `packages/ui/src/admin/editing/place-links.ts`; the places read once, `readPlacePicks`); the layer editor's **Places** under
  Display; the place editor's photos move up and down. The legacy bundle importer copies `kind` and `placeIds`; the GeoJSON place
  importer already takes `photoIds`.
- **Scenarios**: V80, A198, A199.

**Next** (`reports/PLAN-live.md` → *Buildings and photos*): floor plans per level (a layer with `placeIds` and a `level`), a level
picker in the place's sheet, interior photos placed on a level, the plan importer (trim, deskew, split floors), structured place
facts (architect, years built and demolished, style, floors and height, uses, LMI code, addresses, related places), and a
"Place media" entry in the Layers panel's Places section.

## 13. A place's facts (the owner, 2026-11-22)

A place carries structured facts, `facts` on its document and in the manifest (`placeFactsSchema`,
`packages/shared/src/schemas/place-facts.ts`); every field is optional:

| Field | Type | Notes |
| --- | --- | --- |
| `architects` | text[], 1 to 10 | |
| `yearBuilt`, `yearDemolished`, `yearAbandoned` | years 1500 to 2100 | built never after demolished |
| `style` | `{ro, en?}` | |
| `floors` | int 0 to 200 | |
| `heightM` | 0 to 1000 | metres |
| `uses` | `[{use: {ro, en?}, yearStart?, yearEnd?}]`, at most 20 | |
| `lmiCode` | `B-II-m-A-18925` | the List of Historic Monuments' code (`LMI_CODE_PATTERN`) |
| `addresses` | `[{text, yearStart?, yearEnd?, current?}]`, at most 20 | `current: true` is today's |
| `relatedPlaceIds` | POI ids, 1 to 20, each once | the builder drops places it does not list; the manifest rule refuses an unknown one |

- **The rules** keep the keys, the years, floors, height, the LMI pattern and the list sizes (`validFacts`); zod checks the rest.
- **The viewer**: the place's sheet shows *About the place* (`poi.facts.*`, 16 catalogues), each fact a row of a description
  list, a related place a button that opens it (`hcm-poi-select`). Values are text.
- **The admin**: the place editor's *About the place* (`poi-facts-fields.ts`): architects separated by commas, the years,
  style in both languages, floors, height, the LMI code, uses and addresses one per line (`1906-1940: Pavilion`,
  `azi: Str. …`; `facts-text.ts`) and the related places from the loaded list. A field writes when the admin leaves it.
- **Import**: a GeoJSON feature's `properties.facts` (the content agent's facts.json, per place, in the same shape) is taken
  when `placeFactsSchema` accepts it, else dropped with the place kept; the export writes it back. A `null` part or an
  empty list means "not known" and is dropped before the check (2026-11-23: `"yearEnd": null` cost a researched file all
  its facts). A feature with no `title` takes `name` as its title (what OSM and most GIS tools write).
- **An import updates the whole place**: a feature naming an existing id replaces its title, links, photo ids and
  categories with the file's; to change only the facts of a live place, use the editor's *About the place*.
- **Scenarios**: V81, A200.

## 14. Building plans per level (the owner, 2026-11-22)

A building's plans are map layers that name the place (`placeIds`) and carry a **level**: `level: {order, label: {ro, en?}}`
on the layer (`planLevelSchema`); `order` sorts the levels (-1 a basement, 0 the ground floor, 0.5 a mezzanine, 1 the first
floor). An interior photo says where it was taken with `level`, the order of that level (`levelOrderSchema`, -10 to 200).

- `placeMedia` keeps a place's maps without a level under **Maps** and groups the leveled ones under **Plans**
  (`plans: [{order, label, layers, photos}]`, lowest first; the first label of an order names it), each level with the
  interior photos of that order. An interior photo is also listed under Interior.
- **The viewer**: the Plans chip shows a level picker (`place-plans.ts`, one radio per level), then the chosen level's plans
  (Show on the map: on, at its year, fitted) and its photos.
- **The admin**: the layer editor's level (order and Romanian name, `level-row.ts`; both empty: an ordinary map), the photo
  editor's Level for an interior photo. The rules keep the shapes (`validLevel`, a number for a photo).
- **Next**: placing interior photos on the plan itself and the plan importer (trim, deskew, split floors) that waits for the
  admin to place each level (`reports/PLAN-live.md` → *Buildings and photos*). Scenarios: V82, A201.

## 15. Place media in the Layers panel (the owner, 2026-11-22)

The engine adds, after validating the manifest, a POI category **Place media** (`place-media`, `withPlaceMedia`, off at
first): every place that has media, once per kind it has (Maps and Plans drawn as their layers' footprints, the other
kinds at the place), each entry keeping the place's id so a click opens the place. Each kind is a sub-group
(`media:maps`, `media:plans`, `media:aerial`, `media:ground`, `media:interior`), so the panel's chevron (the sub-groups of
`overlay-subgroups.ts`, the place `group` work) shows one switch per kind and the map leaves out a kind switched off. The
category is never written to a manifest; a city with a category of that id, or without media, is left as it is. Its name is
Romanian and English only (category labels are city data). Scenario V83.
