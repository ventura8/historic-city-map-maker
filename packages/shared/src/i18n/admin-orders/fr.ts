import type { AdminOrdersKey } from './ro.js';

/**
 * The `packages/shared/src/i18n/admin-orders` family's texts in `fr`, imported by scripts/i18n/import_translations.py (docs/I18N.md).
 * Partial while the translation goes on: a key not here shows in English.
 */
export const fr: Readonly<Partial<Record<AdminOrdersKey, string>>> = {
    'adminContent.orders.state.available': 'Gratuit : déjà numérisé.',
    'adminContent.orders.state.needsOrder': 'Il faut commander auprès de l’USGS.',
    'adminContent.orders.state.ordered': 'Commandé : vérification quotidienne de la livraison.',
    'adminContent.orders.state.reminder': 'Commandé : avez-vous payé ? L’USGS supprime les commandes impayées après 14 jours.',
    'adminContent.orders.state.delivered': 'Livré : l’importation démarre.',
    'adminContent.orders.state.importing': 'En cours d’importation.',
    'adminContent.orders.state.imported': 'Importé',
    'adminContent.orders.state.expired': 'Non livré',
    'adminContent.orders.estimate':
        'Coût : {usd} USD ({frames} × 30 USD par image + 5 USD par commande), à régler directement auprès de l’USGS.',
    'adminContent.orders.open': 'Commander sur EarthExplorer',
    'adminContent.orders.markOrdered': 'Je l’ai commandé.',
    'adminContent.orders.checkNow': 'Vérifier maintenant',
    'adminContent.orders.undo': 'Supprimer le repère',
    'adminContent.orders.heading': 'Acheter cette numérisation',
    'adminContent.orders.headingOrdered': 'Votre commande',
    'adminContent.orders.headingAgain': 'Repassez votre commande.',
    'adminContent.orders.tag.ordered': 'Commandé',
    'adminContent.orders.tag.reminder': 'Commandé : payé ?',
    'adminContent.orders.tag.delivered': 'Livré',
    'adminContent.orders.tag.importing': 'Importation',
    'adminContent.orders.tag.expired': 'Non livré',
    'adminContent.orders.guide.label': 'Comment commander sur EarthExplorer.',
    'adminContent.orders.guide.signIn': 'Connectez-vous sur la page qui s’ouvre (Connexion, en haut à droite).',
    'adminContent.orders.guide.order': 'En bas de page, cliquez sur « Commander ».',
    'adminContent.orders.guide.selections':
        'Sur la page de commande, conservez l’option « À la demande », sélectionnez « 7 Micron », puis cliquez sur « Soumettre les sélections de produits ».',
    'adminContent.orders.guide.pay': "Fill in USGS's form and pay 35 USD on pay.gov; keep the confirmation number.",
    'adminContent.orders.next':
        'Cliquez ensuite sur « J’ai commandé » : nous vérifions USGS quotidiennement et importons la numérisation dès qu’elle est livrée.',
    'adminContent.orders.timing':
        'La livraison prend entre trois et quatre semaines après le paiement ; les commandes non payées sont supprimées après deux semaines.',
    'adminContent.orders.support': 'Service client USGS : custserv@usgs.gov, 1-800-252-4547.',
    'adminContent.orders.newTab': "(s'ouvre dans un nouvel onglet)",
    'adminContent.orders.noLink': "EarthExplorer's page of this scene is not known yet: search EarthExplorer for {entityId}.",
    'adminContent.orders.searchEarthExplorer': 'Ouvrir EarthExplorer',
    'adminContent.orders.fact.orderedAt': 'Commandé le',
    'adminContent.orders.fact.nextCheck': 'Prochaine vérification',
    'adminContent.orders.fact.lastCheck': 'Dernière vérification',
    'adminContent.orders.fact.notChecked': 'pas encore',
    'adminContent.orders.fact.afterApproval': 'une fois que l’USGS valide les téléchargements',
    'adminContent.orders.waitsForApproval':
        "L'USGS n'a pas encore validé vos téléchargements : la vérification quotidienne de la commande commencera une fois la validation effectuée.",
    'adminContent.orders.lastError': 'La dernière vérification auprès de l’USGS a échoué :',
    'adminContent.orders.reminderNote': "USGS deletes unpaid orders after 14 days: if you have not paid yet, reply to USGS's e-mail.",
    'adminContent.orders.reminderPaid':
        'Si vous avez payé, vous n’avez rien à faire : la numérisation est importée dès que l’USGS la fournit.',
    'adminContent.orders.expiredNote':
        "L'USGS n'a pas livré cette numérisation dans les 90 jours. Commandez-la à nouveau si vous le souhaitez.",
    'adminContent.orders.openImport': 'Ouvrir l’importation',
    'adminContent.orders.group': 'Commandes',
    'adminContent.orders.notice.marked': 'Commande enregistrée : nous vérifions quotidiennement auprès de l’USGS.',
    'adminContent.orders.notice.takenBack': 'La demande a été annulée.',
    'adminContent.orders.notice.waiting': "L'USGS n'a pas encore livré cette numérisation.",
    'adminContent.orders.notice.delivered': 'USGS a livré les scans : l’importation a commencé.',
    'adminContent.orders.notice.deliveredWaits': 'USGS a livré les scans : l’importation se fait dès que le traitement peut commencer.',
};
