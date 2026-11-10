const connection=(async()=>{
 const [core,authSdk]=await Promise.all([
  import('https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js'),
  import('https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js')
 ]);
 const app=core.initializeApp(websiteConfig.firebase,document.getElementById('loginAdmin')?'store-admin':'store-shop');
 const auth=authSdk.getAuth(app);
 await auth.authStateReady();
 async function request(endpoint,body){
  const headers={'Content-Type':'application/json'};
  if(endpoint==='storeApi'&&auth.currentUser)headers.Authorization='Bearer '+await auth.currentUser.getIdToken();
  const response=await fetch('/api/'+endpoint,{method:'POST',headers,body:JSON.stringify(body)});
  const result=await response.json();
  if(!response.ok)throw Object.assign(new Error(result.message),{code:'functions/'+result.code});
  return result;
 }
 return {auth,authSdk,call:body=>request('storeApi',body),exchange:body=>request('lineLogin',body)};
})();
async function api(path,body){
 try{return (await (await connection).call({path,...(body?{body}:{}),...(document.getElementById('loginAdmin')?{session:sessionStorage.getItem('store-admin-session')}:{})})).data;}
 catch(error){
  if((error.code==='functions/unauthenticated'||(error.code==='functions/permission-denied'&&path!=='admin/session/open'))&&document.getElementById('loginAdmin'))await adminLogout(false);
  error.status=error.code==='functions/failed-precondition'?409:error.code==='functions/unavailable'?503:400;
  throw error;
 }
}
let lineInit;
async function connectLine(interactive){
 if(!websiteConfig.liffId){
  if(interactive)throw new Error('會員登入尚未開通，請聯絡店家。');
  return false;
 }
 const {auth,authSdk,exchange}=await connection;
 lineInit??=window.liff.init({liffId:websiteConfig.liffId});
 await lineInit;
 if(!liff.isLoggedIn()){
  if(auth.currentUser)await authSdk.signOut(auth);
  if(interactive)liff.login({redirectUri:new URL('/',location.origin).href});
  return false;
 }
 const idToken=liff.getIDToken();
 if(!idToken)throw new Error('無法取得 LINE 身分，請確認 LIFF 已勾選 openid。');
 const result=await exchange({idToken});
 await authSdk.signInWithCustomToken(auth,result.data.token);
 return true;
}
async function adminLogin(email,password){
 const {auth,authSdk}=await connection;
 await authSdk.setPersistence(auth,authSdk.browserSessionPersistence);
 const result=await authSdk.signInWithEmailAndPassword(auth,email,password);
 await authSdk.reload(result.user);
 await result.user.getIdToken(true);
 if(!result.user.emailVerified){
  await authSdk.sendEmailVerification(result.user);
  await authSdk.signOut(auth);
  throw new Error('已寄出驗證信。請點信中的連結，再回來登入。');
 }
 let session;
 try{session=await api('admin/session/open',{device:navigator.userAgent.slice(0,180)});}
 catch(error){await authSdk.signOut(auth);throw error;}
 sessionStorage.setItem('store-admin-session',session.id);
 location.reload();
}
async function adminLogout(revoke=true){
 const {auth,authSdk}=await connection;
 if(revoke){const id=sessionStorage.getItem('store-admin-session');if(id)try{await api('admin/session/revoke',{id});}catch{}}
 sessionStorage.removeItem('store-admin-session');
 await authSdk.signOut(auth);
 location.reload();
}
