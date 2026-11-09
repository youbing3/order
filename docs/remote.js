const connection=(async()=>{
 const [core,authSdk,fn]=await Promise.all([
  import('https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js'),
  import('https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js'),
  import('https://www.gstatic.com/firebasejs/13.2.0/firebase-functions.js')
 ]);
 const app=core.initializeApp(websiteConfig.firebase,document.getElementById('loginAdmin')?'store-admin':'store-shop');
 const auth=authSdk.getAuth(app);
 await auth.authStateReady();
 const functions=fn.getFunctions(app,'asia-east1');
 return {auth,authSdk,call:fn.httpsCallable(functions,'storeApi'),exchange:fn.httpsCallable(functions,'lineLogin')};
})();
async function api(path,body){
 try{return (await (await connection).call({path,...(body?{body}:{})})).data;}
 catch(error){
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
  if(interactive)liff.login({redirectUri:'https://youbing3.github.io/order/'});
  return false;
 }
 const idToken=liff.getIDToken();
 if(!idToken)throw new Error('無法取得 LINE 身分，請確認 LIFF 已勾選 openid。');
 const result=await exchange({idToken});
 await authSdk.signInWithCustomToken(auth,result.data.token);
 return true;
}
async function adminLogin(){
 const {auth,authSdk}=await connection;
 await authSdk.signInWithPopup(auth,new authSdk.GoogleAuthProvider());
 location.reload();
}
async function adminLogout(){
 const {auth,authSdk}=await connection;
 await authSdk.signOut(auth);
 location.reload();
}
