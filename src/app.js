export const foundations = [
  'Interface web rapide servie sans dépendance obligatoire',
  'Structure modulaire prête pour React, Vue, API ou IA locale',
  'Tests, vérification syntaxique et build statique déjà configurés',
];

export function createHomeAiMarkup() {
  const listItems = foundations.map((item) => `<li>${item}</li>`).join('');

  return `
    <main class="app-shell">
      <section class="hero" aria-labelledby="home-ai-title">
        <p class="eyebrow">Nouvelle base projet</p>
        <h1 id="home-ai-title">Home-ai</h1>
        <p class="hero-copy">
          Une fondation propre pour créer une expérience d'assistant domestique intelligent,
          évolutive et agréable à maintenir.
        </p>
        <div class="actions" aria-label="Actions de démarrage">
          <a class="primary-action" href="https://developer.mozilla.org/fr/docs/Learn" target="_blank" rel="noreferrer">
            Lire les bases web
          </a>
          <a class="secondary-action" href="https://nodejs.org/en/learn" target="_blank" rel="noreferrer">
            Explorer Node.js
          </a>
        </div>
      </section>

      <section class="card" aria-labelledby="foundations-title">
        <h2 id="foundations-title">Fondations incluses</h2>
        <ul>${listItems}</ul>
      </section>
    </main>
  `;
}

if (typeof document !== 'undefined') {
  const root = document.querySelector('#root');

  if (root) {
    root.innerHTML = createHomeAiMarkup();
  }
}
