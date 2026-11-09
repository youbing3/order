# GitHub Pages 測試版
1. 確認 LINE LIFF 2012513126-ADVRyiPl 的 Endpoint URL 是 https://youbing3.github.io/order/，Scope 包含 openid。
2. 在 GitHub youbing3/order 的 main 分支覆蓋 docs/remote.js。Pages 維持 main /docs。
3. 在 Firebase Authentication 確認已授權 youbing3.github.io。Firebase 專案需有 Firestore 和 Blaze。
4. 在本資料夾用電腦終端機執行：
   npx firebase-tools login
   npx firebase-tools deploy --only functions,firestore:rules --project youbing-46daa
5. 用 https://liff.line.me/2012513126-ADVRyiPl 測試登入。若仍顯示 internal，查看 Firebase Functions 同時間的 lineLogin / storeApi 日誌。
6. GitHub Pages 僅用於測試。測試時請用測試個資。

## 管理員帳號

1. Firebase Authentication → 登入方式 → 啟用電子郵件／密碼。
2. 在 Authentication → 使用者，為每位管理員新增各自的 Email 與密碼，並複製其 UID。
3. 在 Firestore 建立 admins 集合，文件 ID 填該使用者的 UID，新增 active 欄位，型別 Boolean，值 true。原管理員也要新增。
4. 第一次登入時，系統會寄信。點驗證連結後，再回後台登入。
5. 停用管理員：把對應文件的 active 設為 false。後續管理 API 將拒絕該帳號。

## 更新部署

先建立至少一位管理員的 admins 文件，再部署新版 Functions，最後同步上傳 docs/admin/index.html 和 docs/remote.js。
更新後，請重新登入後台。「登入裝置」會列出近期活動的管理工作階段及 Email。
踢下線只撤銷該工作階段。要阻止帳號再次登入，請停用其管理權限。
