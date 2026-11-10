import {buildApi,HttpsError} from './api.js';
import {firestore} from './firestore.js';
import {verifyAuth} from './identity.js';

const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
export default {
 async fetch(request,env){
  const url=new URL(request.url);
  if(!url.pathname.startsWith('/api/'))return env.ASSETS.fetch(request);
  if(request.method!=='POST'||request.headers.get('Origin')!==url.origin)return json({code:'permission-denied',message:'請從本站操作。'},403);
  const endpoint=url.pathname==='/api/lineLogin'?'lineLogin':url.pathname==='/api/storeApi'?'storeApi':null;
  if(!endpoint)return json({code:'not-found',message:'找不到功能。'},404);
  try{
   const raw=await request.text();
   if(raw.length>720000)return json({code:'invalid-argument',message:'資料太大。'},413);
   let data;
   try{data=JSON.parse(raw);}catch{return json({code:'invalid-argument',message:'資料格式錯誤。'},400);}
   if(raw.length>370000&&(endpoint!=='storeApi'||data?.path!=='admin/product'))return json({code:'invalid-argument',message:'資料太大。'},413);
   const header=request.headers.get('Authorization'),auth=await verifyAuth(header,env.FIREBASE_PROJECT);
   if(header&&!auth)return json({code:'unauthenticated',message:'請重新登入。'},401);
   const result=await buildApi(firestore(env),env)[endpoint]({data,auth});
   return json({data:result});
  }catch(error){
   if(error instanceof HttpsError){
    const statuses={'unauthenticated':401,'permission-denied':403,'not-found':404,'failed-precondition':409,'unavailable':503};
    return json({code:error.code,message:error.message},statuses[error.code]||400);
   }
   console.error('Worker request failed',endpoint,error.message);
   return json({code:'internal',message:'伺服器暫時無法完成操作。'},500);
  }
 }
};
