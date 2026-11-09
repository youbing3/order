# 蔥酥小餅｜部署包

這包使用 Firebase Hosting、Firebase Functions、Firestore 和 LINE。沒有本機模擬資料。接單預設關閉，商品需由後台新增。圖片隨商品文件儲存，支援壓縮後 350 KB 以內的資料 URI，這版不用另外建立 Storage。手機號碼僅驗證格式。

## 1. 部署 Firebase

1. 在 Firebase 專案 youbing-46daa 確認 Firestore Standard 的 (default) 和 Google 登入已啟用，已授權網域有 youbing-46daa.web.app。Cloud Functions 部署需要 Blaze。
2. 電腦安裝 Node.js 22。解壓縮後，在本 README 所在資料夾開啟終端機。
3. 執行：

```sh
npx firebase-tools login
npx firebase-tools deploy --only functions,firestore:rules,hosting --project youbing-46daa
```

部署規則會讓 Firestore 僅由伺服器存取。後台操作驗證 Google 登入提供者、已驗證 Email 和店家帳號。LINE 客戶須由伺服器驗證 ID Token，再登入 Firebase。兩個 Functions 都在 asia-east1。

若 LINE 登入時 Functions 日誌出現 iam.serviceAccounts.signBlob 權限錯誤，在 Google Cloud Console 的 IAM 查看函式實際執行的服務帳戶，對該服務帳戶授予自身 Service Account Token Creator 角色，並確認 IAM Service Account Credentials API 已啟用。不要建立或上傳私鑰 JSON。

## 2. 確認網站與管理後台

1. 客戶網址 https://youbing-46daa.web.app/ ，後台 https://youbing-46daa.web.app/admin/ 。
2. 在後台用 youbingcong3@gmail.com 登入，新增商品，設定運費及活動。商品需勾選上架。
3. GitHub repo 可以存放原始碼。GitHub Pages 不用於正式接單，既有試用頁可從 Settings → Pages 取消發布。

## 3. 填入 LIFF 並試單

1. LINE Developers 的 Channel 2012513126 → LIFF，Endpoint URL 用 https://youbing-46daa.web.app/ ，Scope 要勾 openid。
2. 部署包已填入 LIFF ID 2012513126-ADVRyiPl。部署後用 https://liff.line.me/2012513126-ADVRyiPl 測試。
3. 後台填好運費，於測試時開放接單。用 LIFF 網址試會員登記、下單、確認和出貨。再用第二個 LINE 帳號確認歷史訂單隔離。測試期間使用測試個資。
4. 對外提供前，將 LINE Login channel 發布，並在官方帳號圖文選單貼入 LIFF 網址。確認沒有測試商品與測試訂單後再正式開放。
