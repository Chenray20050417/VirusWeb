# 胃液遮擋：網頁與 Unity 指令約定

網頁第二個按鈕 `acidButton` 會寫入 Firebase Realtime Database：

路徑：`rooms/ab123/commands/{自動產生的指令 ID}`

```json
{
  "type": "OBSCURE_VISION",
  "amount": 1,
  "sessionId": "Unity 當前連線場次編號",
  "time": 1790000000000
}
```

`time` 為發送當下的 Unix 毫秒時間，以上數值僅為格式範例。
目前由 Firebase 伺服器產生 `time`；`sessionId` 必須符合 Unity 當前場次，否則略過指令。
`amount: 1` 表示觸發一次效果；不是遮擋持續秒數。
網頁按鈕冷卻暫設 5 秒，與 Unity 中的遮擋持續時間分開處理。

## Unity 接入狀態

已修改 `F:/map/Assets/script/FirebaseTest.cs` 的 `ExecuteCommand()`：收到
`OBSCURE_VISION` 後，呼叫 `StomachAcidEffect.PlayEffect()`，與 R 鍵共用效果。
可在 Inspector 指定 `stomachAcidEffect`；未指定時自動尋找場景中的啟用元件。
既有 `ChildAdded` 訂閱、主執行緒佇列、指令去重與完成後刪除流程繼續使用。

## 指令處理約定

1. 使用既有 Firebase 讀取流程取得新增指令。
2. 當 `type` 為 `OBSCURE_VISION`，呼叫目前 R 鍵使用的胃液遮擋效果函式。
3. 以指令 ID 去重，避免定時讀取時重複執行同一筆指令。
4. 明確決定遊戲啟動時是否略過舊指令，避免重播先前的效果。

請共用 R 鍵呼叫的效果函式，無須模擬鍵盤按鍵。
已使用 Unity／Firebase 程式庫完成編譯檢查；Unity Play Mode 與手機實機效果尚未驗證。
網頁「指令發送成功」代表 Firebase 寫入成功，尚不表示 Unity 已執行效果。
