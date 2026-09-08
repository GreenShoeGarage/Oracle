import { readFile } from 'node:fs/promises';
import { createAppV13 } from './app-v13.js';
import { createArcsHandler } from './arcs-app.js';
import { digest, readCookie } from './security.js';

const STATIC={
  '/app.js':['app-v14.js','text/javascript'],
  '/app-v13.js':['app-v13.js','text/javascript'],
  '/arcs.html':['arcs.html','text/html'],
  '/arcs.js':['arcs-ui.js','text/javascript'],
  '/arcs-store.js':['arcs-store.js','text/javascript'],
  '/arcs.css':['arcs.css','text/css']
};
export function createAppV14({pool,config,logger}){
  const delegate=createAppV13({pool,config,logger});
  const arcs=createArcsHandler({pool});
  return async function handle(req,res){
    const url=new URL(req.url,config.origin),asset=STATIC[url.pathname];
    if(asset&&['GET','HEAD'].includes(req.method)){
      try{const file=await readFile(new URL(`../public/${asset[0]}`,import.meta.url));res.writeHead(200,{'Content-Type':`${asset[1]}; charset=utf-8`,'Cache-Control':'no-store','X-ORACLE-Shell-Version':'1.4.0','X-Content-Type-Options':'nosniff'});return res.end(req.method==='HEAD'?undefined:file);}catch{return delegate(req,res);}
    }
    if(!/^\/api\/events\/[0-9a-f-]{36}\/arcs(?:\/|$)/i.test(url.pathname))return delegate(req,res);
    if(!['GET','HEAD'].includes(req.method)&&req.headers.origin!==config.origin){res.writeHead(403,{'Content-Type':'application/json; charset=utf-8'});return res.end(JSON.stringify({error:'This request must come from the ORACLE application.'}));}
    const token=readCookie(req,config.cookieName);const user=token?(await pool.query("SELECT u.id,u.is_superuser FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND NOT u.is_disabled",[digest(token)])).rows[0]:null;
    if(!user){res.writeHead(401,{'Content-Type':'application/json; charset=utf-8'});return res.end(JSON.stringify({error:'Sign in to continue.'}));}
    res.setHeader('X-ORACLE-Account',user.id);
    try{if(await arcs({req,res,path:url.pathname,url,method:req.method,user}))return;return delegate(req,res);}catch(error){const status=Number.isInteger(error.status)?error.status:500;if(status===500)logger?.({event:'arc_request_failed',code:error.code||'INTERNAL_ERROR'});res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify({error:status===500?'Unable to complete the character-arc request.':error.message}));}
  };
}
