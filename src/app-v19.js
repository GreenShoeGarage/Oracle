import { createAppV18, FIELD_SHELL_ASSETS } from './app-v18.js';

export const COMMAND_DECK_SHELL_ASSETS = Object.freeze({
  ...FIELD_SHELL_ASSETS,
  '/app.js': ['app-v19.js', 'text/javascript'],
  '/app-v18.js': ['app-v18.js', 'text/javascript'],
  '/install.js': ['install-v19.js', 'text/javascript'],
  '/sw.js': ['sw-v19.js', 'text/javascript'],
  '/command-deck-ui.js': ['command-deck-ui.js', 'text/javascript'],
  '/command-deck.css': ['command-deck.css', 'text/css'],
});

// One shared asset responder keeps every inherited module on this release.
export function createAppV19(options) {
  return createAppV18({ ...options, shellAssets: COMMAND_DECK_SHELL_ASSETS });
}
