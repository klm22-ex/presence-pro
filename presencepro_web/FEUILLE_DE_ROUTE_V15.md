# PrésencePro RDC — feuille de route commerciale

## Inclus dans V15
- Correction de la persistance des arrivées/départs avec les colonnes SQL réellement définies.
- Contrôle des transitions de pointage et RPC serveur pour le QR employé.
- Règles RLS par rôle et accès des employés limité à leurs données personnelles.
- Tableau de bord calculé à partir des données chargées.
- Rapports filtrables, export CSV et impression PDF.
- Demandes de congé, absence et permission avec décision du responsable.
- Paramètres d’organisation partagés via Supabase.
- Écran de présentation des formules commerciales (sans paiement réel).

## Avant de vendre
1. Exécuter et tester la migration V15 sur une copie de la base.
2. Tester avec au moins un compte propriétaire, un administrateur et deux employés de deux organisations différentes.
3. Ajouter une Edge Function WebAuthn pour générer les challenges et vérifier les signatures.
4. Ajouter des tests automatiques et une piste d’audit des modifications administratives.
5. Ajouter pagination serveur des rapports, sauvegardes et procédure de restauration.
6. Choisir un prestataire de paiement adapté au marché congolais et intégrer les abonnements côté serveur.
7. Ajouter notifications e-mail/SMS/Push, fuseau horaire et jours fériés configurables.
8. Faire un audit de sécurité indépendant avant d’utiliser les données de paie ou de présence officielles.

## Règle de commercialisation
Ne pas présenter les abonnements comme actifs tant qu’aucun paiement n’est encaissé et vérifié côté serveur. Ne pas présenter la biométrie comme une authentification forte de production tant que les assertions WebAuthn ne sont pas vérifiées côté serveur.
