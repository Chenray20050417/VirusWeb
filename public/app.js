
import { initializeApp } from
"https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";

import {
    getDatabase,
    ref,
    push,
    set,
    update,
    remove,
    onDisconnect,
    onValue,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js";

import {
    getAuth,
    signInAnonymously
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

// ======================================================
// 1. Firebase 設定
// ======================================================

import { firebaseConfig } from "./firebase-config.js";





const app = initializeApp(firebaseConfig);
const database = getDatabase(app);
const auth = getAuth(app);

// ======================================================
// 2. 遊戲房間及 Firebase 路徑
// ======================================================

const roomID = "ab123";

const commandsRef = ref(
    database,
    `rooms/${roomID}/commands`
);

const participantsRef = ref(
    database,
    `rooms/${roomID}/participants`
);

const gameStatusRef = ref(
    database,
    `rooms/${roomID}/gameStatus`
);

// ======================================================
// 3. HTML 元件
// ======================================================

const virusButton = document.getElementById("virusButton");
const acidButton = document.getElementById("acidButton");
const message = document.getElementById("message");
const participantCount = document.getElementById("participantCount");
const gameStatusElement = document.getElementById("gameStatus");

if (!virusButton) {
    console.warn("找不到 virusButton");
}

if (!acidButton) {
    console.warn("找不到 acidButton");
}

if (!message) {
    console.warn("找不到 message");
}

function showMessage(text) {
    if (message) {
        message.innerText = text;
    }
}

// ======================================================
// 4. Firebase 匿名登入
// ======================================================

let participantID = null;
let participantRef = null;

let authenticated = false;

async function loginVisitor() {

    try {

        // 等待 Firebase 恢復原本的登入狀態
        await auth.authStateReady();

        let user = auth.currentUser;

        // 第一次進入網站才建立匿名帳號
        if (!user) {
            const result = await signInAnonymously(auth);
            user = result.user;
        }

        if (!user.isAnonymous) {
            throw new Error("目前帳號不是匿名觀眾帳號");
        }

        participantID = user.uid;

        participantRef = ref(
            database,
            `rooms/${roomID}/participants/${participantID}`
        );

        authenticated = true;

        console.log("✅ Firebase 匿名登入成功");
        console.log("👤 Firebase UID：", participantID);

        return participantID;

    } catch (error) {

        authenticated = false;

        console.error("❌ Firebase 匿名登入失敗：", error);

        showMessage(
            "無法登入投票系統，請重新整理頁面"
        );

        throw error;
    }
}

// ======================================================
// 5. 在線觀眾管理設定
// ======================================================

// 10 分鐘無操作後移除
const INACTIVE_TIMEOUT = 10 * 60 * 1000;

// 每 30 秒檢查一次
const CHECK_INTERVAL = 30 * 1000;

let localLastActive = Date.now();

let participantRemoved = false;

// ======================================================
// 6. 註冊在線觀眾
// ======================================================

async function registerParticipant() {

    if (!authenticated || !participantRef) {
        throw new Error("尚未完成 Firebase 登入");
    }

    const now = Date.now();

    // 先設定斷線刪除，避免斷線後留下名單
    await onDisconnect(participantRef).remove();

    await set(participantRef, {
        joinedAt: now,
        lastActive: now
    });

    localLastActive = now;
    participantRemoved = false;

    console.log(
        "✅ 已加入在線觀眾：",
        participantID
    );
}

// ======================================================
// 7. 更新最後操作時間
// ======================================================

async function updateLastActive() {

    if (!authenticated || !participantRef) {
        throw new Error("觀眾尚未登入");
    }

    // 超時被移除後，若需要重新加入
    if (participantRemoved) {
        await registerParticipant();
        return;
    }

    const now = Date.now();

    await update(participantRef, {
        lastActive: now
    });

    localLastActive = now;

    console.log(
        "🕒 更新最後活動時間：",
        new Date(now).toLocaleTimeString()
    );
}

// ======================================================
// 8. 10 分鐘沒有操作，自動移除
// ======================================================

async function checkSelfInactive() {

    if (!authenticated || participantRemoved) {
        return;
    }

    const now = Date.now();

    const inactiveTime = now - localLastActive;

    if (inactiveTime < INACTIVE_TIMEOUT) {
        return;
    }

    try {

        await remove(participantRef);

        participantRemoved = true;

        // 已明確退出，取消斷線刪除操作
        await onDisconnect(participantRef).cancel();

        showMessage(
            "⏰ 超過 10 分鐘未操作，已離開互動名單"
        );

        refreshActionButtons();

        console.log("🚪 觀眾已超時移除");

    } catch (error) {

        console.error(
            "❌ 移除超時觀眾失敗：",
            error
        );
    }
}

// ======================================================
// 9. 在線觀眾數量
// ======================================================

function listenParticipantCount() {

    onValue(
        participantsRef,

        snapshot => {

            let count = 0;

            const now = Date.now();

            snapshot.forEach(childSnapshot => {

                const data = childSnapshot.val();

                if (
                    data &&
                    typeof data.lastActive === "number" &&
                    now - data.lastActive < INACTIVE_TIMEOUT
                ) {
                    count++;
                }
            });

            if (participantCount) {
                participantCount.innerText = count;
            }

            console.log("👥 目前在線人數：", count);
        },

        error => {

            console.error(
                "❌ 在線觀眾讀取失敗：",
                error
            );

            if (participantCount) {
                participantCount.innerText = "--";
            }
        }
    );
}

// ======================================================
// 10. 冷卻時間
// ======================================================

const VIRUS_COOLDOWN = 1500;
const ACID_COOLDOWN = 5000;

let virusCoolingDown = false;
let acidCoolingDown = false;

// ======================================================
// 11. Unity 遊戲在線狀態
// ======================================================

const GAME_HEARTBEAT_TIMEOUT = 15000;

let gamePresence = null;
let firebaseConnected = false;
let serverTimeOffset = 0;
let gameOnline = false;
let gameStatusError = false;

// V2 開發階段：停用舊版即時干擾
const LEGACY_COMMANDS_ENABLED = false;

function isGameOnline() {

    const serverNow = Date.now() + serverTimeOffset;

    const lastSeen = gamePresence?.lastSeen;

    if (!Number.isFinite(lastSeen)) {
        return false;
    }

    const age = serverNow - lastSeen;

    return (
        firebaseConnected &&
        typeof gamePresence?.sessionId === "string" &&
        gamePresence.sessionId.length > 0 &&
        age >= -5000 &&
        age <= GAME_HEARTBEAT_TIMEOUT
    );
}

// ======================================================
// 12. 更新按鈕狀態
// ======================================================

function refreshActionButtons() {

    const canOperate =
        authenticated &&
        !participantRemoved &&
        gameOnline &&
        !gameStatusError &&
        LEGACY_COMMANDS_ENABLED;

    if (virusButton) {
        virusButton.disabled =
            !canOperate || virusCoolingDown;
    }

    if (acidButton) {
        acidButton.disabled =
            !canOperate || acidCoolingDown;
    }
}

function refreshGameStatus() {

    gameOnline = isGameOnline();

    if (gameStatusElement) {

        if (gameStatusError) {

            gameStatusElement.textContent =
                "無法確認遊戲狀態，請檢查連線或資料庫權限";

        } else if (gameOnline) {

            gameStatusElement.textContent =
                "遊戲已啟動，可以操作";

        } else {

            gameStatusElement.textContent =
                "等待遊戲啟動";
        }
    }

    refreshActionButtons();
}

// ======================================================
// 13. 監聽 Firebase 連線及伺服器時間
// ======================================================

function listenFirebaseStatus() {

    onValue(
        ref(database, ".info/serverTimeOffset"),

        snapshot => {

            const offset = snapshot.val();

            serverTimeOffset =
                Number.isFinite(offset) ? offset : 0;

            refreshGameStatus();
        }
    );

    onValue(
        ref(database, ".info/connected"),

        snapshot => {

            firebaseConnected = snapshot.val() === true;

            refreshGameStatus();
        }
    );

    onValue(
        gameStatusRef,

        snapshot => {

            gameStatusError = false;

            gamePresence = snapshot.val();

            refreshGameStatus();
        },

        error => {

            gameStatusError = true;
            gamePresence = null;

            console.error(
                "❌ Unity 在線狀態讀取失敗：",
                error
            );

            refreshGameStatus();
        }
    );
}

// ======================================================
// 14. 舊版 Firebase 指令
// ======================================================

async function sendCommand(type, amount) {

    // V2 測試階段不發送舊指令
    if (!LEGACY_COMMANDS_ENABLED) {

        throw new Error(
            "V2 開發階段：舊版即時干擾已停用，等待正式投票系統"
        );
    }

    if (!authenticated) {
        throw new Error("尚未登入 Firebase");
    }

    if (participantRemoved) {
        throw new Error("觀眾已離開互動名單");
    }

    if (!isGameOnline()) {
        throw new Error("Unity 遊戲尚未啟動");
    }

    const sessionId = gamePresence.sessionId;

    await updateLastActive();

    if (
        !isGameOnline() ||
        gamePresence?.sessionId !== sessionId
    ) {
        throw new Error(
            "遊戲已重新啟動或離線"
        );
    }

    const commandRef = push(commandsRef);

    await set(commandRef, {
        type: type,
        amount: amount,
        sessionId: sessionId,
        time: serverTimestamp()
    });

    console.log(
        "✅ Firebase Command 已送出：",
        type,
        amount
    );
}

// ======================================================
// 15. 按鈕冷卻倒數
// ======================================================

function startCooldown(
    button,
    cooldownTime,
    finishCallback
) {

    if (!button) {
        return;
    }

    const label =
        button.querySelector(".action-title") || button;

    const originalText = label.innerText;

    button.disabled = true;

    const startTime = Date.now();

    const timer = setInterval(() => {

        const elapsed = Date.now() - startTime;

        const remaining = cooldownTime - elapsed;

        if (remaining <= 0) {

            clearInterval(timer);

            label.innerText = originalText;

            if (finishCallback) {
                finishCallback();
            }

            refreshActionButtons();

            return;
        }

        label.innerText =
            `冷卻中 ${(remaining / 1000).toFixed(1)} 秒`;

    }, 100);
}

// ======================================================
// 16. 病毒按鈕 ADD_VIRUS
// ======================================================

if (virusButton) {

    virusButton.addEventListener("click", async () => {

        if (!LEGACY_COMMANDS_ENABLED) {
            showMessage("V2 投票系統測試中");
            return;
        }

        if (!isGameOnline()) {

            refreshGameStatus();

            showMessage(
                "等待遊戲啟動，尚未發送指令"
            );

            return;
        }

        if (participantRemoved || virusCoolingDown) {
            return;
        }

        virusCoolingDown = true;

        startCooldown(
            virusButton,
            VIRUS_COOLDOWN,
            () => {
                virusCoolingDown = false;
            }
        );

        try {

            showMessage("🦠 病毒發送中...");

            await sendCommand("ADD_VIRUS", 1);

            showMessage("🦠 病毒增加成功！");

        } catch (error) {

            console.error(
                "❌ 病毒發送失敗：",
                error
            );

            showMessage("❌ 病毒發送失敗");
        }
    });
}

// ======================================================
// 17. 胃液遮擋按鈕 OBSCURE_VISION
// ======================================================

if (acidButton) {

    acidButton.addEventListener("click", async () => {

        if (!LEGACY_COMMANDS_ENABLED) {
            showMessage("V2 投票系統測試中");
            return;
        }

        if (!isGameOnline()) {

            refreshGameStatus();

            showMessage(
                "等待遊戲啟動，尚未發送指令"
            );

            return;
        }

        if (participantRemoved || acidCoolingDown) {
            return;
        }

        acidCoolingDown = true;

        startCooldown(
            acidButton,
            ACID_COOLDOWN,
            () => {
                acidCoolingDown = false;
            }
        );

        try {

            showMessage(
                "🟡 胃液遮擋指令發送中..."
            );

            await sendCommand(
                "OBSCURE_VISION",
                1
            );

            showMessage(
                "🟡 胃液遮擋指令發送成功！"
            );

        } catch (error) {

            console.error(
                "❌ 胃液遮擋指令發送失敗：",
                error
            );

            showMessage(
                "❌ 胃液遮擋指令發送失敗"
            );
        }
    });
}

// ======================================================
// 18. 每 30 秒檢查無操作時間
// ======================================================

setInterval(() => {

    checkSelfInactive().catch(error => {
        console.error("閒置檢查失敗：", error);
    });

}, CHECK_INTERVAL);

// 更新顯示狀態
setInterval(refreshGameStatus, 1000);

// ======================================================
// 19. 啟動 Stomach GO
// ======================================================

async function initializeStomachGO() {

    console.log("🎮 Stomach GO 啟動中...");

    // 初始狀態先禁止操作
    refreshActionButtons();

    try {

        // 第一步：Firebase 匿名登入
        await loginVisitor();

        // 第二步：建立在線觀眾資料
        await registerParticipant();

        // 第三步：監聽在線人數
        listenParticipantCount();

        // 第四步：監聽 Unity 遊戲在線狀態
        listenFirebaseStatus();

        console.log("✅ app.js 新版本已成功載入");
        console.log("🎮 房間：", roomID);
        console.log("👤 Participant ID：", participantID);
        console.log(
            "⏰ 無操作剔除時間：",
            INACTIVE_TIMEOUT / 60000,
            "分鐘"
        );
        console.log(
            "🦠 病毒冷卻：",
            VIRUS_COOLDOWN / 1000,
            "秒"
        );
        console.log(
            "🟡 胃液遮擋冷卻：",
            ACID_COOLDOWN / 1000,
            "秒"
        );

        showMessage("✅ Firebase 連線成功");

        refreshGameStatus();

    } catch (error) {

        console.error(
            "❌ Stomach GO 初始化失敗：",
            error
        );

        showMessage(
            "❌ 系統連線失敗，請重新整理頁面"
        );

        refreshActionButtons();
    }
}

// 正式啟動
await initializeStomachGO();
