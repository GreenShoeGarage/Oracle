// Generate public, inert examples from the shipped UI renderers and fictional fixtures.
// Run with npm run tour:build. No database or network access is used.
import { writeFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { THEMES } from '../public/kit.js';
import { examples as adventureExamples } from './tour/adventure-examples.mjs';
import { examples as socialExamples } from './tour/social-examples.mjs';
import { examples as fieldExamples } from './tour/field-examples.mjs';

const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const screens = [...await adventureExamples(), ...await socialExamples(), ...await fieldExamples()];
const ids = new Set();
for (const screen of screens) {
  if (!/^[a-z][a-z0-9-]+$/.test(screen.id) || ids.has(screen.id)) throw new Error('Invalid or duplicate example ID');
  ids.add(screen.id);
  const dom = new JSDOM(`<div id="fixture">${screen.html}</div>`);
  const fixture = dom.window.document.querySelector('#fixture');
  for (const node of fixture.querySelectorAll('script,iframe,object,embed,link,style')) node.remove();
  for (const form of fixture.querySelectorAll('form')) {
    const replacement = dom.window.document.createElement('div');
    replacement.className = `${form.className} example-form`;
    replacement.append(...form.childNodes); form.replaceWith(replacement);
  }
  for (const node of fixture.querySelectorAll('*')) {
    for (const attribute of [...node.attributes]) {
      if (/^on/i.test(attribute.name) || ['action','formaction','name','autofocus','contenteditable','style'].includes(attribute.name)) node.removeAttribute(attribute.name);
    }
    // Detached examples must never navigate to a real game, open a modal, or submit.
    if (node.matches('a')) node.removeAttribute('href');
    if (node.id) node.id = `${screen.id}-${node.id}`;
    for (const attr of ['for','aria-labelledby','aria-describedby','aria-controls']) {
      if (node.hasAttribute(attr)) node.setAttribute(attr, node.getAttribute(attr).split(/\s+/).map(id => `${screen.id}-${id}`).join(' '));
    }
  }
  screen.html = fixture.innerHTML;
  dom.window.close();
}
const styles = ['style','themes','characters','adventure','adventure-organizer','exchanges','sharing','story','trace','economy','oath','sigil','static','stagehand','props','field','guide','tour-examples'];
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,follow"><meta name="theme-color" content="#0d1211">
<title>Example screens · ORACLE · LARP Field Kit</title><link rel="icon" href="/favicon.svg" type="image/svg+xml">
${styles.map(name => `<link rel="stylesheet" href="/${name}.css">`).join('\n')}
</head><body class="examples-page"><a class="skip" href="#examples">Skip to examples</a>
<header class="examples-header"><div><p class="wordmark">ORACLE</p><p>LARP Field Kit · Example screens</p></div><a href="/">Open ORACLE</a><a href="/help.html">Help &amp; guides</a></header>
<main id="examples"><div class="examples-intro"><h1>A look inside the field kit</h1><p>Fictional, read-only examples rendered with ORACLE’s interface. The controls inside each example are inactive. No account is needed, and these examples do not connect to a live event.</p>
<details class="examples-chooser"><summary>Choose an example screen</summary><nav aria-label="Example screens">${screens.map(s => `<a href="#${s.id}">${esc(s.title)}</a>`).join('')}</nav></details></div>
${screens.map(s => `<section class="example" id="${s.id}" aria-labelledby="title-${s.id}"><header class="example-caption"><h2 id="title-${s.id}">${esc(s.title)}</h2><p>${esc(s.description)}</p></header><div class="example-screen theme-${esc(typeof s.theme === 'string' ? s.theme : s.theme?.id || 'fantasy')}" inert aria-hidden="true">${s.html}</div><p class="example-note">Fictional example · ${esc(typeof s.theme === 'string' ? s.theme : s.theme?.name || 'fantasy')} theme. Controls are inactive.</p></section>`).join('\n')}
</main><footer class="examples-footer"><a href="/">Open ORACLE</a><span>ORACLE · LARP Field Kit · Green Shoe Garage</span></footer></body></html>\n`;
const fonts = {serif:'Georgia, Cambria, serif',sans:'system-ui, sans-serif',mono:'ui-monospace, SFMono-Regular, Consolas, monospace'};
const css = `/* Frame only: example content keeps the shipped application styles. */
.examples-header,.examples-intro,.example,.examples-footer { width:min(1280px,calc(100% - 2rem)); margin-inline:auto; }
.examples-header { display:flex;align-items:center;gap:1.5rem;flex-wrap:wrap;padding:1.2rem 0;border-bottom:1px solid var(--line); }
.examples-header>div { margin-right:auto; }.examples-header p+p { color:var(--muted);font-size:.85rem;margin-top:.2rem; }
.examples-intro { padding:1.2rem 0; }.examples-intro h1 {font-size:1.7rem;}.examples-intro p {max-width:90ch;margin-top:.5rem;color:var(--muted);}
.examples-chooser { margin-top:.6rem; }.examples-chooser nav { display:flex;flex-wrap:wrap;gap:.5rem 1.1rem;padding:.5rem 0 1rem; }.examples-chooser a {min-height:44px;display:inline-flex;align-items:center;}
.example {display:none;scroll-margin-top:1rem;}.example:target {display:block;}body:not(:has(.example:target)) #fantasy {display:block;}
.example-caption {padding:1rem 0;}.example-caption p {color:var(--muted);margin-top:.3rem;max-width:100ch;}
.example-screen {background:var(--bg);color:var(--text);border:1px solid var(--line);border-radius:.6rem;padding:1.5rem;min-width:0;overflow:hidden;}
.example-screen .example-form {display:grid;gap:1rem;}.example-screen .modal-head {margin-bottom:1rem;}.example-screen input,.example-screen select,.example-screen textarea {color-scheme:dark;}
.example-note {color:var(--muted);font-size:.85rem;margin:.7rem 0 2rem;}.examples-footer {display:flex;flex-wrap:wrap;justify-content:space-between;gap:1rem;padding:1.2rem 0;border-top:1px solid var(--line);color:var(--muted);}
${THEMES.map(theme => `.theme-${theme.id} {${Object.entries({bg:'background',panel:'panel',text:'text',muted:'muted',accent:'accent'}).map(([css,key]) => `--${css}:${theme.tokens[key]};`).join('')}--heading-font:${fonts[theme.tokens.font] || fonts.sans};}`).join('\n')}
@media(max-width:650px){.example-screen{padding:.8rem;}.examples-header .wordmark{font-size:1.6rem;}}
@media print{.example{display:block;break-before:page}.examples-chooser{display:none}}
`;
await writeFile(new URL('../public/tour-examples.html',import.meta.url),html);
await writeFile(new URL('../public/tour-examples.css',import.meta.url),css);
await writeFile(new URL('../public/tour-catalog.json',import.meta.url),JSON.stringify(screens.map(({id,title,theme,description,source}) => ({id,title,theme:typeof theme === 'string' ? theme : theme?.id || 'fantasy',description,source})),null,2)+'\n');
console.log(`Generated ${screens.length} fictional, inert example screens.`);
