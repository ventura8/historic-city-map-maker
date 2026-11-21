import type { StartKey } from './ro.js';

/**
 * The `packages/shared/src/i18n/start` family's texts in `fr`, imported by scripts/i18n/import_translations.py (docs/I18N.md).
 * Partial while the translation goes on: a key not here shows in English.
 */
export const fr: Readonly<Partial<Record<StartKey, string>>> = {
    'start.title': 'Lancez votre propre carte historique',
    'start.lede':
        'Les vieilles photos de votre ville et ses calques historiques, superposés à la carte actuelle, dans votre propre projet Google.',
    'start.language': 'Langue',
    'start.get.title': 'Ce que vous obtenez',
    'start.get.map': 'une carte publique de la ville, avec des photos, des lieux et des calques historiques ;',
    'start.get.admin': 'une application d’administration où vous ajoutez et publiez tout, sans utiliser de ligne de commande ;',
    'start.get.yours': 'tout est dans votre propre projet : les données et les comptes vous appartiennent, pas à nous.',
    'start.cost.title': 'Combien ça coûte',
    'start.cost.start':
        'Le lancement est gratuit : un projet Firebase et l’hébergement de l’application ne nécessitent aucun paiement ni carte de crédit.',
    'start.cost.server':
        'Le serveur nécessite le forfait Blaze : un compte de facturation avec une carte de crédit, que vous devrez saisir sur la page Google.',
    'start.cost.serverFree': 'Une carte de petite taille reste généralement dans la zone gratuite, mais nous ne pouvons pas le garantir.',
    'start.cost.budget':
        'L’assistant fixe un budget de 5 USD : une fois dépassé, l’importation des images s’arrête, mais le site reste accessible.',
    'start.cost.mapbox':
        'La carte de base provient de Mapbox et nécessite un compte et une carte de crédit; elle offre une large zone d’utilisation gratuite.',
    'start.accounts.title': 'Les comptes nécessaires',
    'start.accounts.google': 'un compte Google, maintenant ;',
    'start.accounts.mapbox': 'un compte Mapbox, plus tard, via l’Assistant de configuration ;',
    'start.accounts.usgs':
        'un compte USGS, uniquement si vous souhaitez utiliser des images satellites historiques ; vous pouvez attendre.',
    'start.consent.title': 'Ce que vous demandez à Google',
    'start.consent.body': 'Deux autorisations : créer et gérer des projets, et administrer Firebase dans vos projets.',
    'start.consent.token': 'Le jeton reste uniquement dans cet onglet, pendant une heure maximum, et ne nous est jamais transmis.',
    'start.consent.warning':
        'Google peut indiquer que cette application n’a pas encore été vérifiée. Si vous lui faites confiance, choisissez « Avancé », puis continuez.',
    'start.consent.warningNo': 'Sinon, la commande dans le terminal utilise vos propres outils.',
    'start.signIn': 'Continuer avec Google',
    'start.signedOut.denied': 'Google n’a pas donné son autorisation, donc rien n’a changé. Vous pouvez réessayer.',
    'start.signedOut.scope':
        'Une des autorisations n’a pas été cochée, et nous ne pouvons pas créer la carte sans elle. Veuillez réessayer et la cocher.',
    'start.signedOut.state': 'La réponse de Google ne concernait pas cet onglet, elle a donc été ignorée. Veuillez réessayer.',
    'start.plan.title': 'La ville et le projet',
    'start.plan.cityName': 'Le nom de la ville, en roumain',
    'start.plan.cityNameEn': 'Le nom en anglais (facultatif)',
    'start.plan.cityId': 'Identifiant de la ville',
    'start.plan.cityIdHelp': 'Minuscules, chiffres et tirets : la carte sera accessible à l’adresse /{cityId}/.',
    'start.plan.area': 'Le rectangle de la ville (facultatif)',
    'start.plan.areaHelp':
        'Vous pourrez le dessiner plus tard sur la carte. Sur openstreetmap.org, le bouton « Exporter » affiche ces valeurs.',
    'start.plan.west': 'Ouest',
    'start.plan.south': 'Sud',
    'start.plan.east': 'Est',
    'start.plan.north': 'Nord',
    'start.plan.areaIncomplete': 'Remplissez les quatre champs, ou laissez-les tous vides.',
    'start.plan.areaNumber': 'Les valeurs des bords sont en degrés, par exemple : 26,85.',
    'start.plan.areaBounds': 'L’ouest doit être inférieur à l’est, et le sud à l’est.',
    'start.plan.areaTooSmall': 'Le rectangle est trop petit.',
    'start.plan.areaTooBig': 'Le rectangle est trop grand : au maximum 2 degrés par côté.',
    'start.plan.newProject': 'Nouveau projet',
    'start.plan.existingProject': 'Un projet existant',
    'start.plan.projectKind': 'Le projet',
    'start.plan.projectName': 'Nom du projet',
    'start.plan.projectId': 'ID du projet',
    'start.plan.projectIdHelp': 'Unique sur Google et invariable : l’adresse sera https://{projectId}.web.app',
    'start.plan.pick': 'Choisissez le projet',
    'start.plan.pickNone': 'Aucun de vos projets n’a été trouvé. Créez-en un nouveau.',
    'start.plan.pickWarning': 'La publication remplacera le contenu actuel de Firebase Hosting dans ce projet.',
    'start.plan.go': 'Créer la carte',
    'start.plan.goExisting': 'Ajouter la carte à ce projet',
    'start.work.title': 'Création de la carte',
    'start.work.body':
        'Vous pouvez laisser cette page ouverte. Si vous la fermez, revenez ici et le processus reprendra là où il s’était arrêté.',
    'start.work.now': 'Maintenant : {step}',
    'start.step.project': 'Le projet Google',
    'start.step.firebase': 'Firebase dans le projet',
    'start.step.webApp': 'L’application web',
    'start.step.site': 'Le site d’hébergement',
    'start.step.files': 'Les fichiers de l’application ({done} sur {total})',
    'start.step.filesShort': 'Fichiers de l’application',
    'start.step.release': 'Publication',
    'start.step.state.waiting': 'En attente',
    'start.step.state.working': 'En cours',
    'start.step.state.done': 'Terminé',
    'start.step.state.failed': 'Échec',
    'start.tryAgain': 'Réessayer',
    'start.continue': 'Continuer avec Google',
    'start.failure.terms': 'Google vous demande d’accepter ses conditions une fois, sur sa propre page. Acceptez-les, puis réessayez.',
    'start.failure.termsLink': 'Ouvrez la console Firebase',
    'start.failure.cloudTermsLink': 'Ouvrez la console Google Cloud',
    'start.failure.quota':
        'Votre compte a atteint la limite de projets autorisés par Google. Demandez à en obtenir davantage ou sélectionnez un projet existant.',
    'start.failure.quotaLink': 'Demander plus de projets',
    'start.failure.refused':
        'Google n’a pas accepté le nom du projet (dérivé du nom de la ville) ou son identifiant. Modifiez-les ici et réessayez.',
    'start.failure.permission':
        'Votre compte n’a pas les droits nécessaires dans {projectId} : vous devez être propriétaire. Choisissez un autre projet.',
    'start.failure.release': 'La page n’a pas pu lire la liste des fichiers. Rechargez la page et réessayez.',
    'start.failure.network':
        'Le navigateur n’a pas pu joindre Google ({host}). La commande dans le terminal fait la même chose : {command}',
    'start.failure.unavailable': 'Google ne répond pas pour le moment. Rien n’est perdu : réessayez dans quelques minutes.',
    'start.failure.expired':
        'L’autorisation de Google a expiré, ce qui arrive après une heure. Continuez et le processus reprendra là où il s’était arrêté.',
    'start.failure.unknown': 'Google a refusé l’étape « {step} ». Rien n’est perdu : réessayez.',
    'start.provider.title': 'Activer la connexion avec Google',
    'start.provider.body': 'L’administrateur se connecte avec Google, et pour cela, le projet a besoin de son propre client.',
    'start.provider.how': 'Google ne le permet que depuis la console : sélectionnez Google, activez l’option, puis enregistrez.',
    'start.provider.link': 'Ouvrez la console, dans les méthodes de connexion',
    'start.provider.check': 'Vérifiez à nouveau',
    'start.provider.waiting': 'Il n’est pas encore activé. Pas de problème : vérifiez à nouveau après avoir enregistré.',
    'start.provider.unreadable':
        'Cette page n’a pas pu vérifier si le service est actif. Si vous l’avez enregistré dans la console, vous pouvez ouvrir l’interface d’administration.',
    'start.provider.open': 'Ouvrir l’admin',
    'start.done.title': 'Votre carte a son propre espace',
    'start.done.next':
        'L’Assistant de configuration vous guide à travers les étapes suivantes : la facturation et le budget, le serveur, Mapbox, puis la ville {city}.',
    'start.done.open': 'Ouvrir l’admin',
    'start.terminal.title': 'Utiliser le terminal ?',
    'start.terminal.body': 'Les mêmes étapes, avec vos propres outils : {command}',
    'start.footer.source': 'Code source ouvert',
    'start.privacy.title': 'Ce que cette page conserve',
    'start.privacy.body':
        'Aucune donnée sur nos serveurs, pas de cookie. Cet onglet conserve uniquement votre plan, pour que vous puissiez reprendre.',
    'start.privacy.token': 'Le jeton Google n’est enregistré nulle part.',
};
