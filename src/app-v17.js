import { readFile } from 'node:fs/promises';
import { createAppV16 } from './app-v16.js';
import { createExperiencesHandler } from './experiences-app.js';
import { digest, readCookie } from './security.js';

const STATIC={
 '/app.js':['app-v17.js','text/javascript'],
 '/app-v16.js':['app-v16.js','text/javascript'],
 '/experiences.html':['experiences.html','text/html'],
 '/experiences.js':['experiences-ui.js','text/javascript'],
 '/experiences.css':['experiences.css','text/css']
};
export function createAppV17({pool,config,logger}){
 const delegate=createAppV16({pool,config,logger}),experiences=createExperiencesHandler({pool});
 return async function handle(req,res){const url=new URL(req.url,config.origin),asset=STATIC[url.pathname];if(asset&&['GET','HEAD'].includes(req.method)){try{const file=await readFile(new URL(`../public/${asset[0]}`,import.meta.url));res.writeHead(200,{'Content-Type':`${asset[1]}; charset=utf-8`,'Cache-Control':'no-store','X-ORACLE-Shell-Version':'1.7.0','X-Content-Type-Options':'nosniff'});return res.end(req.method==='HEAD'?undefined:file);}catch{return delegate(req,res);}}
 if(!/^\/api\/events\/[0-9a-f-]{36}\/experience(?:\/|$)/i.test(url.pathname))return delegate(req,res);if(!['GET','HEAD'].includes(req.method)&&req.headers.origin!==config.origin){res.writeHead(403,{'Content-Type':'application/json; charset=utf-8'});return res.end(JSON.stringify({error:'This request must come from the ORACLE application.'}));}const token=readCookie(req,config.cookieName);const user=token?(await pool.query("SELECT u.id,u.is_superuser FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND NOT u.is_disabled",[digest(token)])).rows[0]:null;if(!user){res.writeHead(401,{'Content-Type':'application/json; charset=utf-8'});return res.end(JSON.stringify({error:'Sign in to continue.'}));}res.setHeader('X-ORACLE-Account',user.id);try{if(await experiences({req,res,path:url.pathname,method:req.method,user}))return;return delegate(req,res);}catch(error){const status=Number.isInteger(error.status)?error.status:500;if(status===500)logger?.({event:'starter_experience_request_failed',code:error.code||'INTERNAL_ERROR'});res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify({error:status===500?'Unable to complete the starter experience request.':error.message}));}}
}
