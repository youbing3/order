import {accessToken} from './identity.js';
function encode(v){
 if(v===null)return {nullValue:null};
 if(typeof v==='string')return {stringValue:v};
 if(typeof v==='boolean')return {booleanValue:v};
 if(Number.isSafeInteger(v))return {integerValue:String(v)};
 throw new Error('Unsupported Firestore field');
}
function document(data){
 return {fields:Object.fromEntries(Object.entries(data).map(([k,v])=>[k,encode(v)]))};
}
function snapshot(doc){
 return {id:doc?.name.split('/').at(-1),exists:Boolean(doc),data:()=>doc?Object.fromEntries(Object.entries(doc.fields||{}).map(([k,v])=>[k,'integerValue'in v?Number(v.integerValue):Object.values(v)[0]])):undefined};
}
export function firestore(env){
 const base='projects/'+env.FIREBASE_PROJECT+'/databases/(default)/documents';
 async function send(path,body,missing=false){
  const result=await fetch('https://firestore.googleapis.com/v1/'+base+path,{
   method:body?'POST':'GET',headers:{Authorization:'Bearer '+await accessToken(env),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined
  });
  if(missing&&result.status===404)return null;
  const data=await result.json();
  if(!result.ok){const error=new Error('Firestore request failed: '+data.error?.status);error.status=data.error?.status;throw error;}
  return data;
 }
 const write=(ref,data,mode)=>({
  update:{name:base+'/'+ref.path,...document(data)},
  ...(mode==='create'?{currentDocument:{exists:false}}:mode==='update'?{currentDocument:{exists:true},updateMask:{fieldPaths:Object.keys(data)}}:{})
 });
 const commit=(writes,transaction)=>send(':commit',{writes,...(transaction?{transaction}:{})});
 function doc(path){
  return {path,get:async()=>snapshot(await send('/'+path,undefined,true)),
   create:data=>commit([write({path},data,'create')]),set:data=>commit([write({path},data,'set')])};
 }
 function collection(id,query={}){
  return {
   doc:key=>doc(id+'/'+key),
   where:(fieldPath,op,value)=>collection(id,{...query,where:{fieldFilter:{field:{fieldPath},op:op==='=='?'EQUAL':'GREATER_THAN_OR_EQUAL',value:encode(value)}}}),
   orderBy:(fieldPath,direction)=>collection(id,{...query,orderBy:[{field:{fieldPath},direction:direction==='desc'?'DESCENDING':'ASCENDING'}]}),
   get:async()=>({docs:(await send(':runQuery',{structuredQuery:{from:[{collectionId:id}],...query}})).filter(x=>x.document).map(x=>snapshot(x.document))})
  };
 }
 async function runTransaction(fn){
  for(let i=0;i<4;i++){
   const {transaction}=await send(':beginTransaction',{options:{readWrite:{}}});
   const writes=[];
   const tx={
    get:async ref=>snapshot((await send(':batchGet',{documents:[base+'/'+ref.path],transaction}))[0]?.found),
    create:(ref,data)=>writes.push(write(ref,data,'create')),
    update:(ref,data)=>writes.push(write(ref,data,'update'))
   };
   try{const result=await fn(tx);await commit(writes,transaction);return result;}
   catch(error){
    await send(':rollback',{transaction}).catch(()=>{});
    if(error.status!=='ABORTED'||i===3)throw error;
   }
  }
 }
 return {doc,collection,runTransaction};
}
