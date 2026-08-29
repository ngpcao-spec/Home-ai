# Home-ai

Home-ai centralise tous les appels LLM dans `LLMService`. La factory sélectionne soit
`MockLLMProvider` (déterministe et par défaut), soit `OpenAIProvider`. Le planner et le
générateur de réponse ne contactent donc jamais OpenAI directement.

## Configuration

Copier `.env.example` dans `.env` puis charger les variables dans l'environnement :

| Variable | Défaut | Description |
| --- | --- | --- |
| `LLM_PROVIDER` | `mock` | `mock` ou `openai` |
| `LLM_MODEL` | `gpt-5.6` | Modèle envoyé à Responses API |
| `OPENAI_API_KEY` | vide | Clé requise uniquement en mode OpenAI |
| `LLM_TIMEOUT_MS` | `10000` | Timeout réseau en millisecondes |
| `RESPONSE_MODE` | `hybrid` | Repli déterministe en cas d'échec LLM |
| `AMAZON_LOCATION_API_KEY` | vide | Clé navigateur Amazon Location, restreinte par referrer |

Le provider OpenAI emploie `POST https://api.openai.com/v1/responses`, demande un JSON
strict au planner, extrait le texte de façon défensive et normalise les erreurs. Le planner
valide néanmoins le JSON et vérifie que l'agent et sa capability figurent dans le registre.
En mode `hybrid`, tout échec du planner ou du générateur conserve le comportement
déterministe, avec des métadonnées `provider`, `model`, `fallback` et `fallbackReason`.

## Sécurité

**NE JAMAIS COMMITER `OPENAI_API_KEY`.** La clé doit uniquement être fournie par la variable
d'environnement `OPENAI_API_KEY`. Les fichiers `.env` sont ignorés, à l'exception du modèle
sans secret `.env.example`. Les erreurs et métadonnées n'exposent ni clé, ni en-têtes, ni
prompts système complets.

## Exécution et test manuel optionnel

Mode mock (aucun accès Internet) :

```sh
npm start
curl http://localhost:3000/health
curl http://localhost:3000/api/v1/agents
curl -X POST http://localhost:3000/api/v1/orchestrate \
  -H 'Content-Type: application/json' -d '{"request":"Quel est le statut ?"}'
```

Pour un essai OpenAI manuel, injecter le secret uniquement dans le shell ou un gestionnaire
de secrets, puis lancer le serveur (ne jamais placer la valeur dans le code ou un commit) :

```sh
LLM_PROVIDER=openai LLM_MODEL=gpt-5.6 OPENAI_API_KEY='<secret>' npm start
```

Les tests utilisent exclusivement un `fetch` stubé et n'effectuent aucun appel OpenAI réel :

## Amazon Location Service, géolocalisation et confidentialité

L'écran dispatch utilise **MapLibre GL JS**, le style Amazon Location Standard v2 et les API
Amazon Location Routes v2 dans `ap-southeast-1`. La matrice fournit distance routière et ETA
pour le classement déterministe; `CalculateRoutes` fournit ensuite la géométrie affichée.
Le mode de transport est injectable (`Car` actuellement) afin d'ajouter `Scooter` ultérieurement.

GitHub Pages injecte `AMAZON_LOCATION_API_KEY` depuis le secret GitHub du même nom dans
`dist/src/runtime-config.js`. `dist/` est ignoré : aucune valeur réelle ne doit entrer dans Git.
La clé navigateur reste visible aux visiteurs et doit donc rester restreinte au referrer
`https://ngpcao-spec.github.io/Home-ai/*` et aux seules actions Amazon Location nécessaires.
**Ne jamais commiter, afficher ou journaliser une clé API.** Sans clé, l'interface affiche un
message de configuration plutôt qu'un faux fond de carte.

Pour le développement local, copiez `.env.example` vers `.env`, laissez la valeur vide pour
tester l'erreur conviviale, ou injectez temporairement la clé restreinte dans le shell :
`AMAZON_LOCATION_API_KEY='<placeholder-ou-clé-locale>' npm run build`. Le fichier généré reste
dans `dist/`, qui n'est jamais commité. Tous les chemins HTML sont relatifs et restent compatibles
avec le préfixe GitHub Pages `/Home-ai/`.

La géolocalisation est demandée au lancement de la recherche. Un refus, une indisponibilité ou
un délai dépassé active le fallback Nha Trang et l'interface l'indique explicitement. Les
positions de démonstration périmées (plus de 5 minutes) sont exclues du matching. Après
attribution, le flux de suivi simulé met à jour le marqueur MapLibre par une interface injectable,
prête à recevoir ultérieurement les positions GPS du backend.

```sh
npm test
```

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
