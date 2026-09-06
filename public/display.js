/* Run before stylesheets so an explicit reading preference also applies to startup. */
(() => {
  'use strict';
  const root = document.documentElement;
  const preference = (key, values, fallback) => {
    try {
      const value = localStorage.getItem(`oracle-${key}`);
      return values.includes(value) ? value : fallback;
    } catch { return fallback; }
  };
  root.dataset.display = preference('display', ['dark', 'outdoor'], 'dark');
  root.dataset.motion = preference('motion', ['system', 'reduce'], 'system');
  root.dataset.controls = preference('controls', ['open', 'closed'], 'open');
  if (root.dataset.display === 'outdoor') {
    const chrome = document.querySelector('meta[name="theme-color"]');
    if (chrome) chrome.content = '#ffffff';
  }
})();
