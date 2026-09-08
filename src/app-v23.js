import { createAppV18 } from './app-v18.js';
import { COMMAND_DECK_SHELL_ASSETS } from './app-v19.js';
export const EXPERIENCE_STUDIO_SHELL_ASSETS=Object.freeze({
 ...COMMAND_DECK_SHELL_ASSETS,
 '/app.js':['app-v23.js','text/javascript'],
 '/app-v19.js':['app-v19.js','text/javascript'],
 '/sw.js':['sw-v23.js','text/javascript'],
 '/install.js':['install-v23.js','text/javascript'],
 '/experience-pack-model.js':['experience-pack-model.js','text/javascript'],
 '/experience-library.js':['experience-library.js','text/javascript'],
 '/experience-studio-ui.js':['experience-studio-ui.js','text/javascript'],
 '/experience-studio.css':['experience-studio.css','text/css'],
 '/field-acceptance-model.js':['field-acceptance-model.js','text/javascript'],
});
export function createAppV23(options){return createAppV18({...options,shellAssets:EXPERIENCE_STUDIO_SHELL_ASSETS});}
