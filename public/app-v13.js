import '/app-core.js';

function enhanceConnections() {
  for (const row of document.querySelectorAll('.character-entry .actions')) {
    if (row.querySelector('[data-oracle-connections]')) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.oracleConnections = 'true';
    button.textContent = 'Connection cards';
    button.addEventListener('click', () => { window.location.href = '/connections.html'; });
    const characters = row.querySelector('[data-action="character-open"]');
    characters?.insertAdjacentElement('afterend', button);
  }
}
new MutationObserver(enhanceConnections).observe(document.documentElement, { childList: true, subtree: true });
enhanceConnections();
