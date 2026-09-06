import { characterRecord, characterText, characterInteger } from './characters-model.js';
export const ECONOMY_MAX_QUANTITY = 1_000_000_000;
export const ECONOMY_MAX_TRADE_ITEMS = 10;
export const ECONOMY_MAX_RESOURCES = 20;
const reject = message => { const error = new Error(message); error.status = 400; throw error; };
export function economyUUID(value, label = 'Identifier') { if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) reject(`${label} must be a UUID.`); return value.toLowerCase(); }
export function economyResourceId(value) { if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{0,39}$/.test(value)) reject('Resource identifier must be a lowercase slug of at most 40 characters.'); return value; }
export function economyList(value, label, max) {
 if (!Array.isArray(value) || value.length>max || Reflect.ownKeys(value).length!==value.length+1) reject(`${label} must contain at most ${max} entries.`);
 for(let i=0;i<value.length;i++) if(!Object.hasOwn(value,i)||!Object.hasOwn(Object.getOwnPropertyDescriptor(value,i),'value')) reject(`${label} must contain plain data entries.`);
 return value;
}
export function validateTradeAssets(value) {
 characterRecord(value,['items','resources'],'Trade assets');
 const items = economyList(value.items,'Offered items',ECONOMY_MAX_TRADE_ITEMS).map(item => { characterRecord(item,['itemId','quantity','version'],'Offered item'); return {itemId:economyUUID(item.itemId),quantity:characterInteger(item.quantity,'Item quantity',1,9999),version:characterInteger(item.version,'Item version',1,2147483647)}; }).sort((a,b)=>a.itemId.localeCompare(b.itemId));
 const resources = economyList(value.resources,'Offered resources',ECONOMY_MAX_RESOURCES).map(item => {characterRecord(item,['resourceId','quantity'],'Offered resource');return {resourceId:economyResourceId(item.resourceId),quantity:characterInteger(item.quantity,'Resource quantity',1,ECONOMY_MAX_QUANTITY)};}).sort((a,b)=>a.resourceId.localeCompare(b.resourceId));
 if(new Set(items.map(x=>x.itemId)).size!==items.length||new Set(resources.map(x=>x.resourceId)).size!==resources.length) reject('Each asset may be offered only once.');
 return {items,resources};
}
export function validateEconomyRequest(value,action) {
 const fields = {resource:['requestId','id','name'],shop:['requestId','name','description','enabled'],shopUpdate:['requestId','name','description','enabled','version'],stock:['requestId','name','description','quantity','resourceId','unitPrice'],stockUpdate:['requestId','name','description','quantity','resourceId','unitPrice','version','reason'],adjust:['requestId','characterId','resourceId','quantity','version','reason','agreementId'],purchase:['requestId','characterId','shopId','stockId','version','quantity']};
 if(!Object.hasOwn(fields,action)) reject('Unsupported economy action.');
 characterRecord(value,fields[action],'Economy request',fields[action].filter(key=>key!=='agreementId'));
 const out={requestId:economyUUID(value.requestId,'Request identifier')};
 if(Object.hasOwn(value,'characterId')) out.characterId=economyUUID(value.characterId,'Character identifier');
 if(Object.hasOwn(value,'version')) out.version=characterInteger(value.version,'Version',action==='adjust'?0:1,2147483647);
 if(Object.hasOwn(value,'quantity')) out.quantity=characterInteger(value.quantity,'Quantity',action==='purchase'?1:0,action==='adjust'?ECONOMY_MAX_QUANTITY:9999);
 if(Object.hasOwn(value,'resourceId')) out.resourceId=economyResourceId(value.resourceId);
 if(Object.hasOwn(value,'name')) out.name=characterText(value.name,'Name',1,action==='resource'?80:100);
 if(Object.hasOwn(value,'description')) out.description=characterText(value.description,'Description',0,2000);
 if(Object.hasOwn(value,'reason')) out.reason=characterText(value.reason,'Correction reason',1,2000);
 if(Object.hasOwn(value,'enabled')) {if(typeof value.enabled!=='boolean') reject('Shop visibility must be true or false.');out.enabled=value.enabled;}
 if(action==='resource') out.id=economyResourceId(value.id);
 if(Object.hasOwn(value,'unitPrice')) out.unitPrice=characterInteger(value.unitPrice,'Unit price',1,ECONOMY_MAX_QUANTITY);
 for(const key of ['shopId','stockId','agreementId']) if(Object.hasOwn(value,key)) out[key]=economyUUID(value[key],key);
 return out;
}
