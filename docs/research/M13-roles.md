# M13: roles, review and suggestions

The owner's decisions of 2026-11-07. Two new city roles, a review queue, a public way to ask for a role, a gallery of photos
with no place, and public suggestions on any photo. The security rules are the enforcement, the screens only follow them.

## 1. Who may do what

`admins/{uid}.cities[city]` holds one of `owner`, `editor`, `moderator`, `uploader` (`CITY_ROLES`). The older roles keep every
right they had. The two new ones are allow-listed, never subtracted: every existing rule still names `['owner', 'editor']`, so a
new role opens nothing it does not name.

| Path or action | stranger (Google) | uploader | moderator | editor | owner | other city's member |
| --- | --- | --- | --- | --- | --- | --- |
| `cities/{city}` read | no | yes | yes | yes | yes | no |
| `cities/{city}` update (settings) | no | no | no | yes | yes | no |
| `photos`, `pois` read | no | own only | yes | yes | yes | no |
| `photos`, `pois` create | no | pending only | no | yes | yes | no |
| `photos`, `pois` update | no | own, while pending | yes | yes | yes | no |
| set `published` on a pending or refused item | no | no | no (callable) | no (callable) | no (callable) | no |
| `photos`, `pois` delete | no | own, pending or refused | no | yes | yes | no |
| `poiCategories` read | no | yes | yes | yes | yes | no |
| `poiCategories` write, `layers`, `jobs`, `layerVersions`, `usgsScenes`, `usage`, `exports`, `workers`, `imageryPlans` | no | no | no | yes | yes | no |
| `photos/*/history`, `pois/*/history` read | no | no | yes | yes | yes | no |
| `cities/{city}/history`, collection group `history` | no | no | no | yes | yes | no |
| `setup/*`, `usage/*`, `ops/*` (project state) | no | no | no | yes | yes | yes (as before) |
| `suggestions`, `contributors` read | no | no | yes | yes | yes | no |
| `roleRequests` read | no | no | no | no | yes | no |
| any client write to `suggestions`, `contributors`, `roleRequests`, `reviewStatus`, `heldImage` | no | no | no | no | no | no |
| photo upload to Storage | no | own pending photo | any photo | any photo | any photo | no |
| raster upload | no | no | no | yes | yes | no |
| `review-held/` read | no | own photo | yes | yes | yes | no |

Callable access levels (`CallableAccess`): `cityEditor` means owner or editor, as it always did. `cityReviewer` adds moderator.
`admin` now means an account with an owner or editor role somewhere (or no city at all, as before); `member` is any admin
document, for the notification device calls only. A pure uploader or moderator therefore reaches no `setup.*`, `imagery.*`,
`assist.*`, `export.*`, `worker.*`, `usgs.*`, `layers.*` or `cities.*` callable.

`history.revert` is `cityReviewer`, and a moderator reverts only a `photo` or a `poi` (`apiError.city.notEditor` otherwise).

The `admin` claim still gates everything (claim and document), so removing the document revokes at once.

## 2. Review queue

An uploader's new photo or place carries `reviewStatus: 'pending'`, enforced by the create rule, with `published: false`. The
statuses are `pending`, `approved`, `refused`; a document without the field is an older or staff document and counts as approved.

- `reviewStatus`, `reviewNote`, `reviewedBy`, `reviewedAt` and `heldImage` are server-owned. The update rule refuses a change of
  `published` while the stored status is `pending` or `refused`, so approval has one door, `review.decide`.
- `review.decide` (`cityReviewer`): `approve` publishes the item and, for a photo, moves its held pictures to the public bucket.
  A place approved without a year answers `apiError.review.placeYear` (the owner's request of 2026-11-12: every place names a
  year; refusing it stays open).
  `refuse` needs no note, keeps `published: false` and deletes the held pictures. Deciding a decided item answers
  `apiError.review.alreadyDecided`. A photo not processed yet answers `apiError.review.notReady`. A licence of `unknown` answers
  `apiError.review.licenseUnknown`.
- **An approval is of what the reviewer saw**: `approve` must send `seenAt`, the item's `updatedAt` as the card read it; every write
  moves `updatedAt`, so anything newer answers `apiError.review.changed` and nothing moves. The card shows what an approval
  publishes: the title, the picture, the credit, the description and the links.
- The manifest builder drops any `pending` or `refused` document whatever its `published` says: a second lock.

### Held pictures

