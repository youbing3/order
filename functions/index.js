const {onCall,HttpsError}=require('firebase-functions/v2/https');
const {initializeApp}=require('firebase-admin/app');
const {getFirestore}=require('firebase-admin/firestore');
const {getAuth}=require('firebase-admin/auth');
const {createHash,randomUUID}=require('node:crypto');

initializeApp();
const db=getFirestore();
const options={region:'asia-east1',cors:['https://youbing-46daa.web.app','https://youbing-46daa.firebaseapp.com'],maxInstances:5};
const adminEmail='youbingcong3@gmail.com';
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
function requireAdmin(auth){
 if(auth?.token.firebase?.sign_in_provider!=='google.com'||auth.token.email_verified!==true||auth.token.email!==adminEmail)fail('請用店家 Google 帳號登入。','permission-denied');
}
function lineUid(auth){
 return auth?.token.firebase?.sign_in_provider==='custom'&&auth.token.lineMember===true?auth.uid:null;
}
function orderSummary(o){
 const {id,qty,subtotal,freight,total,productName,unitPrice,delivery,gift,status,paid,date}=o;
 return {id,qty,subtotal,freight,total,productName,unitPrice,delivery,gift,status,paid,date};
}

exports.lineLogin=onCall(options,async request=>{
 const idToken=text(request.data?.idToken,4096);
 if(!idToken)fail('請先登入 LINE。','unauthenticated');
 const result=await fetch('https://api.line.me/oauth2/v2.1/verify',{
  method:'POST',body:new URLSearchParams({id_token:idToken,client_id:'2012513126'}),signal:AbortSignal.timeout(8000)
 });
 if(!result.ok)fail('LINE 登入已失效，請重新開啟會員專區。','unauthenticated');
 const claims=await result.json();
 if(claims.aud!=='2012513126'||claims.iss!=='https://access.line.me'||!text(claims.sub,128)||!(claims.exp>Date.now()/1000))fail('無法驗證 LINE 身分。','unauthenticated');
 return {token:await getAuth().createCustomToken('line_'+sha(claims.sub),{lineMember:true})};
});

exports.storeApi=onCall(options,async request=>{
 const {path,body:d={}}=request.data??{};
 if(!d||typeof d!=='object'||Array.isArray(d))fail('資料格式錯誤。');
 if(path==='admin'||(typeof path==='string'&&path.startsWith('admin/')))requireAdmin(request.auth);
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
  return {orders:rows(o),members:rows(m).map(({name,phone,date})=>({name,phone,date,lineId:true}))};
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
 case 'admin/update':{
  if(!/^SC-[A-F0-9]{24}$/.test(d.id))fail('訂單編號有誤。');
  return db.runTransaction(async tx=>{
   const ref=order(d.id),o=(await tx.get(ref)).data();
   if(!o)fail('查無訂單。','not-found');
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
  return {member:{name:m.name,phone:m.phone},orders:o.map(orderSummary)};
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
  return {order:o?.phone===phone?orderSummary(o):null};
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
});
