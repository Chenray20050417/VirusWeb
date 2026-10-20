Stomach GO V2 — 投票計數原型（尚未啟用 MVP / 自動回合 / Unity 干擾）

1. 先備份 F:\VirusWeb\public。將 index.html、style.css、profile.css、vote-app.js 放入 public（取代同名 index.html/style.css）。此版取代舊 app.js 的載入，但不需要刪除舊 app.js。保留 assets/ tilt.js/ screen.*。
2. 注意：不再載入 profile.js，註冊已整合於 vote-app.js。
3. StomachVoteHost.cs 放入 Unity Assets/Scripts，掛在 StomachRoundSystem，與原 StomachRoundManager 同個物件。
4. 先停止 Unity；刪除 Firebase 先前殘留的 rooms/ab123/voteRequests 測試資料（若有），並確定 currentRound.phase = IDLE、endsAt = 0。
5. Unity Play，兩支手機打開首頁，選頭貼與名字，Unity 按 T：WAITING 20 秒 -> VOTING 20 秒 -> IDLE。只有 VOTING 能點擊。投票開始後加入的玩家不會計入這一輪。
6. Firebase 應新增 currentRound/totals 及 currentRound/playerVotes/{visitorID}；screen.html 票數同步增加。
7. 網頁改後 CMD: cd /d F:\VirusWeb && firebase deploy --only hosting。Unity 編輯器更動無須 Hosting 部署。

安全限制：這是展場開發原型。因為使用 localStorage 產生的 visitorID 並不是受驗證的身分，惡意使用者可以偽造 ID 或請求、灌票。RTDB 規則目前未驗證，不能宣稱真正防作弊。正式公開前需 Firebase Auth + 完整規則/主機權限與重播防護。此原型主機僅以本地時鐘判定，亦需要時間校正。只允許一個 StomachVoteHost 運作。
重啟注意：目前 Unity StomachRoundManager 還是單輪測試，停在中途會殘留 phase；請停機再手動重設 IDLE。
