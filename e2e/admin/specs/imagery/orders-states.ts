/**
 * The buy flow's states of the tour inventory (M4, docs/research/M4-interfaces.md §1.7, §7.3; `ADMIN_STATES` of
 * e2e/tour/states.ts spreads them inside its orders section): a scene to buy with its order card, an order watched,
 * reminded, delivered and never delivered, a frame scanned while it was marked, an order waiting for USGS's approval of
 * downloads, ids `orders.<state>`, each reached by specs/imagery/orders.spec.ts at the admin
 * tier's five projects (behind the tier's lock: the scenes' setup/status and the server's USGS world are singletons).
 */
export const ORDERS_STATES = {
    'orders.order-card': {
        title: 'Historical imagery: a scene to buy, its cost, how to order it, its EarthExplorer page and I ordered it',
        visit: 'specs/imagery/orders.spec.ts',
    },
    'orders.ordered': {
        title: 'Historical imagery: a scan ordered, checked daily, with Check now and Take the mark back',
        visit: 'specs/imagery/orders.spec.ts',
    },
    'orders.reminder': {
        title: 'Historical imagery: an order a week old, the reminder to pay and the last failed check in words',
        visit: 'specs/imagery/orders.spec.ts',
    },
    'orders.delivered': {
        title: 'Historical imagery: a scan USGS delivered, its import starting by itself',
        visit: 'specs/imagery/orders.spec.ts',
    },
    'orders.expired': {
        title: 'Historical imagery: an order never delivered, Order it again and Take the mark back',
        visit: 'specs/imagery/orders.spec.ts',
    },
    'orders.scanned-while-marking': {
        title: 'Historical imagery: a frame USGS scanned while it was marked ordered, free now, the keyboard on its heading',
        visit: 'specs/imagery/orders.spec.ts',
    },
    'orders.waits-for-approval': {
        title: 'Historical imagery: a scan ordered before USGS approves downloads, the daily check waiting for it',
        visit: 'specs/imagery/orders.spec.ts',
    },
} as const;
