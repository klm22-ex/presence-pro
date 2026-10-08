# Publier PrésencePro avec GitHub Pages

1. Créer un dépôt GitHub, par exemple `presencepro-rdc`.
2. Mettre tous les fichiers de ce dossier à la racine du dépôt (`index.html`, `css/`, `js/`, etc.).
3. GitHub → Settings → Pages.
4. Dans Build and deployment, choisir `Deploy from a branch`.
5. Choisir la branche `main` et le dossier `/ (root)`, puis Save.
6. Attendre l'URL HTTPS fournie par GitHub Pages.
7. Dans Supabase → Authentication → URL Configuration, ajouter cette URL comme Site URL et Redirect URL.

Important : WebAuthn/Passkeys doit être utilisé sur une origine sécurisée (HTTPS, ou localhost pour les tests locaux). Ne jamais mettre une `sb_secret_*` ou `service_role` dans le navigateur.

## Mise à jour V15 depuis une version précédente

1. Dans Supabase, fais d'abord une sauvegarde ou vérifie que tu peux restaurer le projet.
2. Ouvre `supabase_migration_v15.sql` dans Supabase → SQL Editor et exécute ce script **une seule fois**. Il ajoute les réglages partagés, les demandes de congé, les contrôles RLS renforcés et la fonction serveur de pointage QR.
3. Remplace les fichiers du site GitHub Pages par les fichiers de cette version.
4. Actualise le site en vidant le cache si nécessaire.
5. Teste avec un compte administrateur et un compte employé avant de l'utiliser pour des présences officielles.

Ne relance pas tout `supabase_schema.sql` sur une base existante sans sauvegarde préalable. Les abonnements sont encore informatifs : aucun paiement réel n'est activé. La biométrie WebAuthn nécessite encore une vérification cryptographique côté serveur avant usage en production.
