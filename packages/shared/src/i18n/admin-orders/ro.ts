/**
 * Romanian texts of M4's order card and order watch (`docs/research/M4-interfaces.md` §1): buying a USGS scan, its states,
 * reminders and notices. Out of `../admin-imagery/` when that folder reached the 400-line limit (DECISIONS-for-review.md §110).
 * The source of truth for `AdminOrdersKey`; `en.ts` is typed against it. Merged into `translateAdminContent` by
 * `../admin-content/index.ts`. One entry per line (scripts/ci/check_i18n.py); every key carries its section's prefix
 * (`packages/shared/test/i18n-admin.test.ts`). Owner: orders.
 */
export const ro = {
    // [section orders] owner: orders (M4, docs/research/M4-interfaces.md §1); keys adminContent.orders.*
    'adminContent.orders.state.available': 'Gratuit: scanat deja',
    'adminContent.orders.state.needsOrder': 'Trebuie comandat de la USGS',
    'adminContent.orders.state.ordered': 'Comandat: verificăm zilnic livrarea',
    'adminContent.orders.state.reminder': 'Comandat: ai plătit? USGS șterge comenzile neplătite după 14 zile',
    'adminContent.orders.state.delivered': 'Livrat: importul pornește',
    'adminContent.orders.state.importing': 'Se importă',
    'adminContent.orders.state.imported': 'Importat',
    'adminContent.orders.state.expired': 'Nelivrat',
    'adminContent.orders.estimate': 'Cost: {usd} USD ({frames} × 30 USD pe cadru + 5 USD pe comandă), plătit direct la USGS',
    'adminContent.orders.open': 'Comandă în EarthExplorer',
    'adminContent.orders.markOrdered': 'Am comandat',
    'adminContent.orders.checkNow': 'Verifică acum',
    'adminContent.orders.undo': 'Retrage marcajul',
    'adminContent.orders.heading': 'Cumpără această scanare',
    'adminContent.orders.headingOrdered': 'Comanda ta',
    'adminContent.orders.headingAgain': 'Comandă din nou',
    'adminContent.orders.tag.ordered': 'Comandat',
    'adminContent.orders.tag.reminder': 'Comandat: plătit?',
    'adminContent.orders.tag.delivered': 'Livrat',
    'adminContent.orders.tag.importing': 'Se importă',
    'adminContent.orders.tag.expired': 'Nelivrat',
    'adminContent.orders.guide.label': 'Cum comanzi în EarthExplorer',
    'adminContent.orders.guide.signIn': 'Autentifică-te pe pagina care se deschide (Login, sus în dreapta).',
    'adminContent.orders.guide.order': 'Jos pe pagină, apasă Order.',
    'adminContent.orders.guide.selections': 'Pe pagina comenzii păstrează On-Demand, alege 7 Micron, apoi apasă Submit Product Selections.',
    'adminContent.orders.guide.pay': 'Completează formularul USGS și plătește 35 USD pe pay.gov; păstrează numărul de confirmare.',
    'adminContent.orders.next': 'Apoi apasă Am comandat: verificăm zilnic USGS și importăm scanarea când este livrată.',
    'adminContent.orders.timing': 'Livrarea durează trei-patru săptămâni de la plată; comenzile neplătite se șterg după două săptămâni.',
    'adminContent.orders.support': 'Serviciul clienți USGS: custserv@usgs.gov, 1-800-252-4547.',
    'adminContent.orders.newTab': '(se deschide într-o filă nouă)',
    'adminContent.orders.noLink': 'Pagina EarthExplorer a scenei nu este încă cunoscută: caută în EarthExplorer {entityId}.',
    'adminContent.orders.searchEarthExplorer': 'Deschide EarthExplorer',
    'adminContent.orders.fact.orderedAt': 'Comandat pe',
    'adminContent.orders.fact.nextCheck': 'Următoarea verificare',
    'adminContent.orders.fact.lastCheck': 'Ultima verificare',
    'adminContent.orders.fact.notChecked': 'încă nu',
    'adminContent.orders.fact.afterApproval': 'după ce USGS aprobă descărcările',
    'adminContent.orders.waitsForApproval': 'USGS nu ți-a aprobat încă descărcările: verificarea zilnică a comenzii începe după aprobare.',
    'adminContent.orders.lastError': 'Ultima verificare la USGS a eșuat:',
    'adminContent.orders.reminderNote': 'USGS șterge comenzile neplătite după 14 zile: dacă nu ai plătit, răspunde la e-mailul USGS.',
    'adminContent.orders.reminderPaid': 'Dacă ai plătit, nu ai nimic de făcut: scanarea se importă când o livrează USGS.',
    'adminContent.orders.expiredNote': 'USGS nu a livrat scanarea în 90 de zile. Comand-o din nou dacă o mai vrei.',
    'adminContent.orders.openImport': 'Deschide importul',
    'adminContent.orders.group': 'Comenzi',
    'adminContent.orders.notice.marked': 'Marcat drept comandat: verificăm zilnic la USGS.',
    'adminContent.orders.notice.takenBack': 'Marcajul de comandă a fost retras.',
    'adminContent.orders.notice.waiting': 'USGS nu a livrat încă scanarea.',
    'adminContent.orders.notice.delivered': 'USGS a livrat scanarea: importul a pornit.',
    'adminContent.orders.notice.deliveredWaits': 'USGS a livrat scanarea: se importă de îndată ce procesarea poate porni.',
    // [end orders]
} as const;

export type AdminOrdersKey = keyof typeof ro;
