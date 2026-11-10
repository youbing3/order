const encoder=new TextEncoder();
const b64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const decode=value=>Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
const json=value=>JSON.parse(new TextDecoder().decode(decode(value)));
const algorithm={name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'};
let keys,keysExpiry=0;
let cachedAccess;
async function signed(env,claims){
 const account=JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
 if(account.project_id!==env.FIREBASE_PROJECT)throw new Error('Service account project mismatch');
 const pem=account.private_key.replace(/-----[^-]+-----|\s/g,'');
 const key=await crypto.subtle.importKey('pkcs8',decode(pem),algorithm,false,['sign']);
 const now=Math.floor(Date.now()/1000);
 const jwt=[{alg:'RS256',typ:'JWT',kid:account.private_key_id},{iss:account.client_email,iat:now,exp:now+3600,...claims(account.client_email)}]
  .map(value=>b64(encoder.encode(JSON.stringify(value)))).join('.');
 return jwt+'.'+b64(await crypto.subtle.sign(algorithm.name,key,encoder.encode(jwt)));
}
export function customToken(env,uid){
 return signed(env,email=>({sub:email,aud:'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',uid,claims:{lineMember:true}}));
}
export async function accessToken(env){
 if(cachedAccess?.project===env.FIREBASE_PROJECT&&cachedAccess.expires>Date.now()+60000)return cachedAccess.token;
 const url='https://oauth2.googleapis.com/token';
 const assertion=await signed(env,()=>({aud:url,scope:'https://www.googleapis.com/auth/datastore'}));
 const response=await fetch(url,{method:'POST',body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion})});
 if(!response.ok)throw new Error('Firestore OAuth exchange failed');
 const data=await response.json();
 cachedAccess={project:env.FIREBASE_PROJECT,token:data.access_token,expires:Date.now()+data.expires_in*1000};
 return cachedAccess.token;
}
export async function verifyAuth(header,project){
 if(!header)return undefined;
 const token=/^Bearer ([\w.-]{1,8192})$/.exec(header)?.[1];
 if(!token)return undefined;
 const parts=token.split('.');
 if(parts.length!==3)return undefined;
 try{
  const head=json(parts[0]),claims=json(parts[1]),now=Date.now()/1000;
  if(head.alg!=='RS256'||!head.kid||claims.aud!==project||claims.iss!=='https://securetoken.google.com/'+project||
    !Number.isFinite(claims.exp)||claims.exp<=now||!Number.isFinite(claims.iat)||claims.iat>now+30||
    !Number.isFinite(claims.auth_time)||claims.auth_time>now+30||typeof claims.sub!=='string'||!claims.sub||claims.sub.length>128||claims.sub.includes('/'))return undefined;
  if(!keys||Date.now()>=keysExpiry){
   const res=await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
   if(!res.ok)throw new Error('Firebase signing keys unavailable');
   keys=(await res.json()).keys;
   keysExpiry=Date.now()+Number(/max-age=(\d+)/.exec(res.headers.get('cache-control')||'')?.[1]||60)*1000;
  }
  const jwk=keys.find(key=>key.kid===head.kid);
  if(!jwk)return undefined;
  const key=await crypto.subtle.importKey('jwk',jwk,algorithm,false,['verify']);
  if(await crypto.subtle.verify(algorithm.name,key,decode(parts[2]),encoder.encode(parts.slice(0,2).join('.'))))return {uid:claims.sub,token:claims};
 }catch{return undefined;}
}
