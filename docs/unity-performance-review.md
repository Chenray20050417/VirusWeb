# Unity 效能檢查

檢查範圍：`F:/map/Assets/script`、`throat to esophagus(level1).unity` 場景設定與 Unity Editor 日誌。
此次為程式／設定檢查，未取得 Profiler 錄製，不能判定實際 FPS、CPU/GPU 毫秒數或記憶體尖峰。
此次未修改 Unity 遊戲程式或降低視覺品質。

## 優先處理項目

| 優先度 | 發現與依據 | 風險 | 建議 |
|---|---|---|---|
| 高 | 絨毛生成器設定 123 個；每次回收在同一個 Update 中清除並重新 Instantiate | 地圖接縫處可能出現單幀 CPU 尖峰 | 物件池重用絨毛，或在玩家到達前分幀配置 |
| 高 | StomachPlantSpawner 每次射線用 RaycastAll，最多 plantCount × 20，即 2,460 次嘗試 | 結果陣列配置、物理查詢與垃圾回收；2,460 是上限，非每次實際次數 | 重用查詢緩衝；保留胃壁篩選與溢位處理，不要直接改成只取第一個碰撞 |
| 高 | 胃液設定 dropCount=12、splashCount=12、stainCount=50 | 完整播放總計約 218 個新 UI 物件：12 液柱＋12 液珠＋144 噴濺＋50 沾染；不是同時存在 218 個 | 將 UI 物件池化，限制沾染同時存在數，獨立特效 Canvas |
| 高 | 50 張沾染大小均為 600，停留 10 秒、淡出 3 秒，且每幀變更 alpha／位置 | 大片透明 UI 重疊繪製與 Canvas 更新，GPU／UI CPU 成本待實測 | 檢查 UI 與 GPU Profiler；先測較少沾染做對照，確認後再決定畫面取捨 |
| 中 | VirusChase 只有碰到 Player 才 Destroy；沒有壽命／最大存量限制 | 玩家比病毒快或碰撞未發生時，病毒可能累積，每個都有 Update 與碰撞 | 加入最大存量、距離／壽命回收，並用物件池 |
| 中 | 病毒生成、碰撞及 Firebase 各階段有大量 Debug.Log | 多人操作時 Editor Console 與呼叫堆疊可能增加成本 | 成功訊息用可關閉的除錯旗標，保留錯誤訊息 |
| 待量測 | 胃壁蠕動每幀改動 Transform；絨毛附著其下，可能包含 MeshCollider | 物理同步／渲染成本可能受子物件數量影響 | 用 Physics Profiler 確認；純裝飾絨毛可不配置碰撞元件 |

## 較不需優先改動

- Firebase 指令有佇列與每幀處理上限，不是每幀下載整份資料庫。
- 遊戲在線心跳是每 5 秒一筆 HTTP PUT，頻率遠低於逐幀處理。
- 新增的隨機生成僅在地圖回收時執行，但全部工作集中在同一幀；需要關注尖峰而非平均耗時。

## 實測流程

在 Unity 的 `Window > Analysis > Profiler` 開啟 CPU Usage、Rendering、Memory、UI；GPU 模組視平台支援啟用。
第一輪關閉 Deep Profile，避免其額外成本干擾基準。

1. 固定解析度與品質，正常前進一段時間，記錄基準幀時間。
2. 跑過 A 段回收至少三次，檢查尖峰中的 Instantiate、Destroy、Physics 查詢與 GC.Alloc。
3. 分別觸發一次胃液與冷卻後再次觸發，觀察 UI 更新、GC.Alloc、GPU 與物件數。
4. 多次生成病毒並繼續前進，檢查病毒數量與記憶體是否持續上升。
5. 以相同條件錄製 Development Build 作對照，避免將 Editor 額外成本誤當成遊戲成本。

60 FPS 的單幀時間預算約 16.7 ms，30 FPS 約 33.3 ms；這是目標預算，並非本次測得數值。

## 官方參考

- [Unity CPU Usage Profiler](https://docs.unity3d.com/cn/2023.2/Manual/ProfilerCPU.html)
- [Unity 物件池與重用](https://docs.unity.com/en-us/engine/6000.0/manual/analysis/performance-memory/managed-memory/optimizing-code-managed-memory/reusable-code)
