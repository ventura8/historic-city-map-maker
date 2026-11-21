/**
 * Finding 65 of 2026-11-02 (`DECISIONS-for-review.md` §85a): Provision's item set is versioned (`PROVISION_SET_VERSION`,
 * `PROVISION_CHANGED_IN` of `@hcm/shared`). An update (Update the map, Install) runs the items whose definition changed
 * since the version `setup/status.provision.setVersion` records, in the same click and consent as the builds; a run that
 * reported every such item `ok` records the current version, so the next update runs nothing of Provision.
 */
import { PROVISION_SET_VERSION, provisionDue, type ProvisionItem, type ServiceState } from '@hcm/shared';

interface ItemState {
    readonly id: ProvisionItem;
    readonly state: ServiceState;
}

/** The items an update also applies: none for a project never prepared (step c's own first run does everything). */
export function updateItems(provision: {
    readonly items: readonly ItemState[];
    readonly setVersion?: number | undefined;
}): readonly ProvisionItem[] {
    const prepared = provision.items.some((item) => item.state === 'ok');
    return prepared ? provisionDue(provision.setVersion) : [];
}

/**
 * The set version a run brought the project to: the current one when every item due since `recorded` was reported `ok`
 * by this run (observed with this admin's definitions), else undefined (the record keeps the older one).
 */
export function reachedVersion(reported: readonly ItemState[], recorded: number | undefined): number | undefined {
    const okNow = new Set(reported.filter((item) => item.state === 'ok').map((item) => item.id));
    return provisionDue(recorded).every((id) => okNow.has(id)) ? PROVISION_SET_VERSION : undefined;
}
