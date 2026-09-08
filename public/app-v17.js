import '/app-v16.js';
function enhance(){for(const row of document.querySelectorAll('.character-entry .actions')){if(row.querySelector('[data-oracle-experience]'))continue;const b=document.createElement('button');b.type='button';b.dataset.oracleExperience='true';b.textContent='What can I do now?';b.addEventListener('click',()=>{window.location.href='/experiences.html';});row.prepend(b);}}
new MutationObserver(enhance).observe(document.documentElement,{childList:true,subtree:true});enhance();document.documentElement.dataset.oracleVersion='1.7.0';
