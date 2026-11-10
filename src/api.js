import {randomUUID,createHash} from 'node:crypto';
import {customToken} from './identity.js';
export class HttpsError extends Error {constructor(code,message){super(message);this.code=code;}}
export function buildApi(db,env){
const config=db.doc('store/config');
const product=id=>db.collection('products').doc(id);
const member=id=>db.collection('members').doc(id);
const order=id=>db.collection('orders').doc(id);
const defaults={accepting:false,enabled:false,gift:'保冰袋 1 個',threshold:300,start:'',end:'',shippingFee:0,freeShipping:null};
const text=(v,max)=>typeof v==='string'&&v.trim().length<=max?v.trim():'';
const integer=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const fail=(message,code='invalid-argument')=>{throw new HttpsError(code,message);};
const sha=v=>createHash('sha256').update(v).digest('hex');
const rows=s=>s.docs.map(d=>d.data());
const date=()=>new Date().toISOString();
const validDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const settings=s=>({...defaults,...s.data()});
function promo(s){
 const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 return s.enabled&&today>=s.start&&today<=s.end?{gift:s.gift,threshold:s.threshold}:null;
}
async function requireAdmin(auth){
 const email=auth?.token.email;
 if(auth?.token.firebase?.sign_in_provider!=='password'||auth.token.email_verified!==true||typeof email!=='string')fail('請用已驗證的管理員 Email 和密碼登入。','permission-denied');
 const admin=(await db.collection('admins').doc(auth.uid).get()).data();
 if(admin?.active!==true)fail('這個帳號尚未開放後台權限。','permission-denied');
 return email;
}
function lineUid(auth){
 return auth?.token.firebase?.sign_in_provider==='custom'&&auth.token.lineMember===true?auth.uid:null;
}
function orderSummary(o){
 const {id,qty,subtotal,freight,total,productName,unitPrice,delivery,gift,status,paid,date}=o;
 return {id,qty,subtotal,freight,total,productName,unitPrice,delivery,gift,status,paid,date};
}

async function lineLogin(request){
 const idToken=text(request.data?.idToken,4096);
 if(!idToken)fail('請先登入 LINE。','unauthenticated');
 const result=await fetch('https://api.line.me/oauth2/v2.1/verify',{
  method:'POST',body:new URLSearchParams({id_token:idToken,client_id:'2012513126'}),signal:AbortSignal.timeout(8000)
 });
 if(!result.ok)fail('LINE 登入已失效，請重新開啟會員專區。','unauthenticated');
 const claims=await result.json();
 if(claims.aud!=='2012513126'||claims.iss!=='https://access.line.me'||!text(claims.sub,128)||!(claims.exp>Date.now()/1000))fail('無法驗證 LINE 身分。','unauthenticated');
 return {token:await customToken(env,'line_'+sha(claims.sub))};
}

async function storeApi(request){
 const {path,body:d={}}=request.data??{};
 if(!d||typeof d!=='object'||Array.isArray(d))fail('資料格式錯誤。');
 if(path==='admin'||(typeof path==='string'&&path.startsWith('admin/'))){
  const email=await requireAdmin(request.auth);
  const sessions=db.collection('adminSessions');
  const now=Date.now();
  if(path==='admin/session/open'){
   const id=randomUUID();
   await sessions.doc(id).create({uid:request.auth.uid,email,device:text(d.device,180)||'未知裝置',started:now,lastSeen:now,revoked:false});
   return {id};
  }
  const id=request.data.session;
  if(typeof id!=='string'||! /^[a-f0-9-]{36}$/.test(id))fail('請重新登入。','unauthenticated');
  const ref=sessions.doc(id);
  await db.runTransaction(async tx=>{
   const entry=(await tx.get(ref)).data();
   if(!entry||entry.uid!==request.auth.uid||entry.revoked)fail('登入已結束，請重新登入。','unauthenticated');
   if(now-entry.lastSeen>15000)tx.update(ref,{lastSeen:now});
  });
  if(path==='admin/session/ping')return {ok:true};
  if(path==='admin/session/list'){
   const items=await sessions.where('lastSeen','>=',now-180000).get();
   return items.docs.filter(x=>!x.data().revoked).map(x=>{
    const {email,device,started,lastSeen}=x.data();
    return {id:x.id,email:email??'舊版工作階段',device,started,lastSeen,current:x.id===id};
   });
  }
  if(path==='admin/session/revoke'){
   if(typeof d.id!=='string'||! /^[a-f0-9-]{36}$/.test(d.id))fail('裝置編號有誤。');
   const target=sessions.doc(d.id);
   await db.runTransaction(async tx=>{
    const entry=(await tx.get(target)).data();
    if(!entry)fail('找不到登入裝置。','not-found');
    tx.update(target,{revoked:true});
   });
   return {ok:true};
  }
 }
 const uid=lineUid(request.auth);
 switch(path){
 case 'product':{
  const [s,p]=await Promise.all([config.get(),db.collection('products').where('active','==',true).get()]);
  const store=settings(s);
  return {catalog:rows(p),promotion:promo(store),accepting:store.accepting,shippingFee:store.shippingFee,freeShipping:store.freeShipping};
 }
 case 'admin/catalog':return rows(await db.collection('products').get());
 case 'admin':{
  const [o,m]=await Promise.all([db.collection('orders').orderBy('date','desc').get(),db.collection('members').get()]);
  return {orders:rows(o).filter(order=>!order.deletedAt),members:rows(m).map(({name,phone,date})=>({name,phone,date,lineId:true}))};
 }
 case 'admin/store':{
  if(!request.data.body)return settings(await config.get());
  const gift=text(d.gift,60),threshold=Number(d.threshold),shippingFee=Number(d.shippingFee);
  const freeShipping=d.freeShipping===''?null:Number(d.freeShipping);
  const start=text(d.start,10),end=text(d.end,10),enabled=d.enabled==='on';
  if(!gift||!integer(threshold,1,99999999)||d.shippingFee===''||!integer(shippingFee,0,100000)||(freeShipping!==null&&!integer(freeShipping,1,99999999)))fail('請確認活動及運費金額。');
  if((enabled||start||end)&&(!validDate(start)||!validDate(end)||start>end))fail('請確認活動日期。');
  const s={gift,threshold,shippingFee,freeShipping,start,end,enabled,accepting:d.accepting==='on'};
  await config.set(s);return s;
 }
 case 'admin/product':{
  const id=d.id||randomUUID(),name=text(d.name,60),price=Number(d.price),image=text(d.image,350000);
  if(!/^[a-f0-9-]{36}$/.test(id)||!name||!integer(price,1,100000)||(d.image&&!/^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(image)))fail('請確認品名、價格及圖片大小。');
  const p={id,name,price,image,active:d.active==='on'};
  await product(id).set(p);return p;
 }
 case 'admin/edit':
 case 'admin/delete':
 case 'admin/update':{
  if(!/^SC-[A-F0-9]{24}$/.test(d.id))fail('訂單編號有誤。');
  return db.runTransaction(async tx=>{
   const ref=order(d.id),o=(await tx.get(ref)).data();
   if(!o||o.deletedAt)fail('查無訂單。','not-found');
   if(path==='admin/delete'){
    if(o.paid)fail('已收款的訂單請先確認退款，再取消收款標記。','failed-precondition');
    tx.update(ref,{deletedAt:date(),deletedBy:request.auth.uid});
    return {ok:true};
   }
   if(path==='admin/edit'){
    if(o.paid||!['待確認','已確認'].includes(o.status))fail('只可編輯尚未收款且未完成的訂單。','failed-precondition');
    if((o.updatedAt||'')!==d.updatedAt)fail('訂單已更新，請重新整理後再編輯。','failed-precondition');
    const buyer=text(d.buyer,50),phone=text(d.phone,10),productName=text(d.productName,60),qty=Number(d.qty),unitPrice=Number(d.unitPrice),freight=Number(d.freight);
    const receiver=text(d.receiver,50),address=text(d.address,180),gift=text(d.gift,60);
    if(!buyer||!/^\d{8,10}$/.test(phone)||!productName||!integer(qty,1,999)||d.unitPrice===''||!integer(unitPrice,0,100000)||d.freight===''||!integer(freight,0,100000))fail('請確認訂單欄位與金額。');
    if(o.delivery==='ship'&&(!receiver||!address))fail('請填寫收件人和宅配地址。');
    const subtotal=qty*unitPrice,shipping=o.delivery==='ship'?freight:0;
    tx.update(ref,{buyer,phone,productName,qty,unitPrice,subtotal,freight:shipping,total:subtotal+shipping,receiver,address,gift,note:text(d.note,250),updatedAt:date()});
    return {ok:true};
   }

   if(typeof d.paid==='boolean'&&o.status!=='已取消')tx.update(ref,{paid:d.paid});
   else{
    const next=o.status==='待確認'?['已確認','已取消']:o.status==='已確認'?[o.delivery==='ship'?'已出貨':'已取貨']:[];
    if(!next.includes(d.status))fail('請依目前訂單狀態操作。','failed-precondition');
    tx.update(ref,{status:d.status});
   }
   return {ok:true};
  });
 }
 case 'history':{
  if(!uid)return {member:null,orders:[]};
  const m=(await member(uid).get()).data();
  if(!m)return {member:null,orders:[]};
  const o=rows(await db.collection('orders').where('memberUid','==',uid).get());
  o.sort((a,b)=>b.date.localeCompare(a.date));
  return {member:{name:m.name,phone:m.phone},orders:o.filter(order=>!order.deletedAt).map(orderSummary)};
 }
 case 'member':{
  if(!uid)fail('請先用 LINE 登入。','unauthenticated');
  const name=text(d.buyer,50),phone=text(d.phone,10);
  if(!name||!/^09\d{8}$/.test(phone))fail('請確認姓名與手機號碼。');
  return db.runTransaction(async tx=>{
   const ref=member(uid),s=await tx.get(config),current=await tx.get(ref);
   if(current.exists)return {created:false};
   if(!settings(s).accepting)fail('目前暫停會員登記。','unavailable');
   tx.create(ref,{name,phone,date:date()});return {created:true};
  });
 }
 case 'lookup':{
  const id=text(d.id,40).toUpperCase(),phone=text(d.phone,10);
  if(!/^SC-[A-F0-9]{24}$/.test(id)||!/^\d{8,10}$/.test(phone))return {order:null};
  const o=(await order(id).get()).data();
  return {order:o?.phone===phone&&!o.deletedAt?orderSummary(o):null};
 }
 case 'order':{
  const buyer=text(d.buyer,50),phone=text(d.phone,10),qty=Number(d.qty),delivery=d.delivery;
  const receiver=text(d.receiver,50),address=text(d.address,180);
  if(!buyer||!/^\d{8,10}$/.test(phone)||!integer(qty,1,999)||!['ship','pickup'].includes(delivery)||!(/^[a-f0-9-]{36}$/.test(d.productId)))fail('請確認商品、張數、姓名與電話。');
  if(delivery==='ship'&&(!receiver||!address))fail('請填寫收件姓名和地址。');
  if(!/^[a-f0-9-]{36}$/.test(d.requestId))fail('請重新開啟訂購頁。');
  const id='SC-'+sha(d.requestId).slice(0,24).toUpperCase();
  return db.runTransaction(async tx=>{
   const ref=order(id),existing=(await tx.get(ref)).data();
   if(existing){
    if(existing.deletedAt)fail("這筆訂單已移除，請重新開啟訂購頁。","failed-precondition");
    if(existing.phone!==phone||existing.memberUid!==uid)fail('請重新開啟訂購頁。','permission-denied');
    return orderSummary(existing);
   }
   const [s,p]=await Promise.all([tx.get(config),tx.get(product(d.productId))]);
   const store=settings(s),item=p.data(),promotion=promo(store);
   if(!store.accepting)fail('目前暫停接單。','unavailable');
   const subtotal=qty*(item?.price??0);
   const freight=delivery==='ship'&&(store.freeShipping===null||subtotal<store.freeShipping)?store.shippingFee:0;
   if(!item?.active||item.price!==d.unitPrice||item.name!==d.productName||d.freight!==freight||JSON.stringify(promotion)!==d.promotion)fail('商品、活動或運費已更新，請確認後再送出。','failed-precondition');
   const o={id,buyer,phone,qty,delivery,subtotal,freight,total:subtotal+freight,productName:item.name,unitPrice:item.price,
    gift:promotion&&subtotal>=promotion.threshold?promotion.gift:'',status:'待確認',paid:false,date:date(),
    receiver:delivery==='ship'?receiver:'',address:delivery==='ship'?address:'',note:text(d.note,250),
    memberUid:uid};
   tx.create(ref,o);return orderSummary(o);
  });
 }
 default:fail('找不到功能。','not-found');
 }
}
return {lineLogin,storeApi};
}
