import '/app-v14.js';

function enhanceProjects(){
  for(const row of document.querySelectorAll('.character-entry .actions')){
    if(row.querySelector('[data-oracle-projects]'))continue;
    const button=document.createElement('button');button.type='button';button.dataset.oracleProjects='true';button.textContent='Community projects';button.addEventListener('click',()=>{window.location.href='/projects.html';});
    const arcs=[...row.querySelectorAll('button')].find(item=>item.textContent==='My character arc');
    (arcs||row.lastElementChild)?.insertAdjacentElement('afterend',button);
  }
}
new MutationObserver(enhanceProjects).observe(document.documentElement,{childList:true,subtree:true});
enhanceProjects();
