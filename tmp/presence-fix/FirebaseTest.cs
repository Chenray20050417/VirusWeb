using UnityEngine;
using Firebase;
using Firebase.Database;
using Firebase.Extensions;
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Collections;
using UnityEngine.Networking;

public class FirebaseCommandManager : MonoBehaviour
{
    // =========================================================
    // Firebase
    // =========================================================

    private DatabaseReference commandsRef;

    private bool isListening = false;
    private DatabaseReference gameStatusRef;
    private string gameSessionId;
    private bool hostConnected;
    private bool shuttingDown;
    private Coroutine presenceRoutine;


    [Header("Firebase 房間設定")]

    [Tooltip("目前遊戲房間 ID")]
    public string roomId = "ab123";


    // =========================================================
    // 病毒
    // =========================================================

    [Header("病毒設定")]
    public GameObject virusPrefab;


    [Header("玩家")]
    public Transform player;

    [Header("胃液遮擋")]
    [Tooltip("與 R 鍵共用的胃液效果；未指定時自動尋找場景中的啟用元件")]
    public StomachAcidEffect stomachAcidEffect;


    // =========================================================
    // 病毒生成安全設定
    // =========================================================

    [Header("病毒安全生成設定")]

    [Tooltip("病毒生成在玩家前方多遠")]
    public float spawnDistance = 6f;

    [Tooltip("病毒生成高度，可正負調整")]
    public float spawnHeightOffset = 1f;

    [Tooltip("離玩家最近可以生成的位置")]
    public float minimumSpawnDistance = 2f;

    [Tooltip("病毒碰撞體積，用來避免生成進牆壁")]
    public float virusRadius = 0.6f;

    [Tooltip("病毒與牆壁至少保持多少距離")]
    public float wallClearance = 0.8f;


    [Header("環境 Layer")]
    public LayerMask environmentMask;


    // =========================================================
    // Firebase 防爆量 / 防洗指令設定
    // =========================================================

    [Header("Firebase 安全限制")]

    [Tooltip("一個畫面 Frame 最多處理幾個 Firebase 指令")]
    public int maxCommandsPerFrame = 3;

    [Tooltip("一次指令允許的最大 amount")]
    public int maxCommandAmount = 10;

    [Tooltip("同類病毒指令最短間隔，防止大量病毒瞬間生成")]
    public float virusCommandCooldown = 0.2f;


    private float lastVirusCommandTime = -999f;


    // =========================================================
    // Command Queue
    // =========================================================

    private ConcurrentQueue<GameCommand> commandQueue =
        new ConcurrentQueue<GameCommand>();


    // 防止同一個 Firebase Key 被重複處理
    private HashSet<string> processingCommandKeys =
        new HashSet<string>();


    public class GameCommand
    {
        public string key;
        public string type;
        public int amount;
        public string sessionId;
    }


    // =========================================================
    // Start
    // =========================================================

    void Start()
    {
        Debug.Log("【Firebase】開始初始化");

        FirebaseApp.CheckAndFixDependenciesAsync()
            .ContinueWithOnMainThread(task =>
            {
                if (this == null || shuttingDown) return;
                if (task.Result == DependencyStatus.Available)
                {
                    Debug.Log("【Firebase】初始化成功");

                    StartListening();
                }
                else
                {
                    Debug.LogError(
                        "【Firebase】初始化失敗：" +
                        task.Result
                    );
                }
            });
    }


    // =========================================================
    // Firebase 開始監聽
    // =========================================================

    void StartListening()
    {
        // 防止重複監聽
        if (isListening)
        {
            Debug.LogWarning(
                "【Firebase】已經正在監聽，不重複註冊"
            );

            return;
        }


        FirebaseDatabase database =
            FirebaseDatabase.GetInstance(
                "https://virusgame-c7baa-default-rtdb.firebaseio.com/"
            );


        commandsRef =
            database
            .GetReference("rooms")
            .Child(roomId)
            .Child("commands");


        commandsRef.ChildAdded += OnCommandAdded;

        isListening = true;

        gameStatusRef = database.GetReference("rooms").Child(roomId).Child("gameStatus");
        gameSessionId = Guid.NewGuid().ToString("N");
        presenceRoutine = StartCoroutine(PublishGamePresence());


        Debug.Log(
            "【Firebase】開始監聽 rooms/" +
            roomId +
            "/commands"
        );
    }


    // =========================================================
    // 收到 Firebase Command
    // =========================================================

