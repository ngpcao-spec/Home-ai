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

```sh
npm test
```
