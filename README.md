# 蔥酥小餅 Cloudflare Workers 部署

網站和 API 放同一個 Worker，保留 Firebase 專案 youbing-46daa、現有 Firestore 資料和 Firebase Auth。這包不部署 Firebase Functions 或 Hosting。接單預設關閉；若現有 Firestore 已有設定，會沿用現有值。

## 1. 在 Google Cloud 準備 Worker 的身分

1. 在 Google Cloud Console 選 youbing-46daa。到 IAM 與管理 → 服務帳戶，為此 Worker 建立專用服務帳戶。
2. 在專案層授予該服務帳戶 Cloud Datastore User（roles/datastore.user），讓後端讀寫既有 Firestore。
3. 為這個服務帳戶建立一把 JSON 金鑰，留在自己電腦且放在此專案資料夾之外。若組織禁止建立金鑰，先停止此步驟，改用組織允許的身分方案。
4. 保留正式模式 Firestore 規則，禁止未授權的客戶直接存取。Worker 使用服務帳戶，管理 API 另外檢查已驗證的 Email＋密碼登入、admins/{UID} 的 active 欄位以及登入工作階段。

## 2. 部署到自己的 Cloudflare 帳號

在看得到 wrangler.jsonc 的資料夾開啟終端機，安裝 Node.js 22 後執行：

```sh
npm install
npx wrangler login
npm run deploy
```

部署會顯示自己的 workers.dev 網址。接著在同一資料夾用 Windows 命令提示字元（cmd）執行，將路徑替換為你實際下載的金鑰檔：

```bat
npx wrangler secret put FIREBASE_SERVICE_ACCOUNT < "C:\path\firebase-service-account.json"
```

等設定完成再測試。金鑰不要上傳 GitHub、貼到對話、加入 public 或寫入 wrangler.jsonc。若已外流，請到服務帳戶的金鑰頁撤銷該金鑰。

## 3. 對齊登入網址

- Firebase Authentication → Settings → Authorized domains 加入 Worker 網域，只填主機名稱。
- LINE Developers → LIFF → 2012513126-ADVRyiPl，Endpoint URL 填 Worker 網址（包含最後的 /）。Scope 選 openid。
- 管理頁在 Worker 網址的 /admin/，沿用 Firebase Email＋密碼登入。每個管理員要有已驗證的 Firebase 帳號，以及 Firestore admins/{UID} 文件的 active: true（Boolean）。
- 客戶從 https://liff.line.me/2012513126-ADVRyiPl 開啟。測試 LINE 綁定、下單、後台確認和踢下線。所有測試完成後再對外使用。
- 若 Worker 回報伺服器錯誤，可在專案資料夾執行 npx wrangler tail，重新操作一次，查對應錯誤。請勿分享金鑰或登入權杖。

此版本以 Workers Free 與 Firestore 免費額度為目標。未部署至你的帳號，正式端到端流程需實際部署後驗證。