    IEnumerator PublishGamePresence()
    {
        string statusUrl = "https://virusgame-c7baa-default-rtdb.firebaseio.com/rooms/" +
            Uri.EscapeDataString(roomId) + "/gameStatus.json";
        while (!shuttingDown)
        {
            // REST acknowledges the server write, avoiding desktop SDK connection-event gating.
            string json = "{\"sessionId\":\"" + gameSessionId +
                "\",\"lastSeen\":{\".sv\":\"timestamp\"}}";
            using (var request = new UnityWebRequest(statusUrl, "PUT"))
            {
                request.uploadHandler = new UploadHandlerRaw(System.Text.Encoding.UTF8.GetBytes(json));
                request.downloadHandler = new DownloadHandlerBuffer();
                request.SetRequestHeader("Content-Type", "application/json");
                request.timeout = 5;
                yield return request.SendWebRequest();
                if (shuttingDown) yield break;
                if (request.result == UnityWebRequest.Result.Success)
                {
                    if (!hostConnected) Debug.Log("【Firebase】遊戲在線狀態回報成功，手機按鈕可啟用");
                    hostConnected = true;
                }
                else
                {
                    hostConnected = false;
                    // Rotate the session after a failed write so delayed commands cannot replay.
                    gameSessionId = Guid.NewGuid().ToString("N");
                    Debug.LogWarning("【Firebase】遊戲在線狀態回報失敗（HTTP " + request.responseCode +
                        "）：" + request.error + "；" + request.downloadHandler.text);
                }
            }
            // Continue publishing even if gameplay Time.timeScale is zero.
            yield return new WaitForSecondsRealtime(5f);
        }
    }

    void OnCommandAdded(
        object sender,
        ChildChangedEventArgs args)
    {
        if (args.DatabaseError != null)
        {
            Debug.LogError(
                "【Firebase】錯誤：" +
                args.DatabaseError.Message
            );

            return;
        }


        DataSnapshot snapshot = args.Snapshot;


        if (snapshot == null)
        {
            return;
        }


        if (!snapshot.Exists)
        {
            return;
        }


        string commandKey = snapshot.Key;


        if (string.IsNullOrEmpty(commandKey))
        {
            return;
        }


        // =====================================================
        // 防止重複 Command
        // =====================================================

        string commandSession = snapshot.HasChild("sessionId")
            ? snapshot.Child("sessionId").Value as string : null;
        if (!hostConnected || string.IsNullOrEmpty(gameSessionId) || commandSession != gameSessionId)
        {
            Debug.Log("【Firebase】略過啟動前或離線期間的舊指令：" + commandKey);
            DeleteCommand(commandKey);
            return;
        }

        if (processingCommandKeys.Contains(commandKey))
        {
            Debug.LogWarning(
                "【Firebase】忽略重複指令：" +
                commandKey
            );

            return;
        }


        // =====================================================
        // 檢查 type
        // =====================================================

        if (!snapshot.HasChild("type"))
        {
            Debug.LogWarning(
                "【Firebase】收到資料，但沒有 type"
            );

            DeleteCommand(commandKey);

            return;
        }


        object typeValue =
            snapshot.Child("type").Value;


        if (typeValue == null)
        {
            DeleteCommand(commandKey);

            return;
        }


        string type =
            typeValue.ToString();


        // =====================================================
        // 讀取 amount
        // =====================================================

        int amount = 1;


        if (snapshot.HasChild("amount"))
        {
            try
            {
                amount =
                    Convert.ToInt32(
                        snapshot
                            .Child("amount")
                            .Value
                    );
            }
            catch
            {
                amount = 1;
            }
        }


        // amount 不准小於 1
        amount =
            Mathf.Max(
                1,
                amount
            );


        // amount 不准太大
        amount =
            Mathf.Min(
                amount,
                maxCommandAmount
            );


        // =====================================================
        // 建立 Command
        // =====================================================

        GameCommand command =
            new GameCommand();


        command.key =
            commandKey;

        command.type =
            type;

        command.amount =
            amount;
        command.sessionId = commandSession;


        // 記錄這個 Key 正在處理
        processingCommandKeys.Add(
            commandKey
        );


        // 放進 Unity Queue
        commandQueue.Enqueue(
            command
        );


        Debug.Log(
            "【Firebase】收到：" +
            type +
            "，amount：" +
            amount +
            "，key：" +
            commandKey
        );
    }


    // =========================================================
    // Update
    // =========================================================

    void Update()
    {
        // 注意：
        // Update 裡面沒有讀 Firebase！
        //
        // 只是處理 Firebase 已經送進 Queue 的資料。
        //
        // 所以這不會變成每幀下載 Firebase。


        int processedCount = 0;


        while (
            processedCount < maxCommandsPerFrame &&
            commandQueue.TryDequeue(
                out GameCommand command
            )
        )
        {
            ExecuteCommand(
                command
            );


            processedCount++;
        }
    }


