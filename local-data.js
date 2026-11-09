const demoKey='scallion-shared-preview-v2';
const defaultDemo={
 catalog:[{id:'scallion',name:'蔥酥小餅',price:25,image:'',active:true}],
 orders:[],members:[],
 store:{accepting:true,enabled:false,gift:'保冰袋 1 個',threshold:300,start:'',end:''}
};
function localError(message,status=400){
 return Object.assign(new Error(message),{status});
}
function saveDemo(data){
 try{localStorage.setItem(demoKey,JSON.stringify(data));}
 catch{throw localError('無法儲存。請確認瀏覽器允許本機儲存，或改用較小的圖片。');}
}
async function api(path,data){
 const state=JSON.parse(localStorage.getItem(demoKey)||'null')||structuredClone(defaultDemo);
 const {catalog,orders,members,store}=state;
 const shippingFee=store.shippingFee??0,freeShipping=store.freeShipping??null;
 const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const promotion=store.enabled&&today>=store.start&&today<=store.end?{gift:store.gift,threshold:store.threshold}:null;
 if(path==='product')return {catalog:catalog.filter(product=>product.active),promotion,shippingFee,freeShipping,accepting:store.accepting};
 if(path==='admin/catalog')return catalog;
 if(path==='admin')return {orders,members};
 if(path==='history'){
  const member=members.find(item=>item.lineId===data?.lineId);
  return {member:member?{name:member.name,phone:member.phone}:null,orders:member?orders.filter(order=>order.memberLineId===member.lineId):[]};
 }
 if(path==='admin/store'){
  if(!data)return {...store,shippingFee,freeShipping};
  const fee=Number(data.shippingFee),free=data.freeShipping===''?null:Number(data.freeShipping);
  if(data.shippingFee===''||!Number.isSafeInteger(fee)||fee<0||fee>100000||(free!==null&&(!Number.isSafeInteger(free)||free<1||free>99999999)))throw localError('請確認運費和免運門檻。');
  const gift=data.gift.trim(),threshold=Number(data.threshold),enabled=data.enabled==='on';
  if(!gift||!Number.isSafeInteger(threshold)||threshold<1)throw localError('請確認贈品與門檻。');
  if((enabled||data.start||data.end)&&(!data.start||!data.end||data.start>data.end))throw localError('請確認活動起訖日期。');
  state.store={shippingFee:fee,freeShipping:free,gift,threshold,enabled,start:data.start,end:data.end,accepting:data.accepting==='on'};
  saveDemo(state);return state.store;
 }
 if(path==='admin/product'){
  const name=data.name.trim(),price=Number(data.price),old=catalog.find(product=>product.id===data.id);
  if(!name||name.length>60||!Number.isInteger(price)||price<1||price>100000)throw localError('請確認品名與單價。');
  const product={id:old?.id||crypto.randomUUID(),name,price,image:data.image,active:data.active==='on'};
  if(old)catalog[catalog.indexOf(old)]=product;
  else catalog.push(product);
  saveDemo(state);return product;
 }
 if(path==='admin/update'){
  const order=orders.find(item=>item.id===data.id);
  if(!order)throw localError('查無訂單。');
  if(typeof data.paid==='boolean')order.paid=data.paid;
  else{
   const next=order.status==='待確認'?['已確認','已取消']:order.status==='已確認'?[order.delivery==='ship'?'已出貨':'已取貨']:[];
   if(!next.includes(data.status))throw localError('請依目前訂單狀態操作。',409);
   order.status=data.status;
  }
  saveDemo(state);return {ok:true};
 }
 if(path==='lookup')return {order:orders.find(o=>o.id===data.id.trim().toUpperCase()&&o.phone===data.phone)||null};
 if(!store.accepting)throw localError('目前暫停接單與會員登記。',503);
 const buyer=data.buyer.trim(),phone=data.phone,date=new Date().toISOString();
 if(!buyer||!/^\d{8,10}$/.test(phone))throw localError('請確認姓名和電話。');
 if(path==='member'){
  if(!/^09[0-9]{8}$/.test(phone))throw localError('請輸入 09 開頭的 10 碼手機號碼。');
  if(!/^demo-line-[a-f0-9-]{36}$/.test(data.lineId||''))throw localError('請先綁定 LINE 測試帳號。');
  if(members.some(member=>member.lineId===data.lineId))return {created:false};
  if(members.some(member=>member.phone===phone))throw localError('此手機已綁定另一個 LINE 測試帳號。');
  members.push({name:buyer,phone,lineId:data.lineId,date});
  saveDemo(state);return {created:true};
 }
 const product=catalog.find(item=>item.id===data.productId&&item.active);
 if(!product||product.name!==data.productName||product.price!==data.unitPrice||data.promotion!==JSON.stringify(promotion))throw localError('商品或活動已更新，請確認後重新送出。',409);
 const qty=Number(data.qty),delivery=data.delivery;
 if(!Number.isInteger(qty)||qty<1||qty>999||!['pickup','ship'].includes(delivery))throw localError('請確認張數及取貨方式。');
 if(delivery==='ship'&&(!data.receiver?.trim()||!data.address?.trim()))throw localError('請填寫收件人和地址。');
 const subtotal=qty*product.price;
 const freight=delivery==='ship'&&(freeShipping===null||subtotal<freeShipping)?shippingFee:0;
 if(data.freight!==freight)throw localError('宅配運費已更新，請確認新金額後再送出。',409);

 const order={id:'SC-'+crypto.randomUUID().slice(0,12).toUpperCase(),buyer,phone,date,qty,delivery,subtotal,freight,total:subtotal+freight,
  productName:product.name,unitPrice:product.price,gift:promotion&&subtotal>=promotion.threshold?promotion.gift:'',
  status:'待確認',paid:false,note:data.note?.trim(),receiver:data.receiver?.trim(),address:data.address?.trim()};
 const member=members.find(item=>item.lineId===data.lineId);
 if(member)order.memberLineId=member.lineId;
 orders.unshift(order);
 saveDemo(state);return order;
}
