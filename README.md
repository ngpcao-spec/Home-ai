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
| `VITE_GOOGLE_MAPS_API_KEY` | vide | Clé navigateur Google Maps optionnelle |

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

## Carte, géolocalisation et confidentialité

Le build lit `VITE_GOOGLE_MAPS_API_KEY`. Sans cette variable, HOME AI utilise automatiquement
la carte de démonstration et toutes les étapes restent disponibles. La clé Maps JavaScript est
visible par nature dans le navigateur : elle doit être **restreinte aux HTTP referrers du site**
dans Google Cloud et limitée à **Maps JavaScript API**. Ne jamais placer une clé OpenAI, une clé
Routes serveur ou un autre secret dans une variable `VITE_*`.

La géolocalisation est demandée au lancement de la recherche. Un refus, une indisponibilité ou
un délai dépassé active le fallback Nha Trang. Les positions de démonstration périmées (plus de
5 minutes) sont exclues du matching. Avant attribution, Google Maps décale volontairement les
marqueurs de thợ ; après attribution, seul le thợ choisi est suivi précisément. L'utilisateur
peut désactiver l'autorisation GPS dans les réglages du navigateur à tout moment.

```sh
npm test
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
