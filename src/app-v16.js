import { readFile } from 'node:fs/promises';
import { createAppV15 } from './app-v15.js';
import { createProjectEffectsHandler } from './project-effects-app.js';
import { digest, readCookie } from './security.js';

const STATIC={
  '/app.js':['app-v16.js','text/javascript'],
  '/app-v15.js':['app-v15.js','text/javascript'],
  '/project-effects-ui.js':['project-effects-ui.js','text/javascript']
};

export function createAppV16({pool,config,logger}){
  const delegate=createAppV15({pool,config,logger});
  const effects=createProjectEffectsHandler({pool});
  return async function handle(req,res){
    const url=new URL(req.url,config.origin),asset=STATIC[url.pathname];
    if(asset&&['GET','HEAD'].includes(req.method)){
      try{const file=await readFile(new URL(`../public/${asset[0]}`,import.meta.url));res.writeHead(200,{'Content-Type':`${asset[1]}; charset=utf-8`,'Cache-Control':'no-store','X-ORACLE-Shell-Version':'1.6.0','X-Content-Type-Options':'nosniff'});return res.end(req.method==='HEAD'?undefined:file);}catch{return delegate(req,res);}
    }
    if(!/^\/api\/events\/[0-9a-f-]{36}\/projects\/[0-9a-f-]{36}\/(integrations|evidence|donate|refund|consequences|unlocks)(?:\/|$)/i.test(url.pathname))return delegate(req,res);
    if(!['GET','HEAD'].includes(req.method)&&req.headers.origin!==config.origin){res.writeHead(403,{'Content-Type':'application/json; charset=utf-8'});return res.end(JSON.stringify({error:'This request must come from the ORACLE application.'}));}
    const token=readCookie(req,config.cookieName);const user=token?(await pool.query("SELECT u.id,u.is_superuser FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND NOT u.is_disabled",[digest(token)])).rows[0]:null;
    if(!user){res.writeHead(401,{'Content-Type':'application/json; charset=utf-8'});return res.end(JSON.stringify({error:'Sign in to continue.'}));}
    res.setHeader('X-ORACLE-Account',user.id);
    try{if(await effects({req,res,path:url.pathname,method:req.method,user}))return;return delegate(req,res);}catch(error){const status=Number.isInteger(error.status)?error.status:500;if(status===500)logger?.({event:'project_effect_request_failed',code:error.code||'INTERNAL_ERROR'});res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify({error:status===500?'Unable to complete the project contribution or consequence request.':error.message}));}
  };
}