`photos.onUpload` writes a pending photo's two WebP derivatives to the **private** bucket under
`review-held/{city}/{photo}/{sha256}-{variant}.webp`, and records their paths in `heldImage`. Nothing of a pending photo is in the
public bucket, so no uploader gets a public address to share. The admin reads them with `getBlob` (`FilePort`) under the Storage
rule. Approval copies them to the content-hashed public paths and sets `image`.

Where an upload goes is decided when the trigger runs, from the photo's status and from who uploaded (the path's uid), because the
Storage rule only saw the status when the upload began:

| The photo's status | The path's uid is a reviewer of the city now | Anyone else |
| --- | --- | --- |
| `pending` | held | held |
| `refused` | refused, no address of any kind | refused, no address of any kind |
| `approved`, or none (an older or staff document) | public | refused: the image stays |

A refused upload answers `apiError.review.alreadyDecided` through the usual record: `replacement` on a photo that has an image,
`processing: 'failed'` on one that has none. A decision made while the upload runs wins: the held result never overwrites it.

## 3. Asking for a role

`#/contribute/<city>` is a page of the admin app, reached by the small Contribute link of the public map (`manifest.contributeUrl`,
§5). The map gains only that link: no sign-in code, no Firestore, no cookie.

- **The welcome** (the owner, 2026-11-08: a visitor was shown the admin's "Map administration" sign-in): signed out, the page's
  address shows a contributor's welcome in place of the admin's sign-in (`packages/admin/src/app/welcome.ts`, `<hcm-sign-in>`
  with `state.welcome`): the city's name, what contributing means (send photos and stories, suggest a photo's place or
  direction, become an uploader or a moderator once an admin approves), that Google is needed only to send something,
  **Sign in with Google to contribute** and **Back to the map**; the tab says Contribute. The map menu's link carries what
  the admin cannot read before sign-in (the rules let only members read `cities/{city}`): `?lang=` (the map's language)
  and `name` (the city's name in it, shown as text, at most 80 characters). A photo's link (its sheet, the gallery)
  carries neither, to keep the engine within its budget: the welcome then speaks the language the visitor chose on that
  city's map (`hcm:<city>:lang`, the same origin), else the admin's own choice, else Romanian, and names no city.
  **Back to the map** opens the city's map on the admin's own Hosting (M6 §2.4: the project's first city at `/`, any
  other at `/<city>/`). After sign-in an account of no role is a visitor and stays on the page (`contributing`), never on
  an admin screen.
- **Every state of the page is a contributor's** (lesson 515, DECISIONS §132): the sign-in asks for no Cloud scope; whether
  the server answers or not the signed-out page is the welcome (never the start-up mode's intro); signed in, a server that
  does not answer or is busy is "The map is resting. Try again in a minute." with Try again and Back to the map (`backendDown`),
  a refused session is the same panel with its reason (never `notAdmin`, the account stays signed in), and a map nobody set
  up (a start-up deploy, or `ownerClaimed: false`) is "Contributions to this map are not open yet." (`contributeClosed`):
  never Google's owner check, the claim or "Map administration". The account menu's statistics line names the Contribute page.

- `contribute.context` (`signedIn`): the city's public name and view, the caller's role and request, whether they are blocked, and
  with a `photoId` the published photo's public fields. A photo that is not public answers `apiError.notFound`.
- `contribute.request` (`signedIn`): `{cityId, role: 'uploader' | 'moderator', reason, credit?}` writes
  `cities/{city}/roleRequests/{uid}` and a `role.requested` notification to the city's owners. One open request per account; a
  refused account may ask again after `ROLE_REQUEST_RETRY_DAYS`; a blocked account is refused; a member whose role already covers
  the ask is refused (`apiError.contribute.alreadyMember`). An uploader may ask for `moderator`, and the page offers only that.
- An approved request says nothing once the role is gone (`admins.revoke` leaves the document): `contribute.context` answers
  `request: null` and the page shows the form again.
- `contribute.decide` (`cityOwner`): approve writes the role into `admins/{uid}` in one transaction with the request (the
  stronger role wins) and sets the `admin` claim; refuse records the decision and an optional note, which the applicant reads
  through `contribute.context`. The page says it the next time they open it.

The request stores the account's Google address and display name so the owner can recognise the person; `roleRequests` is readable
by the city's owners only. The address is never logged.

## 4. Suggestions

`suggestions.submit` (`signedIn`, no role needed; a city not public yet answers `apiError.notFound` to anyone but its own people, as
`contribute.context` does): `kind: 'place'` on a published photo with no location (location required,
direction optional), `kind: 'correction'` on a published placed photo (at least one of date, location, direction, plus a required
reason and an optional source link). Both take an optional credit name.

- **Limits**: `SUGGESTIONS_PER_DAY` per account per city, counted in a transaction on `cities/{city}/contributors/{uid}`.
- **Blocked accounts**: `contributors/{uid}.blocked` refuses suggestions and role requests (`apiError.contribute.blocked`).
  `contributors.setBlocked` is `cityReviewer`.
- **Grouping**: the document id is a hash of the photo, the kind and the proposal rounded (`SUGGESTION_GRID_DEGREES` for the
  location, `SUGGESTION_BEARING_STEP` for the direction), so repeats land on one document. An account counts once. A repeat of a
  decided proposal changes nothing and is still answered as received, so nobody learns to resubmit around a refusal.
- **Only what changes**: the form and the server both keep what differs from the photo, so a date correction carries no place and
  approving it cannot undo a move made since. The group's hash is of that. An end year keeps the start it was named with, because the
  schema refuses an end alone.
- **Decisions**: `suggestions.decide` (`cityReviewer`): `approve` applies the proposal, `adjust` applies the reviewer's values,
  `reject` applies nothing, `revert` takes one applied decision off. Applying is one transaction on the photo with the reviewer as
  `updatedBy`. A value that does not fit the photo answers `apiError.suggestion.invalid`, never an internal error. The public photo
  does not change before that. The `suggestion.waiting` notification goes to the city's reviewers, once per group.
- **Applying a date**: a year past the stored end replaces the range. A date text lands in the language it was typed in
  (`proposal.dateLocale`, Romanian when absent) and keeps the other. An approved year or end with no date text drops the stored text,
  which the viewer prefers and would keep showing. A text in English on a photo with none is also its Romanian, which a localized
  text cannot go without.
- **Revert**: a decision keeps its way back on the group (`undo: {before, after}`), so `revert` restores exactly the fields it wrote and
  never a later edit or another decision. A field someone changed since answers `apiError.suggestion.notRevertable` and nothing
  moves: `history.revert` stays for that, by hand. The group becomes `reverted`, and a decided group stays decided.
- **Adjusting**: latitude, longitude, direction, years and date text on the Review page as well as the pin. Adjusted to nothing new is
  recorded as `approved`.
- **Blocking** asks first. `#/review` lists blocked accounts (`contributors` where `blocked == true`) with what they wrote
  (`blockedFor`), and `contributors.setBlocked` with `blocked: false` lets them back; a voice of a blocked account says so.
- The photo's location, once set, keeps the bounds check of the manifest (`PHOTO_LOCATION_SLACK_DEG`): outside the city answers
  `apiError.suggestion.outsideCity`.

## 5. The manifest (additive)

- `photos[].location` stays required. `unplaced` is a new optional list of photos with no location, direction or field of view. The
  builder emits it only when not empty, and photo ids are unique across both lists.
- `contributeUrl`: the admin's address of `#/contribute/<city>`, optional, set by the builder when the project knows its admin
  address. A static export leaves it out: the copy has no backend of its own.
- `photos[].credit`, `unplaced[].credit`, `pois[].credit`: the optional credit name.

No release is tagged yet, so these join the v1 baseline every 1.x engine reads, as `photosOverlay` did, and need no `minVersion`
(`docs/ENGINE_API.md`, *Additions before 1.0.0*). An old manifest stays valid. Once 1.0.0 is tagged, an addition needs its minor
release and `city.engine.minVersion`.

`photoDocSchema.location` becomes optional because the document can wait for a place. `photos.create` rules: a location, when given,
is checked against the city as before; a direction or a field of view without a location is refused. An existing location cannot be
removed from a client: the rule's `inCity` errors on the missing key, and an error denies.

## 6. New paths and documents

| Path | Writer | Schema |
| --- | --- | --- |
| `cities/{city}/roleRequests/{uid}` | `contribute.request`, `contribute.decide` | `roleRequestDocSchema` |
| `cities/{city}/suggestions/{group}` | `suggestions.submit`, `suggestions.decide` | `suggestionDocSchema` |
| `cities/{city}/contributors/{uid}` | `suggestions.submit`, `contributors.setBlocked` | `contributorDocSchema` |
| `review-held/{city}/{photo}/{file}` (private bucket) | `photos.onUpload`, `review.decide` | none |

## 7. Notifications

Three new kinds, with an audience each (`NOTIFICATION_AUDIENCES`): `review.waiting` and `suggestion.waiting` reach reviewers,
`role.requested` reaches owners. Every older kind (a job, the budget, crashes) reaches `staff` only (owners and editors, or an
account with no city at all, as before), so a moderator is not told about imagery or billing.

## 8. The admin's screens

- Navigation: an uploader sees Photos, Places, Notifications; a moderator also Review. Any other route answers
  `adminShell.route.notAllowed` and opens the role's first page. The rules deny the data anyway.
- `#/review`: Uploads, Suggestions (current and proposed side by side on one map, approve, adjust, reject, block the account,
  Revert after an approval), Requests (owners only).
- `#/contribute/<city>` and `#/contribute/<city>/<photoId>`: the request form and the suggestion form with the photo editor's place
  and direction tool. This route shows whatever the account's role, and also on the `notAdmin` and `joinPending` screens.

## 9. Threats and what stops them

| Threat | Control |
| --- | --- |
| Uploader publishes own item | `published == false` on create, `published` not in the uploader's update list, the callable is `cityReviewer` |
| Uploader hosts a file publicly | Held pictures stay in the private bucket until approved; a refused photo's upload gets no address |
| Uploader replaces a published photo's picture | The Storage rule reads the photo (own and `pending`), and `photos.onUpload` decides again when it runs, from the path's uid: a late upload is refused |
| Uploader swaps text or a picture just before approval | `review.decide` binds to the `updatedAt` the reviewer saw (`apiError.review.changed`) |
| A client writes a document the schema refuses, stuck in every callable | The update rule enforces `aimedOnlyIfPlaced` as the create rule does |
| A stranger probes a city not public yet | `suggestions.submit` answers `apiError.notFound`, as `contribute.context` does |
| Uploader sets `reviewStatus: 'approved'` on create | The create rule requires exactly `pending` for that role |
| Moderator reaches settings or roles | Rules name `owner`, `editor`; `admins.*` and `cities.*` callables need the owner |
| Moderator reverts a city's settings | `history.revert` limits a moderator to `photo` and `poi` |
| Moderator or uploader reads Setup or budgets | `setup`, `usage`, `ops` need `isStaff()`; `admin`-access callables too |
| Stranger writes a suggestion directly | No client write rule at all; the callable checks the account, the block and the limit |
| Flooding | Daily limit per account per city; grouping keeps one document per proposal; lists in a document are capped |
| Script in a reason or a credit | Plain text only, rendered with Lit's text bindings; a source link must be https |
| Repeat after refusal | A decided group stays decided |
| Revoked member keeps a token | The rules and `requireAccess` read `admins/{uid}` on every request |
| Public learns of pending items | The manifest builder filters by status; pending documents are never readable without a role |

## 10. As built, and what is left

- A suggestion group keeps the photo's title and thumbnail from when it began (`photoTitle`, `photoThumb`), so the queue lists without reading each photo.
- A moderator or an uploader reads no `setup/status`, so the admin's map wears the city's public token (`cityTokenOf`), and the Contribute page passes the token `contribute.context` answered.
- The Contribute link is an item of the map's menu; a photo's sheet and the gallery hold a plain link to the page on that photo.
  The menu's carries the map's language and the city's name, for the signed-out welcome (§3).
- The gallery shows the same author, licence, rights holder and credit lines as a photo's sheet, and a place's sheet its credit.
- An uploader's place picker asks for their own photos, and their delete offers no Undo: bringing an item back reads its history.
- Left for a later change, none of it a way around the rules:
  - held pictures of a pending photo its uploader deleted stay in the private bucket until a sweep is added;
  - the editors' AI assists are still offered to a moderator or an uploader, whose call is refused (`cityEditor`) with its message;
  - a pending photo's earlier held pictures stay in the private bucket when its uploader replaces the file, until the same sweep;
  - an uploader's list shows no thumbnail for a pending photo (the Review page does, with the Storage rule);
  - no daily cap on an uploader's uploads, and the credit field exists on the photo editor only (a place takes `credit` through the rules and the schema, with no field yet).

## 11. The sources an uploader may use (M28, the owner 2026-11-13)

`docs/research/M28-sources.md` §7. An uploader uses every photo, map and data source the owner turned on in Setup → Sources (the collections drawn from by hand, Facebook's "ask the author", the open data) through Contribute, and everything they bring waits in Review as before. The online satellite sources (USGS, Landsat, Sentinel-2 searching and importing) cost money or the owner's quota and stay with the owner and the editors: `imagery.search` and the imports are `cityEditor`, the `usgsScenes` rules ask for a city member, the Imagery route is not in `LIMITED_ROUTES.uploader`, and Contribute tells an uploader why (`adminContent.contribute.satelliteNote`). An uploader's own map or satellite image, held for review, is planned (raster upload stays the editors' and the owner's). Rows: A182.
