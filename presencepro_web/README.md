# PrésencePro RDC — V15 (améliorations consolidées)

Cette version transforme le prototype en base prête pour un vrai backend Supabase.

## 1. Créer le projet Supabase

Crée un projet sur Supabase, puis récupère :
- l'URL du projet (`https://....supabase.co`)
- la clé publique **publishable/anon**.

Ne mets **jamais** une clé `service_role` ou `secret` dans le navigateur.

## 2. Installer la base

Dans **Supabase → SQL Editor**, ouvre `supabase_schema.sql` et exécute tout le script.

Le script crée :
- `organizations`
- `profiles`
- `employees`
- `attendance`
- `biometric_credentials`, `organization_settings`, `leave_requests`
- politiques RLS renforcées par rôle
- bucket privé `employee-photos`
- fonction de création d’organisation et fonction serveur `record_my_attendance` pour le pointage QR

## 3. Ajouter les identifiants

Ouvre `js/supabase-config.js` et remplace :

```js
window.PRESENCEPRO_SUPABASE = {
  url: "https://YOUR_PROJECT_REF.supabase.co",
  key: "YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY"
};
```

par les valeurs de ton projet.

## 4. Première connexion

L'application permet de créer un compte avec :
- nom complet
- nom de l'organisation
- email
- mot de passe

Après confirmation de l'email si elle est activée, reconnecte-toi.

## 5. Ce qui est maintenant persistant

- comptes avec Supabase Auth
- organisation de l'utilisateur
- profils des agents
- matricules
- départements
- photos des agents dans Supabase Storage
- pointages arrivée/départ
- associations WebAuthn/biométriques (identifiant de credential uniquement)

## 6. Biométrie tablette

La tablette utilise son authentificateur natif via WebAuthn/Passkeys. PrésencePro ne reçoit pas une image de l'empreinte.

**Important pour la production :** l'enregistrement et l'identifiant WebAuthn sont stockés dans Supabase, mais la vérification cryptographique complète doit être déplacée vers une fonction serveur/Edge Function WebAuthn avant de considérer le système comme une authentification biométrique de production. La prochaine étape est donc de créer cette Edge Function avec challenge + vérification de signature.

## 7. Déploiement

L'application doit être servie en **HTTPS** pour que WebAuthn fonctionne correctement sur les appareils compatibles.

## Connexion Supabase — configuration du projet

La V3 est maintenant préconfigurée pour le projet Supabase PrésencePro avec son **Project URL** et sa **Publishable key** dans `js/supabase-config.js`.

### Première installation

1. Ouvrir le projet Supabase.
2. Aller dans **SQL Editor**.
3. Ouvrir `supabase_schema.sql` fourni dans ce dossier.
4. Coller tout le contenu dans une nouvelle requête SQL.
5. Exécuter la requête.
6. Ouvrir ensuite `index.html` depuis un serveur local (par exemple VS Code Live Server), car l'authentification et WebAuthn nécessitent un contexte sécurisé. `localhost` est accepté pour le développement.
7. Créer le premier compte depuis la fenêtre de connexion de PrésencePro.

### Sécurité

La clé configurée dans le navigateur est une **Publishable key**. Elle n'est pas une clé secrète. La sécurité des données repose sur les politiques RLS du schéma Supabase.

Ne jamais remplacer cette clé par une clé `sb_secret_*` ou `service_role`.

### Important pour la biométrie

La version actuelle utilise WebAuthn/Passkeys pour demander à la tablette ou au téléphone d'utiliser son mécanisme biométrique natif (empreinte, reconnaissance faciale ou autre méthode configurée sur l'appareil). L'application ne reçoit pas l'empreinte brute.

Pour une utilisation de production, la vérification cryptographique complète des assertions WebAuthn doit ensuite être déplacée vers un serveur/Edge Function avant de considérer le pointage biométrique comme définitif.


## V15 — améliorations incluses

- Correction des noms des colonnes de pointage (`arrival_at` / `departure_at`) afin de correspondre au schéma SQL.
- Prévention des doubles arrivées, départs sans arrivée et doubles départs.
- Pointage QR via la fonction SQL `record_my_attendance`, qui utilise l’heure du serveur et l’identité du compte employé.
- Tableau de bord et rapports alimentés par les données chargées depuis Supabase.
- Filtrage des rapports par période et département, export CSV ouvrable dans Excel et impression/enregistrement PDF via le navigateur.
- Demandes de congé/absence/permission avec approbation ou refus par un responsable.
- Paramètres d’organisation et horaires partagés entre les appareils après migration SQL.
- Renforcement des politiques RLS : les employés ne peuvent pas modifier les profils de leurs collègues ni leurs pointages via les requêtes directes.
- Écran informatif des formules Gratuit / Pro / Business.

## Mise à jour d’une installation existante

Si tu as déjà exécuté une ancienne version de `supabase_schema.sql`, exécute **seulement** `supabase_migration_v15.sql` dans Supabase → SQL Editor. Ne relance pas le schéma complet sans sauvegarde. Ensuite remplace les fichiers du site par ceux de cette version et actualise la page.

## Limites à connaître avant commercialisation

- Les paiements d’abonnement ne sont pas activés : il faut encore intégrer un prestataire de paiement compatible avec la RDC et vérifier les tarifs.
- WebAuthn/Passkeys nécessite encore un vérificateur cryptographique côté serveur/Edge Function avant d’être présenté comme une biométrie de production. Le navigateur ne fournit jamais l’image brute de l’empreinte.
- Le mode QR nécessite HTTPS, un compte employé associé et l’exécution de la migration SQL V15. Un QR seul ne prouve pas à lui seul la présence physique.
- Les rapports s’appuient sur les pointages chargés par l’application (fenêtre récente de 30 jours dans le tableau de bord) ; la pagination d’archives à long terme reste à ajouter pour les grandes organisations.
- Les tarifs, les notifications e-mail/SMS et l’automatisation des congés restent à finaliser avant un lancement commercial.
