import { readFile } from 'node:fs/promises';
import { createAppV17 } from './app-v17.js';
const STATIC={
 '/app.js':['app-v18.js','text/javascript'],
 '/app-v17.js':['app-v17.js','text/javascript'],
 '/install.js':['install-v18.js','text/javascript'],
 '/sw.js':['sw-v18.js','text/javascript'],
 '/install.js':['install-v18.js','text/javascript'],
 '/sw.js':['sw-v18.js','text/javascript'],
 '/field-home.html':['field-home.html','text/html'],
 '/field-home.js':['field-home.js','text/javascript'],
 '/field-home.css':['field-home.css','text/css']
};
export function createAppV18({pool,config,logger}){
 const delegate=createAppV17({pool,config,logger});
 return async function handle(req,res){const url=new URL(req.url,config.origin),asset=STATIC[url.pathname];if(asset&&['GET','HEAD'].includes(req.method)){try{const file=await readFile(new URL(`../public/${asset[0]}`,import.meta.url));res.writeHead(200,{'Content-Type':`${asset[1]}; charset=utf-8`,'Cache-Control':'no-store','X-ORACLE-Shell-Version':'1.8.0','X-Content-Type-Options':'nosniff'});return res.end(req.method==='HEAD'?undefined:file);}catch{return delegate(req,res);}}return delegate(req,res);};
}
