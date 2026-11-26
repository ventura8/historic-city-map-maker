/**
 * The notifications' and the assists' states of the tour inventory (M4, docs/research/M4-interfaces.md §4, §5, §7.3;
 * `ADMIN_STATES` of e2e/tour/states.ts spreads them inside its notify section): the inbox with an unread item and the
 * badge, the empty inbox, push on this device and refused by the browser, ids `notify.<state>`; the title suggestions and
 * their refusal, a draft and its refusal in the photo editor, a draft in the place and layer editors, ids
 * `assist.<state>`. Each is reached by its spec at the admin tier's five projects (behind the tier's lock: the inboxes,
 * the geocoding queue and the server's fake upstreams are the project's).
 */
export const NOTIFY_STATES = {
    'notify.inbox': {
        title: 'Notifications: an unread item in the inbox, the badge on Notifications, and the device settings',
        visit: 'specs/notify/inbox.spec.ts',
    },
    'notify.inbox-empty': {
        title: 'Notifications: no notifications yet, nothing to mark',
        visit: 'specs/notify/inbox.spec.ts',
    },
    'notify.push-on': {
        title: 'Notifications: on for this device, with Send a test notification and the kinds to push',
        visit: 'specs/notify/push.spec.ts',
    },
    'notify.push-denied': {
        title: 'Notifications: the browser refused them, the inbox still works',
        visit: 'specs/notify/push.spec.ts',
    },
    // Finding 46 of 2026-11-01.
    'notify.push-failed-reason': {
        title: "Notifications: they did not start, with the reason line and its code (the SDK's or FCM's)",
        visit: 'specs/notify/push.spec.ts',
    },
    'assist.suggestions': {
        title: 'Photo editor: title suggestions from OpenStreetMap with the attribution and its licence link',
        visit: 'specs/assists/title.spec.ts',
    },
    'assist.suggestions-refused': {
        title: 'Photo editor: OpenStreetMap refused, the title stays the admin’s to type',
        visit: 'specs/assists/title.spec.ts',
    },
    'assist.draft': {
        title: 'Photo editor: an English draft of the title with the model’s note',
        visit: 'specs/assists/drafts.spec.ts',
    },
    'assist.draft-refused': {
        title: 'Photo editor: no draft, the AI is unavailable, the field as it was',
        visit: 'specs/assists/drafts.spec.ts',
    },
    'assist.place-draft': {
        title: 'Place editor: an English draft of the description with the model’s note',
        visit: 'specs/assists/drafts.spec.ts',
    },
    'assist.layer-draft': {
        title: 'Layer editor: an English draft of the label with the model’s note',
        visit: 'specs/assists/drafts.spec.ts',
    },
} as const;
