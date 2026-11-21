/**
 * The join's states of the tour inventory (M8, `docs/research/M8-join-interfaces.md` §8; `ADMIN_SECTION_STATES` of
 * e2e/tour/admin-sections.ts spreads them), each reached by the spec named in `visit` at the admin tier's projects, behind
 * the tier's lock.
 */
export const JOIN_STATES = {
    'imagery.date-rows': {
        title: 'Historical imagery: whole-city dates above the scenes, a summer date first, a winter note, a frame that needs ordering',
        visit: 'specs/imagery/join-dates.spec.ts',
    },
    'imagery.join-offer': {
        title: 'Historical imagery: a frame of part of the city waiting for approval, the offer to join its date and Join frames',
        visit: 'specs/imagery/join.spec.ts',
    },
    'imagery.join-waiting': {
        title: 'Historical imagery: a join waiting for its frames, each with its state and link',
        visit: 'specs/imagery/join.spec.ts',
    },
    'imagery.join-part-needs-points': {
        title: 'Historical imagery: a join held by a frame that needs points, its row linking the georeferencer',
        visit: 'specs/imagery/join.spec.ts',
    },
    'imagery.join-holds': {
        title: 'Historical imagery: a frame a join holds, the link to the join, its Approve refused and why',
        visit: 'specs/imagery/join.spec.ts',
    },
    'imagery.join-approval': {
        title: "Historical imagery: a rendered join over the threshold: its coverage, seams, worst frame's error, largest shift, Approve",
        visit: 'specs/imagery/join.spec.ts',
    },
    'imagery.join-unmeasured': {
        title: 'Historical imagery: a rendered join whose seam could not be measured says so and waits for Approve',
        visit: 'specs/imagery/join.spec.ts',
    },
    'imagery.join-no-seams': {
        title: 'Historical imagery: a rendered join whose frames never meet says so, no list of seams, and waits for Approve',
        visit: 'specs/imagery/join.spec.ts',
    },
    'imagery.join-seam-refused': {
        title: 'Historical imagery: a rendered join whose correction did not help says nothing moved and waits for Approve',
        visit: 'specs/imagery/join.spec.ts',
    },
    'imagery.join-refused': {
        title: "Historical imagery: Join frames refused by today's limit, why, beside the button; nothing was created",
        visit: 'specs/imagery/join.spec.ts',
    },
    'imagery.join-waiting-free': {
        title: 'Historical imagery: Join frames refused for a busy layer, then waiting for it to end, said beside the button',
        visit: 'specs/imagery/join-wait.spec.ts',
    },
    'imagery.join-failed': {
        title: 'Historical imagery: a join whose frames lie too far apart failed, why, each frame linking the georeferencer',
        visit: 'specs/imagery/join.spec.ts',
    },
} as const;