    // =========================================================
    // 執行 Firebase Command
    // =========================================================

    void ExecuteCommand(
        GameCommand command)
    {
        if (command == null)
        {
            return;
        }

        if (!hostConnected || command.sessionId != gameSessionId)
        {
            DeleteCommand(command.key);
            return;
        }


        // =====================================================
        // ADD_VIRUS
        // =====================================================

        if (command.type == "ADD_VIRUS")
        {
            // ---------------------------------------------
            // 防止瞬間大量病毒
            // ---------------------------------------------

            if (
                Time.time -
                lastVirusCommandTime >=
                virusCommandCooldown
            )
            {
                /*
                 * 你目前的設計：
                 *
                 * 無論 Firebase amount 是多少，
                 * 一次 ADD_VIRUS 只生成 1 隻。
                 *
                 * 所以保持 SpawnVirus()。
                 */

                SpawnVirus();


                lastVirusCommandTime =
                    Time.time;
            }
            else
            {
                Debug.LogWarning(
                    "【Firebase】病毒指令過快，已略過：" +
                    command.key
                );
            }
        }


        // =====================================================
        // OBSCURE_VISION
        // =====================================================

        else if (command.type == "OBSCURE_VISION")
        {
            if (stomachAcidEffect == null)
            {
                stomachAcidEffect = FindObjectOfType<StomachAcidEffect>();
            }

            if (stomachAcidEffect != null && stomachAcidEffect.isActiveAndEnabled)
            {
                stomachAcidEffect.PlayEffect();
                Debug.Log("【Firebase】已呼叫胃液遮擋效果（與 R 鍵共用）");
            }
            else
            {
                Debug.LogError("【Firebase】找不到啟用的 StomachAcidEffect，請檢查場景或指定胃液效果元件");
            }
        }


        // =====================================================
        // GIVE_HP
        // =====================================================

        else if (
            command.type == "GIVE_HP"
        )
        {
            Debug.Log(
                "💊 收到補血指令，數量：" +
                command.amount
            );


            /*
             * 之後如果你有 PlayerHealth：
             *
             * PlayerHealth playerHealth =
             *     player.GetComponent<PlayerHealth>();
             *
             * if (playerHealth != null)
             * {
             *     playerHealth.Heal(
             *         command.amount
             *     );
             * }
             */
        }


        // =====================================================
        // 未知指令
        // =====================================================

        else
        {
            Debug.LogWarning(
                "【Firebase】未知指令：" +
                command.type
            );
        }


        // =====================================================
        // 指令完成 → Firebase 刪除
        // =====================================================

        DeleteCommand(
            command.key
        );
    }


    // =========================================================
    // 刪除 Firebase Command
    // =========================================================

    void DeleteCommand(
        string commandKey)
    {
        if (commandsRef == null)
        {
            RemoveProcessingKey(
                commandKey
            );

            return;
        }


        if (
            string.IsNullOrEmpty(
                commandKey
            )
        )
        {
            return;
        }


        commandsRef
            .Child(commandKey)
            .RemoveValueAsync()
            .ContinueWithOnMainThread(task =>
            {
                // 不管成功失敗，
                // Unity 本地都不能永久卡住這個 Key
                RemoveProcessingKey(
                    commandKey
                );


                if (task.IsCompletedSuccessfully)
                {
                    Debug.Log(
                        "【Firebase】指令已處理並刪除：" +
                        commandKey
                    );
                }

                else if (task.IsFaulted)
                {
                    Debug.LogError(
                        "【Firebase】刪除指令失敗：" +
                        commandKey
                    );


                    if (task.Exception != null)
                    {
                        Debug.LogError(
                            task.Exception
                                .ToString()
                        );
                    }
                }

                else if (task.IsCanceled)
                {
                    Debug.LogWarning(
                        "【Firebase】刪除指令被取消：" +
                        commandKey
                    );
                }
            });
    }


    // =========================================================
    // 移除正在處理中的 Key
    // =========================================================

    void RemoveProcessingKey(
        string commandKey)
    {
        if (
            string.IsNullOrEmpty(
                commandKey
            )
        )
        {
            return;
        }


        if (
            processingCommandKeys.Contains(
                commandKey
            )
        )
        {
            processingCommandKeys.Remove(
                commandKey
            );
        }
    }


    // =========================================================
    // 病毒生成
    // =========================================================

