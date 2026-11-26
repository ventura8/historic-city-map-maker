import type { AdminNotifyKey } from './ro.js';

/**
 * The `packages/shared/src/i18n/admin-notify` family's texts in `fr`, imported by scripts/i18n/import_translations.py (docs/I18N.md).
 * Partial while the translation goes on: a key not here shows in English.
 */
export const fr: Readonly<Partial<Record<AdminNotifyKey, string>>> = {
    'adminContent.notify.title': 'Notifications',
    'adminContent.notify.unread': 'Non lus : {count}',
    'adminContent.notify.empty': 'Aucune notification pour le moment.',
    'adminContent.notify.markAllRead': 'Marquer tout comme lu.',
    'adminContent.notify.event.usgs.approved':
        'Les téléchargements USGS ont été approuvés : vous pouvez maintenant lancer les importations.',
    'adminContent.notify.event.order.delivered': 'USGS a livré le scan de {scene} : l’importation a commencé.',
    'adminContent.notify.event.order.imported':
        'Le scan de {scene} a été importé : ouvrez-le pour vérifier s’il est publié ou s’il est en attente.',
    'adminContent.notify.event.order.reminder':
        'La commande pour {scene} est en attente depuis {days} jours : avez-vous effectué le paiement ? USGS supprime les commandes impayées.',
    'adminContent.notify.event.order.expired': 'La commande pour {scene} n’a pas été exécutée dans les {days} jours.',
    'adminContent.notify.event.job.failed': 'Le traitement de « {label} » a échoué. Ouvrez-le pour en connaître la raison.',
    'adminContent.notify.event.layer.readyToApprove': '« {label} » est en attente de votre validation.',
    'adminContent.notify.event.layer.needsPoints': '« {label} » nécessite quelques points de référence.',
    'adminContent.notify.event.job.noWorker':
        '« {label} » a attendu {minutes} minutes sur votre ordinateur : exécutez-le plutôt sur Google Cloud.',
    'adminContent.notify.event.review.waiting': 'Une contribution est en attente de validation.',
    'adminContent.notify.event.suggestion.waiting': 'Une suggestion concernant une photo est en attente de validation.',
    'adminContent.notify.event.role.requested': "Quelqu'un a demandé un rôle pour cette ville.",
    'adminContent.notify.event.job.needsOk':
        '« {label} » attend votre validation : son exécution sur Google Cloud dépasserait le quota gratuit mensuel.',
    'adminContent.notify.event.budget.paused':
        'Budget atteint ({cost} sur {budget} {currency}) : le traitement des images est suspendu, la carte fonctionne toujours.',
    'adminContent.notify.event.crash.spike': 'De nouveaux rapports d’erreurs ont été signalés au cours de la dernière heure : {count}.',
    'adminContent.notify.push.turnOn': 'Notifications activées sur cet appareil.',
    'adminContent.notify.push.denied':
        'Le navigateur a refusé les notifications (vous pouvez les autoriser dans les paramètres du site). La messagerie fonctionne toujours.',
    'adminContent.notify.push.test': 'Envoyer une notification de test.',
    'adminContent.notify.push.testMessage': 'Notification de test : les notifications fonctionnent sur cet appareil.',
    'adminContent.notify.push.testSent.one': 'La notification de test a été envoyée à {count} appareil.',
    'adminContent.notify.push.testSent.few': 'La notification de test a été envoyée à {count} appareils.',
    'adminContent.notify.push.testSent.other': 'La notification de test a été envoyée à {count} appareils.',
    'adminContent.notify.push.on': 'Les notifications sont activées sur cet appareil.',
    'adminContent.notify.push.working': 'Activation des notifications…',
    'adminContent.notify.push.unsupported':
        'Ce navigateur ne prend pas en charge les notifications. Vous pouvez toujours consulter votre boîte de réception.',
    'adminContent.notify.push.failed': 'Les notifications n’ont pas pu démarrer : {reason}',
    'adminContent.notify.push.reason.other': 'Pourquoi : {code}.',
    'adminContent.notify.settings.title': 'Notifications sur vos appareils',
    'adminContent.notify.settings.intro':
        "Vous recevez toutes les notifications. Choisissez celles qui s'affichent également sur vos appareils lorsque les notifications sont activées.",
    'adminContent.notify.settings.kinds': 'Ce vos appareils affichent.',
    'adminContent.notify.settings.saved': 'Les paramètres de notification ont été enregistrés.',
    'adminContent.notify.list': 'Vos notifications',
    'adminContent.notify.unreadMark': 'non lu',
    'adminContent.notify.badge': '{count} non lu(s)',
    'adminContent.notify.severity.info': 'Information',
    'adminContent.notify.severity.warning': 'Attention',
    'adminContent.notify.severity.error': 'Problème',
    'adminContent.notify.kind.usgs.approved': 'Les téléchargements USGS ont été approuvés.',
    'adminContent.notify.kind.order.delivered': 'Une numérisation commandée est arrivée.',
    'adminContent.notify.kind.order.imported': 'Une numérisation commandée a été importée.',
    'adminContent.notify.kind.order.reminder': 'Rappel de paiement pour les commandes',
    'adminContent.notify.kind.order.expired': 'Une commande n’a pas abouti.',
    'adminContent.notify.kind.job.failed': 'Le traitement a échoué.',
    'adminContent.notify.kind.layer.readyToApprove': 'Une couche est en attente de validation.',
    'adminContent.notify.kind.layer.needsPoints': 'Une couche nécessite des points.',
    'adminContent.notify.kind.job.noWorker': 'Une tâche attend un ordinateur qui n’est pas connecté.',
    'adminContent.notify.kind.review.waiting': 'Contributions en attente de vérification',
    'adminContent.notify.kind.suggestion.waiting': 'Suggestions concernant les photos',
    'adminContent.notify.kind.role.requested': 'Demandes de rôle',
    'adminContent.notify.kind.job.needsOk': 'Une tâche en cours d’exécution attend votre validation.',
    'adminContent.notify.kind.budget.paused': 'Le budget a interrompu le traitement.',
    'adminContent.notify.kind.crash.spike': "De nombreux nouveaux rapports d'erreurs.",
    'adminContent.assist.suggestTitle': 'Proposer un titre',
    'adminContent.assist.attribution': 'Suggestions provenant d’OpenStreetMap (© contributeurs d’OpenStreetMap, ODbL)',
    'adminContent.assist.draftToEn': 'Brouillon en anglais.',
    'adminContent.assist.draftToRo': 'Brouillon en roumain.',
    'adminContent.assist.suggestions': 'Titres suggérés pour le lieu.',
    'adminContent.assist.waiting': 'Recherche de titres dans OpenStreetMap…',
    'adminContent.assist.none': "OpenStreetMap n'a pas de nom pour cet endroit.",
    'adminContent.assist.use': 'Utilisez le titre « {title} ».',
    'adminContent.assist.drafting': 'Rédaction en cours…',
    'adminContent.assist.truncated': 'Le brouillon a été raccourci pour tenir dans le champ.',
};
