# Home-ai

Home-ai est une base d'application web moderne, prête à évoluer vers une interface d'assistant domestique intelligent.

## Stack initiale

Cette première version démarre volontairement sans dépendance externe afin de rester simple, rapide à lancer et facile à faire évoluer.

- HTML, CSS et JavaScript modules natifs.
- Serveur de développement Node.js intégré au dépôt.
- Tests avec le module natif `node:test`.
- Build statique reproductible dans `dist/`.

## Prérequis

- Node.js 20 ou plus récent.
- npm 10 ou plus récent.

## Installation

Aucune dépendance n'est requise pour cette base initiale. Vous pouvez toutefois exécuter :

```bash
npm install
```

## Lancement en développement

```bash
npm run dev
```

L'application sera disponible sur `http://localhost:5173` par défaut.

## Scripts utiles

```bash
npm run build    # génère le dossier dist/ pour la production
npm run start    # lance le serveur local
npm run lint     # vérifie la syntaxe JavaScript du projet
npm run test     # exécute les tests unitaires natifs Node.js
```

## Organisation initiale

```text
scripts/
  build.mjs       # Copie les fichiers statiques vers dist/
  check.mjs       # Vérification syntaxique des fichiers JavaScript
  dev-server.mjs  # Serveur local de développement
src/
  app.js          # Composition principale de l'interface
  styles.css      # Styles globaux
test/
  app.test.mjs    # Premier test de rendu
```
