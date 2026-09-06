import { randomUUID, createHash } from 'node:crypto';
import { validateEconomyRequest, ECONOMY_MAX_QUANTITY } from '../public/economy-model.js';
import { ownStoryCharacter } from './story.js';
const reject = (status,message) => {const error=new Error(message);error.status=status;throw error;};
const managers=new Set(['owner','organizer','superuser']);
const playable=event=>['live','rehearsal'].includes(event.status);
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const hash=value=>createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const eventDTO=event=>({id:event.id,name:event.name,status:event.status,role:event.role});
const stockDTO=row=>({id:row.id,name:row.name,description:row.description,quantity:row.quantity,initialQuantity:row.initial_quantity,resourceId:row.resource_id,unitPrice:row.unit_price,version:row.version});
const balanceDTO=(row,resource)=>({resourceId:resource.id,name:resource.name,quantity:row?.quantity||0,version:row?.version||0});
const itemDTO=row=>({id:row.id,name:row.name,quantity:row.quantity,version:row.version});
const emptyAssets=()=>({items:[],resources:[],valid:true});

export async function readEconomyAssets(db,eventId,characterId) {
 const resources=(await db.query('SELECT id,name FROM economy_resources WHERE event_id=$1 ORDER BY id',[eventId])).rows;
 if(!characterId) return {resources,balances:[],inventory:[]};
 const balances=(await db.query('SELECT * FROM economy_balances WHERE event_id=$1 AND character_id=$2',[eventId,characterId])).rows;
 const inventory=(await db.query('SELECT id,name,quantity,version FROM character_inventory WHERE event_id=$1 AND character_id=$2 ORDER BY name,id',[eventId,characterId])).rows.map(itemDTO);
 return {resources,balances:resources.map(resource=>balanceDTO(balances.find(row=>row.resource_id===resource.id),resource)),inventory};
}
export async function resolveTradeAssets(db,event,characterId,offer,{strict=true}={}) {
 const result=emptyAssets();
 const invalid=message=>{result.valid=false;if(strict) reject(409,message);};
 if((offer?.items?.length||offer?.resources?.length)&&!event.setup.enabledInstruments.includes('bazaar')) invalid('BAZAAR is disabled. Remove the asset offer before confirming.');
 for(const item of offer?.items||[]) {
  const row=(await db.query('SELECT id,name,quantity,version FROM character_inventory WHERE event_id=$1 AND character_id=$2 AND id=$3',[event.id,characterId,item.itemId])).rows[0];
  if(!row||row.version!==item.version||row.quantity<item.quantity||(item.name!==undefined&&item.name!==row.name)) invalid('An offered item changed or is no longer available. Save a new offer and confirm again.');
  result.items.push({itemId:item.itemId,name:item.name??row?.name??'Unavailable item',quantity:item.quantity,version:item.version});
 }
 for(const resource of offer?.resources||[]) {
  const row=(await db.query('SELECT r.name,COALESCE(b.quantity,0) AS quantity FROM economy_resources r LEFT JOIN economy_balances b ON b.event_id=r.event_id AND b.resource_id=r.id AND b.character_id=$3 WHERE r.event_id=$1 AND r.id=$2',[event.id,resource.resourceId,characterId])).rows[0];
  if(!row||row.quantity<resource.quantity||(resource.name!==undefined&&resource.name!==row.name)) invalid('An offered resource is no longer available. Review the current balance before confirming.');
  result.resources.push({resourceId:resource.resourceId,name:resource.name??row?.name??'Unavailable resource',quantity:resource.quantity});
 }
 return result;
}
async function writeReceipt(db,event,actorUserId,kind,referenceId,payload,receipt,participants) {
 const requestHash=hash({actorUserId,payload}),previous=(await db.query('SELECT payload_hash,receipt FROM economy_transactions WHERE event_id=$1 AND kind=$2 AND reference_id=$3',[event.id,kind,referenceId])).rows[0];
 if(previous) {if(previous.payload_hash!==requestHash) reject(409,'This transaction reference was already used for different transfers.');return previous.receipt;}
 const id=randomUUID(),createdAt=new Date((await db.query('SELECT clock_timestamp() AS time')).rows[0].time).toISOString();
 const result={id,kind,createdAt,referenceId,...receipt};
 await db.query('INSERT INTO economy_transactions(id,event_id,kind,reference_id,payload_hash,actor_user_id,receipt) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,event.id,kind,referenceId,requestHash,actorUserId,JSON.stringify(result)]);
 for(const participant of participants) if(participant.userId) await db.query('INSERT INTO economy_receipts(event_id,transaction_id,owner_user_id,owner_character_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[event.id,id,participant.userId,participant.characterId]);
 return result;
}
// Caller owns the event mutex and sorted participant user locks. Plan the whole
// final inventory and all balance changes before touching any source row.
export async function transferEconomyAssets(db,event,command) {
 const {kind,actorUserId,referenceId,participants,transfers}=command;
 const payload={participants:participants.map(p=>({characterId:p.characterId,userId:p.userId,name:p.name})),transfers,reason:command.reason||null};
 const previous=(await db.query('SELECT payload_hash,receipt FROM economy_transactions WHERE event_id=$1 AND kind=$2 AND reference_id=$3',[event.id,kind,referenceId])).rows[0];
 if(previous) {if(previous.payload_hash!==hash({actorUserId,payload})) reject(409,'This transaction reference was already used for different transfers.');return previous.receipt;}
 if(!transfers.some(transfer=>transfer.items.length||transfer.resources.length)) return null;
 const party=new Map(participants.map(p=>[p.characterId,p]));
 const inventories=new Map(),originals=new Map(),balances=new Map(),resourceCatalog=new Map((await db.query('SELECT id,name FROM economy_resources WHERE event_id=$1',[event.id])).rows.map(r=>[r.id,r.name]));
 for(const characterId of party.keys()) {
  const rows=(await db.query('SELECT * FROM character_inventory WHERE event_id=$1 AND character_id=$2 ORDER BY id FOR UPDATE',[event.id,characterId])).rows;
  inventories.set(characterId,rows.map(row=>({...row})));for(const row of rows) originals.set(row.id,row);
  for(const balance of (await db.query('SELECT * FROM economy_balances WHERE event_id=$1 AND character_id=$2 FOR UPDATE',[event.id,characterId])).rows) balances.set(`${characterId}:${balance.resource_id}`,{...balance,before:balance.quantity});
 }
 const resourceDebits=new Map(),resourceCredits=new Map(),itemDebits=new Map(),deliveries=[],receiptTransfers=[];
 for(const transfer of transfers) {
  const from=party.get(transfer.fromCharacterId),to=party.get(transfer.toCharacterId);
  if(!from||!to||from.characterId===to.characterId) reject(400,'Transfers require different participants from this event.');
  const receipt={fromCharacterId:from.characterId,fromName:from.name,toCharacterId:to.characterId,toName:to.name,items:[],resources:[]};
  for(const item of transfer.items) {
   const row=originals.get(item.itemId);
   if(!Number.isInteger(item.quantity)||item.quantity<1||item.quantity>9999||!row||row.character_id!==from.characterId||row.version!==item.version) reject(409,'An offered item changed or is no longer available. Save a new offer and confirm again.');
   const amount=(itemDebits.get(row.id)||0)+item.quantity;if(amount>row.quantity) reject(409,'There are not enough items to complete all transfers.');itemDebits.set(row.id,amount);
   deliveries.push({characterId:to.characterId,name:row.name,quantity:item.quantity});receipt.items.push({itemId:row.id,name:row.name,quantity:item.quantity});
  }
  for(const resource of transfer.resources) {
   const name=resourceCatalog.get(resource.resourceId);if(!name||!Number.isInteger(resource.quantity)||resource.quantity<1||resource.quantity>ECONOMY_MAX_QUANTITY) reject(409,'A settlement resource is not available in this event.');
   const source=`${from.characterId}:${resource.resourceId}`,target=`${to.characterId}:${resource.resourceId}`;
   resourceDebits.set(source,(resourceDebits.get(source)||0)+resource.quantity);resourceCredits.set(target,(resourceCredits.get(target)||0)+resource.quantity);
   receipt.resources.push({resourceId:resource.resourceId,name,quantity:resource.quantity});
  }
  receiptTransfers.push(receipt);
 }
 for(const [key,debit] of resourceDebits) if(debit>(balances.get(key)?.quantity||0)) reject(409,'There are not enough resources to complete all transfers.');
 for(const key of new Set([...resourceDebits.keys(),...resourceCredits.keys()])) {
  const [characterId,resourceId]=key.split(':'),row=balances.get(key)||{character_id:characterId,resource_id:resourceId,quantity:0,before:0,version:0};
  row.quantity=row.quantity-(resourceDebits.get(key)||0)+(resourceCredits.get(key)||0);
  if(!Number.isSafeInteger(row.quantity)||row.quantity<0||row.quantity>ECONOMY_MAX_QUANTITY) reject(409,'The receiving resource balance would exceed its limit.');balances.set(key,row);
 }
 for(const rows of inventories.values()) for(const row of rows) if(itemDebits.has(row.id)) {row.quantity-=itemDebits.get(row.id);row.changed=true;}
 for(const [characterId,rows] of inventories) inventories.set(characterId,rows.filter(row=>!row.changed||row.quantity>0));
 for(const delivery of deliveries) addInventory(inventories.get(delivery.characterId),event.id,delivery.characterId,delivery.name,delivery.quantity);
 for(const rows of inventories.values()) if(rows.length>100) reject(409,'The receiving inventory is full. An inventory may contain at most 100 entries.');
 await captureEconomyBaseline(db,event.id);
 for(const [id] of itemDebits) {
  const original=originals.get(id),row=inventories.get(original.character_id).find(item=>item.id===id);
  if(!row) await db.query('DELETE FROM character_inventory WHERE event_id=$1 AND id=$2',[event.id,id]);
 }
 for(const rows of inventories.values()) for(const row of rows) {
  if(row.new) await db.query('INSERT INTO character_inventory(id,event_id,character_id,name,quantity,notes) VALUES($1,$2,$3,$4,$5,\'\')',[row.id,event.id,row.character_id,row.name,row.quantity]);
  else if(row.changed) await db.query('UPDATE character_inventory SET quantity=$3,version=version+1 WHERE event_id=$1 AND id=$2',[event.id,row.id,row.quantity]);
 }
 for(const key of new Set([...resourceDebits.keys(),...resourceCredits.keys()])) {const row=balances.get(key);await setBalance(db,event.id,row.character_id,row.resource_id,row.quantity);}
 return writeReceipt(db,event,actorUserId,kind,referenceId,payload,{transfers:receiptTransfers,...(command.reason?{reason:command.reason}:{})},participants);
}
function addInventory(rows,eventId,characterId,name,quantity) {
 let remaining=quantity;
 for(const existing of rows.filter(row=>row.name===name&&row.notes===''&&row.quantity<9999)) {
  const addition=Math.min(9999-existing.quantity,remaining);existing.quantity+=addition;existing.changed=true;remaining-=addition;if(!remaining)break;
 }
 if(remaining) rows.push({id:randomUUID(),event_id:eventId,character_id:characterId,name,quantity:remaining,notes:'',version:1,new:true});
 if(rows.length>100) reject(409,'The receiving inventory is full. An inventory may contain at most 100 entries.');
}
async function setBalance(db,eventId,characterId,resourceId,quantity) {
 return (await db.query('INSERT INTO economy_balances(event_id,character_id,resource_id,quantity) VALUES($1,$2,$3,$4) ON CONFLICT(event_id,character_id,resource_id) DO UPDATE SET quantity=EXCLUDED.quantity,version=economy_balances.version+1 RETURNING *',[eventId,characterId,resourceId,quantity])).rows[0];
}
export async function captureEconomyBaseline(db,eventId) {
 const rehearsal=(await db.query('SELECT is_rehearsal FROM event_adventures WHERE event_id=$1',[eventId])).rows[0]?.is_rehearsal;
 if(!rehearsal||(await db.query('SELECT event_id FROM economy_baselines WHERE event_id=$1',[eventId])).rows.length) return;
 const inventory=(await db.query("SELECT i.* FROM character_inventory i JOIN characters c ON c.event_id=i.event_id AND c.id=i.character_id WHERE i.event_id=$1 AND c.status='approved' ORDER BY i.id",[eventId])).rows;
 await db.query('INSERT INTO economy_baselines(event_id,inventory) VALUES($1,$2) ON CONFLICT DO NOTHING',[eventId,JSON.stringify(inventory)]);
}
export async function resetEconomy(db,eventId) {
 if(!(await db.query('SELECT is_rehearsal FROM event_adventures WHERE event_id=$1',[eventId])).rows[0]?.is_rehearsal) reject(409,'Only a rehearsal copy can reset its economy.');
 await captureEconomyBaseline(db,eventId);
 for(const table of ['economy_requests','economy_receipts','economy_transactions','economy_balances','exchange_trade_offers']) await db.query(`DELETE FROM ${table} WHERE event_id=$1`,[eventId]);
 await db.query('UPDATE economy_stock SET quantity=initial_quantity,version=version+1 WHERE event_id=$1',[eventId]);
 const baseline=(await db.query('SELECT inventory FROM economy_baselines WHERE event_id=$1',[eventId])).rows[0];
 if(baseline) {
  await db.query('DELETE FROM character_inventory WHERE event_id=$1',[eventId]);
  for(const row of baseline.inventory) await db.query('INSERT INTO character_inventory(id,event_id,character_id,name,quantity,notes,version) SELECT $1,$2,c.id,$4,$5,$6,$7 FROM characters c WHERE c.event_id=$2 AND c.id=$3',[row.id,eventId,row.character_id,row.name,row.quantity,row.notes,row.version]);
 }
}
export async function seedEconomy(db,event,actorId) {
 void actorId;
 if((await db.query('SELECT id FROM economy_resources WHERE event_id=$1 LIMIT 1',[event.id])).rows.length) return;
 const theme=event.setup.theme?.id||event.setup.themeId||'fantasy';
 const name=theme==='cyberpunk'?'Credits':theme==='wasteland'?'Scrap':'Crowns',item=theme==='cyberpunk'?'Signal battery':theme==='wasteland'?'Water ration':'Trail provision';
 await db.query('INSERT INTO economy_resources(event_id,id,name) VALUES($1,\'tokens\',$2)',[event.id,name]);
 const shopId=randomUUID();await db.query('INSERT INTO economy_shops(id,event_id,name,description,enabled) VALUES($1,$2,\'Field supply post\',\'Practice a confirmed purchase here after an organizer grants resources.\',true)',[shopId,event.id]);
 await db.query('INSERT INTO economy_stock(id,event_id,shop_id,name,description,quantity,initial_quantity,resource_id,unit_price) VALUES($1,$2,$3,$4,\'A fictional event supply.\',12,12,\'tokens\',2)',[randomUUID(),event.id,shopId,item]);
}
export async function copyEconomy(db,sourceEventId,eventId,actorId) {
 void actorId;
 await db.query('INSERT INTO economy_resources(event_id,id,name) SELECT $2,id,name FROM economy_resources WHERE event_id=$1',[sourceEventId,eventId]);
 for(const shop of (await db.query('SELECT * FROM economy_shops WHERE event_id=$1',[sourceEventId])).rows) {
  const id=randomUUID();await db.query('INSERT INTO economy_shops(id,event_id,name,description,enabled) VALUES($1,$2,$3,$4,$5)',[id,eventId,shop.name,shop.description,shop.enabled]);
  for(const stock of (await db.query('SELECT * FROM economy_stock WHERE event_id=$1 AND shop_id=$2',[sourceEventId,shop.id])).rows) await db.query('INSERT INTO economy_stock(id,event_id,shop_id,name,description,quantity,initial_quantity,resource_id,unit_price) VALUES($1,$2,$3,$4,$5,$6,$6,$7,$8)',[randomUUID(),eventId,id,stock.name,stock.description,stock.initial_quantity,stock.resource_id,stock.unit_price]);
 }
}
async function readShops(db,eventId,canManage) {
 const shops=(await db.query('SELECT * FROM economy_shops WHERE event_id=$1 AND ($2::boolean OR enabled) ORDER BY name,id',[eventId,canManage])).rows;
 const stock=(await db.query('SELECT * FROM economy_stock WHERE event_id=$1 ORDER BY name,id',[eventId])).rows;
 return shops.map(row=>({id:row.id,name:row.name,description:row.description,enabled:row.enabled,version:row.version,stock:stock.filter(item=>item.shop_id===row.id).map(stockDTO)}));
}
export function createEconomyHandler({pool,helpers}) {
 const {body,send,identifier,membership,audit,transaction}=helpers;
 const requireManager=event=>{if(!managers.has(event.role)) reject(403,'Organizer access is required.');};
 async function own(db,event,user,id) {const row=await ownStoryCharacter(db,event,user,id);if(!row) reject(404,'Character not found or not assigned to you.');return row;}
 return async function handleEconomy({req,res,path,url,method,user}) {
  const match=/^\/api\/events\/([^/]+)\/bazaar(?:\/(manage|resources|shops|adjust|purchase))?(?:\/([^/]+))?(?:\/(stock))?(?:\/([^/]+))?$/.exec(path);if(!match)return false;
  if(!user)reject(401,'Sign in to continue.');
  const eventId=identifier(match[1]).toLowerCase(),section=match[2],shopId=match[3]?identifier(match[3]).toLowerCase():null,stockId=match[5]?identifier(match[5]).toLowerCase():null;
  if((shopId&&section!=='shops')||(match[4]&&!shopId)) reject(404,'Economy route not found.');
  if(method==='GET') {
   if(shopId||!['manage',undefined].includes(section)) reject(405,'Method not allowed.');
   const event=await membership(pool,eventId,user.id),canManage=managers.has(event.role);if(section==='manage')requireManager(event);
   const resources=(await readEconomyAssets(pool,eventId,null)).resources,shops=await readShops(pool,eventId,canManage);
   if(section==='manage') {
    const characters=(await pool.query("SELECT id,profile,status FROM characters WHERE event_id=$1 AND status<>'retired' ORDER BY created_at,id",[eventId])).rows.map(row=>({id:row.id,name:row.profile.name,status:row.status}));
    const rows=(await pool.query('SELECT * FROM economy_balances WHERE event_id=$1',[eventId])).rows;
    const balances=characters.flatMap(character=>resources.map(resource=>({characterId:character.id,...balanceDTO(rows.find(row=>row.character_id===character.id&&row.resource_id===resource.id),resource)})));
    const receipts=(await pool.query('SELECT receipt FROM economy_transactions WHERE event_id=$1 ORDER BY created_at DESC,id DESC LIMIT 200',[eventId])).rows.map(row=>row.receipt);
    send(res,200,{event:eventDTO(event),resources,shops,characters,balances,receipts,canManage,readOnly:event.status==='archived'});return true;
   }
   const character=await ownStoryCharacter(pool,event,user,url.searchParams.get('characterId'));
   const characters=(await pool.query("SELECT id,profile FROM characters WHERE event_id=$1 AND user_id=$2 AND status='approved' ORDER BY created_at,id",[eventId,user.id])).rows.map(row=>({id:row.id,name:row.profile.name}));
   const assets=await readEconomyAssets(pool,eventId,character?.id);
   const receipts=character?(await pool.query('SELECT t.receipt FROM economy_receipts r JOIN economy_transactions t ON t.event_id=r.event_id AND t.id=r.transaction_id WHERE r.event_id=$1 AND r.owner_user_id=$2 AND r.owner_character_id=$3 ORDER BY t.created_at DESC,t.id DESC LIMIT 100',[eventId,user.id,character.id])).rows.map(row=>row.receipt):[];
   const enabled=event.setup.enabledInstruments.includes('bazaar');
   send(res,200,{event:eventDTO(event),character:character?{id:character.id,name:character.profile.name}:null,characters,...assets,shops,receipts,canManage,readOnly:!character||!playable(event)||!enabled,message:!enabled?'BAZAAR is disabled for this event.':!character?'Choose an approved character to use BAZAAR.':null});return true;
  }
  const action=section==='resources'&&method==='POST'&&!shopId?'resource':section==='shops'&&!match[4]&&(method==='POST'&&!shopId||method==='PATCH'&&shopId)?shopId?'shopUpdate':'shop':section==='shops'&&match[4]&&(method==='POST'&&!stockId||method==='PATCH'&&stockId)?stockId?'stockUpdate':'stock':section==='adjust'&&method==='POST'?'adjust':section==='purchase'&&method==='POST'?'purchase':null;
  if(!action)reject(405,'Method not allowed.');
  const input=validateEconomyRequest(await body(req),action),payloadHash=hash({action,shopId,stockId,input});let created=false;
  const result=await transaction(pool,async db=>{
   let event=await membership(db,eventId,user.id,true);
   const target=input.characterId?(await db.query('SELECT user_id FROM characters WHERE event_id=$1 AND id=$2',[eventId,input.characterId])).rows[0]:null;
   await db.query('SELECT id FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE',[[...new Set([user.id,target?.user_id].filter(Boolean))].sort()]);
   event=await membership(db,eventId,user.id);
   let character=null;if(action==='purchase')character=await own(db,event,user,input.characterId);else requireManager(event);
   const previous=(await db.query('SELECT * FROM economy_requests WHERE event_id=$1 AND actor_user_id=$2 AND request_id=$3',[eventId,user.id,input.requestId])).rows[0];
   if(previous){if(previous.payload_hash!==payloadHash)reject(409,'This request identifier was already used for different information.');return {...previous.response,outcome:{replayed:true}};}
   if(event.status==='archived')reject(409,'Archived events are read-only.');
   if((await db.query('SELECT count(*)::int AS n FROM economy_requests WHERE event_id=$1 AND actor_user_id=$2',[eventId,user.id])).rows[0].n>=10000)reject(429,'This account has reached the request history limit for this event.');
   if(action==='purchase'&&(!playable(event)||!event.setup.enabledInstruments.includes('bazaar')))reject(409,'Purchases require BAZAAR in a live event or rehearsal.');
   await captureEconomyBaseline(db,eventId);
   let response,correctionAudit=null;
   if(action==='resource') {
    if((await db.query('SELECT count(*)::int AS n FROM economy_resources WHERE event_id=$1',[eventId])).rows[0].n>=20)reject(409,'An event may define at most 20 resources.');
    if((await db.query('SELECT id FROM economy_resources WHERE event_id=$1 AND id=$2',[eventId,input.id])).rows.length)reject(409,'This resource identifier already exists.');
    const resource=(await db.query('INSERT INTO economy_resources(event_id,id,name) VALUES($1,$2,$3) RETURNING id,name',[eventId,input.id,input.name])).rows[0];response={resource};created=true;
   } else if(action==='shop'||action==='shopUpdate') {
    let row;
    if(action==='shop') {if((await db.query('SELECT count(*)::int AS n FROM economy_shops WHERE event_id=$1',[eventId])).rows[0].n>=30)reject(409,'An event may contain at most 30 shops.');row=(await db.query('INSERT INTO economy_shops(id,event_id,name,description,enabled) VALUES($1,$2,$3,$4,$5) RETURNING *',[randomUUID(),eventId,input.name,input.description,input.enabled])).rows[0];created=true;}
    else {row=(await db.query('UPDATE economy_shops SET name=$3,description=$4,enabled=$5,version=version+1 WHERE event_id=$1 AND id=$2 AND version=$6 RETURNING *',[eventId,shopId,input.name,input.description,input.enabled,input.version])).rows[0];if(!row)reject(409,'The shop changed. Refresh before saving.');}
    response={shop:{id:row.id,name:row.name,description:row.description,enabled:row.enabled,version:row.version,stock:(await readShops(db,eventId,true)).find(shop=>shop.id===row.id).stock}};
   } else if(action==='stock'||action==='stockUpdate') {
    if(!(await db.query('SELECT id FROM economy_shops WHERE event_id=$1 AND id=$2',[eventId,shopId])).rows.length)reject(404,'Shop not found.');
    if(!(await db.query('SELECT id FROM economy_resources WHERE event_id=$1 AND id=$2',[eventId,input.resourceId])).rows.length)reject(400,'Choose a resource from this event.');
    let row;
    if(action==='stock'){if((await db.query('SELECT count(*)::int AS n FROM economy_stock WHERE event_id=$1 AND shop_id=$2',[eventId,shopId])).rows[0].n>=100)reject(409,'A shop may contain at most 100 stock lines.');row=(await db.query('INSERT INTO economy_stock(id,event_id,shop_id,name,description,quantity,initial_quantity,resource_id,unit_price) VALUES($1,$2,$3,$4,$5,$6,$6,$7,$8) RETURNING *',[randomUUID(),eventId,shopId,input.name,input.description,input.quantity,input.resourceId,input.unitPrice])).rows[0];created=true;}
    else {const before=(await db.query('SELECT * FROM economy_stock WHERE event_id=$1 AND shop_id=$2 AND id=$3',[eventId,shopId,stockId])).rows[0];correctionAudit={shopId,stockId,before:before?{quantity:before.quantity,unitPrice:before.unit_price,resourceId:before.resource_id,name:before.name}:null,after:{quantity:input.quantity,unitPrice:input.unitPrice,resourceId:input.resourceId,name:input.name}};row=(await db.query('UPDATE economy_stock SET name=$4,description=$5,quantity=$6,initial_quantity=$6,resource_id=$7,unit_price=$8,version=version+1 WHERE event_id=$1 AND shop_id=$2 AND id=$3 AND version=$9 RETURNING *',[eventId,shopId,stockId,input.name,input.description,input.quantity,input.resourceId,input.unitPrice,input.version])).rows[0];if(!row)reject(409,'The stock changed. Refresh before saving.');}
    response={stock:stockDTO(row)};
   } else if(action==='adjust') {
    const targetCharacter=(await db.query("SELECT * FROM characters WHERE event_id=$1 AND id=$2 AND status<>'retired'",[eventId,input.characterId])).rows[0];if(!targetCharacter)reject(404,'Character not found.');
    const resource=(await db.query('SELECT id,name FROM economy_resources WHERE event_id=$1 AND id=$2',[eventId,input.resourceId])).rows[0];if(!resource)reject(400,'Choose a resource from this event.');
    if(input.agreementId&&!(await db.query('SELECT id FROM oath_agreements WHERE event_id=$1 AND id=$2',[eventId,input.agreementId])).rows.length)reject(404,'Agreement not found.');
    const balance=(await db.query('SELECT * FROM economy_balances WHERE event_id=$1 AND character_id=$2 AND resource_id=$3 FOR UPDATE',[eventId,input.characterId,input.resourceId])).rows[0];
    if((balance?.version||0)!==input.version)reject(409,'The balance changed. Refresh before recording a correction.');
    const updated=await setBalance(db,eventId,input.characterId,input.resourceId,input.quantity);
    const receipt=await writeReceipt(db,event,user.id,'adjustment',input.requestId,input,{transfers:[],correction:{characterId:targetCharacter.id,characterName:targetCharacter.profile.name,resourceId:resource.id,resourceName:resource.name,before:balance?.quantity||0,quantity:input.quantity,reason:input.reason,agreementId:input.agreementId||null}},[{characterId:targetCharacter.id,userId:targetCharacter.user_id}]);
    response={balance:balanceDTO(updated,resource),receipt};
   } else if(action==='purchase') {
    const row=(await db.query('SELECT s.*,p.name AS shop_name,p.enabled,r.name AS resource_name FROM economy_stock s JOIN economy_shops p ON p.event_id=s.event_id AND p.id=s.shop_id JOIN economy_resources r ON r.event_id=s.event_id AND r.id=s.resource_id WHERE s.event_id=$1 AND s.shop_id=$2 AND s.id=$3 FOR UPDATE OF s',[eventId,input.shopId,input.stockId])).rows[0];
    if(!row||!row.enabled)reject(404,'Shop stock not found.');if(row.version!==input.version)reject(409,'The stock or price changed. Review the current offer before purchasing.');if(row.quantity<input.quantity)reject(409,'There is not enough stock to complete this purchase.');
    const total=row.unit_price*input.quantity;if(!Number.isSafeInteger(total)||total>ECONOMY_MAX_QUANTITY)reject(409,'The purchase total exceeds the supported resource limit.');
    const balance=(await db.query('SELECT * FROM economy_balances WHERE event_id=$1 AND character_id=$2 AND resource_id=$3 FOR UPDATE',[eventId,character.id,row.resource_id])).rows[0];if((balance?.quantity||0)<total)reject(409,'There are not enough resources to complete this purchase.');
    const inventory=(await db.query('SELECT * FROM character_inventory WHERE event_id=$1 AND character_id=$2 ORDER BY id FOR UPDATE',[eventId,character.id])).rows;addInventory(inventory,eventId,character.id,row.name,input.quantity);
    await setBalance(db,eventId,character.id,row.resource_id,balance.quantity-total);await db.query('UPDATE economy_stock SET quantity=quantity-$3,version=version+1 WHERE event_id=$1 AND id=$2',[eventId,row.id,input.quantity]);
    for(const item of inventory) if(item.new)await db.query('INSERT INTO character_inventory(id,event_id,character_id,name,quantity,notes) VALUES($1,$2,$3,$4,$5,\'\')',[item.id,eventId,character.id,item.name,item.quantity]);else if(item.changed)await db.query('UPDATE character_inventory SET quantity=$3,version=version+1 WHERE event_id=$1 AND id=$2',[eventId,item.id,item.quantity]);
    const receipt=await writeReceipt(db,event,user.id,'purchase',input.requestId,input,{transfers:[],purchase:{shopId:row.shop_id,shopName:row.shop_name,stockId:row.id,name:row.name,quantity:input.quantity,resourceId:row.resource_id,resourceName:row.resource_name,unitPrice:row.unit_price,total}},[{characterId:character.id,userId:user.id}]);response={receipt};
   }
   await audit(db,eventId,user.id,`economy.${action}`,{requestId:input.requestId,...(correctionAudit?{correction:correctionAudit}:{}),...(response.receipt?{transactionId:response.receipt.id}:{}),...(input.reason?{reason:input.reason}:{}),...(input.agreementId?{agreementId:input.agreementId}:{})});
   await db.query('INSERT INTO economy_requests(event_id,actor_user_id,request_id,payload_hash,action,response,character_id) VALUES($1,$2,$3,$4,$5,$6,$7)',[eventId,user.id,input.requestId,payloadHash,action,JSON.stringify(response),input.characterId||null]);return {...response,outcome:{replayed:false}};
  });
  send(res,created?201:200,result);return true;
 };
}
