import { readFile } from 'node:fs/promises';
import { createAppV17 } from './app-v17.js';
import { VERSION } from './config.js';

// These aliases retain their original source modules, but every asset belongs
// to the current deployment. Letting an older wrapper stamp its own version
// makes the immutable service worker reject the otherwise matching bundle.
export const FIELD_SHELL_ASSETS = Object.freeze({
  '/app.js': ['app-v18.js', 'text/javascript'],
  '/app-v17.js': ['app-v17.js', 'text/javascript'],
  '/app-v16.js': ['app-v16.js', 'text/javascript'],
  '/app-v15.js': ['app-v15.js', 'text/javascript'],
  '/app-v14.js': ['app-v14.js', 'text/javascript'],
  '/app-v13.js': ['app-v13.js', 'text/javascript'],
  '/app-core.js': ['app.js', 'text/javascript'],
  '/install.js': ['install-v18.js', 'text/javascript'],
  '/sw.js': ['sw-v18.js', 'text/javascript'],
  '/connections.html': ['connections.html', 'text/html'],
  '/connections.js': ['connections-ui.js', 'text/javascript'],
  '/connections.css': ['connections.css', 'text/css'],
  '/arcs.html': ['arcs.html', 'text/html'],
  '/arcs.js': ['arcs-ui.js', 'text/javascript'],
  '/arcs-store.js': ['arcs-store.js', 'text/javascript'],
  '/arcs.css': ['arcs.css', 'text/css'],
  '/projects.html': ['projects.html', 'text/html'],
  '/projects.js': ['projects-ui.js', 'text/javascript'],
  '/projects.css': ['projects.css', 'text/css'],
  '/project-effects-ui.js': ['project-effects-ui.js', 'text/javascript'],
  '/experiences.html': ['experiences.html', 'text/html'],
  '/experiences.js': ['experiences-ui.js', 'text/javascript'],
  '/experiences.css': ['experiences.css', 'text/css'],
  '/starter-experiences.html': ['starter-experiences.html', 'text/html'],
  '/field-home.html': ['field-home.html', 'text/html'],
  '/field-home.js': ['field-home.js', 'text/javascript'],
  '/field-home.css': ['field-home.css', 'text/css'],
});

export function createAppV18({ pool, config, logger, shellAssets = FIELD_SHELL_ASSETS }) {
  const delegate = createAppV17({ pool, config, logger });
  return async function handle(req, res) {
    const url = new URL(req.url, config.origin);
    const asset = Object.hasOwn(shellAssets, url.pathname)
      ? shellAssets[url.pathname] : null;
    if (!asset || !['GET', 'HEAD'].includes(req.method)) return delegate(req, res);
    try {
      const file = await readFile(new URL(`../public/${asset[0]}`, import.meta.url));
      res.writeHead(200, {
        'Content-Type': `${asset[1]}; charset=utf-8`,
        'Content-Length': file.byteLength,
        'Cache-Control': 'no-store',
        'X-ORACLE-Shell-Version': VERSION,
        'X-Content-Type-Options': 'nosniff',
      });
      return res.end(req.method === 'HEAD' ? undefined : file);
    } catch (error) {
      // Never fall through to an older module after a packaging failure.
      // The worker must reject an incomplete release rather than mix versions.
      logger?.({ event: 'shell_asset_unavailable', path: url.pathname, code: error.code || 'ASSET_ERROR' });
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(req.method === 'HEAD' ? undefined : 'This ORACLE release is missing a required app asset. Reconnect and try again.');
    }
  };
}
