import '/app-v13.js';

function enhanceArcs(){
  for(const row of document.querySelectorAll('.character-entry .actions')){
    if(row.querySelector('[data-oracle-arcs]'))continue;
    const button=document.createElement('button');button.type='button';button.dataset.oracleArcs='true';button.textContent='My character arc';button.addEventListener('click',()=>{window.location.href='/arcs.html';});
    const connections=row.querySelector('[data-oracle-connections]');
    (connections||row.querySelector('[data-action="character-open"]'))?.insertAdjacentElement('afterend',button);
  }
}
new MutationObserver(enhanceArcs).observe(document.documentElement,{childList:true,subtree:true});enhanceArcs();