    void SpawnVirus()
    {
        if (virusPrefab == null)
        {
            Debug.LogError(
                "尚未設定 Virus Prefab"
            );

            return;
        }


        if (player == null)
        {
            Debug.LogError(
                "尚未設定 Player"
            );

            return;
        }


        // =====================================================
        // 病毒生成起點
        // =====================================================

        Vector3 origin =
            player.position +
            Vector3.up *
            spawnHeightOffset;


        // 玩家目前面對方向
        Vector3 direction =
            player.forward.normalized;


        float finalDistance =
            spawnDistance;


        RaycastHit hit;


        // =====================================================
        // SphereCast
        // 檢查玩家前方有沒有牆壁
        // =====================================================

        if (
            Physics.SphereCast(
                origin,
                virusRadius,
                direction,
                out hit,
                spawnDistance,
                environmentMask
            )
        )
        {
            Debug.Log(
                "【病毒生成】前方偵測到：" +
                hit.collider.name
            );


            finalDistance =
                hit.distance -
                virusRadius -
                wallClearance;


            /*
             * 注意：
             * Mathf.Max 代表至少 minimumSpawnDistance。
             */
            finalDistance =
                Mathf.Max(
                    finalDistance,
                    minimumSpawnDistance
                );
        }


        Vector3 spawnPosition =
            origin +
            direction *
            finalDistance;


        // =====================================================
        // 最後再 CheckSphere
        // =====================================================

        if (
            Physics.CheckSphere(
                spawnPosition,
                virusRadius,
                environmentMask
            )
        )
        {
            Debug.LogWarning(
                "【病毒生成】位置被阻擋，開始尋找安全位置"
            );


            bool foundSafePosition =
                false;


            /*
             * 從遠到近，
             * 每 0.5 公尺檢查一次。
             */
            for (
                float distance =
                    finalDistance;

                distance >=
                    minimumSpawnDistance;

                distance -=
                    0.5f
            )
            {
                Vector3 testPosition =
                    origin +
                    direction *
                    distance;


                bool blocked =
                    Physics.CheckSphere(
                        testPosition,
                        virusRadius,
                        environmentMask
                    );


                if (!blocked)
                {
                    spawnPosition =
                        testPosition;


                    foundSafePosition =
                        true;


                    break;
                }
            }


            if (!foundSafePosition)
            {
                Debug.LogWarning(
                    "【病毒生成】找不到安全位置，本次取消生成"
                );


                return;
            }
        }


        // =====================================================
        // Instantiate Virus
        // =====================================================

        GameObject newVirus =
            Instantiate(
                virusPrefab,
                spawnPosition,
                Quaternion.identity
            );


        // =====================================================
        // VirusChase
        // =====================================================

        VirusChase chase =
            newVirus.GetComponent<VirusChase>();


        if (chase != null)
        {
            chase.SetTarget(
                player
            );


            Debug.Log(
                "🦠 病毒追蹤目標設定完成：Player"
            );
        }

        else
        {
            Debug.LogWarning(
                "Virus Prefab 沒有掛 VirusChase.cs"
            );
        }


        Debug.Log(
            "🦠 病毒生成成功，位置：" +
            spawnPosition
        );
    }


    // =========================================================
    // GameObject Destroy
    // =========================================================

    void OnDestroy()
    {
        StopListening();
    }

    void OnApplicationQuit()
    {
        StopListening();
    }


    // =========================================================
    // 停止 Firebase Listener
    // =========================================================

    void StopListening()
    {
        if (shuttingDown) return;
        shuttingDown = true;
        hostConnected = false;
        gameSessionId = null;
        if (presenceRoutine != null) StopCoroutine(presenceRoutine);
        presenceRoutine = null;
        // Best effort for normal exits; heartbeat expiry handles crashes.
        if (gameStatusRef != null) gameStatusRef.RemoveValueAsync();
        if (
            commandsRef != null &&
            isListening
        )
        {
            commandsRef.ChildAdded -=
                OnCommandAdded;


            isListening =
                false;


            Debug.Log(
                "【Firebase】停止監聽"
            );
        }
    }


    // =========================================================
    // Scene 顯示病毒生成位置
    // =========================================================

    void OnDrawGizmosSelected()
    {
        if (player == null)
        {
            return;
        }


        Vector3 origin =
            player.position +
            Vector3.up *
            spawnHeightOffset;


        Vector3 direction =
            player.forward.normalized;


        Vector3 spawnPreview =
            origin +
            direction *
            spawnDistance;


        // 玩家到生成位置
        Gizmos.DrawLine(
            origin,
            spawnPreview
        );


        // 病毒生成範圍
        Gizmos.DrawWireSphere(
            spawnPreview,
            virusRadius
        );
    }
}
