
﻿// ======================================================
// Stomach GO V2
// Firebase 匿名登入 + 觀眾在線管理 + 投票資格限制
// ======================================================

// Firebase App
import {
    initializeApp
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";

// Firebase Database
import {
    getDatabase,
    ref,
    get,
    onValue,
    update,
    set,
    push,
    remove,
    onDisconnect,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js";

// Firebase Authentication
import {
    getAuth,
    signInAnonymously
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

// ======================================================
// 1. Firebase 設定
// ======================================================

import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);

// ======================================================
// 2. Firebase 房間
// ======================================================

const room = "rooms/ab123";

const presenceRef = ref(
    db,
    `${room}/presence`
);

const voteRequestsRef = ref(
    db,
    `${room}/voteRequests`
);

const currentRoundRef = ref(
    db,
    `${room}/currentRound`
);

const gameStatusRef = ref(
    db,
    `${room}/gameStatus`
);

// ======================================================
// 3. HTML 元件與投票按鈕
// ======================================================

const el = id => document.getElementById(id);

const keys = [
    ["acidButton", "STOMACH_ACID"],
    ["virusButton", "VIRUS_FRENZY"],
    ["crosshairButton", "AIM_DRIFT"]
];

const buttons = keys.map(([id]) => el(id));

// ======================================================
// 4. 使用者狀態
// ======================================================

let uid = null;
let me = null;
let myPresenceRef = null;

let authenticated = false;
let profileReady = false;
let active = true;
let busy = false;

// ======================================================
// 5. 遊戲狀態
// ======================================================

let round = null;
let game = null;

let offset = 0;
let connected = false;

let lastTap = 0;
let lastActivity = Date.now();

let registeringPresence = false;
let presenceRegistered = false;
let presenceReady = false;

// ======================================================
// 6. 時間設定
// ======================================================

const INACTIVE_TIMEOUT = 2 * 60 * 1000;
const GAME_TIMEOUT = 15000;
const MIN_TAP_INTERVAL = 200;

const INACTIVE_CHECK_INTERVAL = 1000;
const PRESENCE_HEARTBEAT_INTERVAL = 30000;

// ======================================================
// 7. 時間計算
// ======================================================

function now() {
    return Date.now() + offset;
}

function remaining() {
    if (!round?.endsAt) {
        return 0;
    }

    return Math.max(
        0,
        Math.ceil(
            (Number(round.endsAt) - now()) / 1000
        )
    );
}

// ======================================================
// 8. Unity 在線判斷
// ======================================================

function gameOnline() {
    if (!connected) {
        return false;
    }

    if (typeof game?.sessionId !== "string") {
        return false;
    }

    if (!game.sessionId.length) {
        return false;
    }

    const lastSeen = Number(game?.lastSeen);

    if (!Number.isFinite(lastSeen)) {
        return false;
    }

    const age = now() - lastSeen;

    return age >= -5000 && age < GAME_TIMEOUT;
}

// ======================================================
// 9. 當輪投票資格
// ======================================================

// 新增：確認 UID 是否在 Unity 鎖定的名單中
function canVoteThisRound() {
    if (!round || !uid) {
        return false;
    }

    return round.eligibleVoters?.[uid] === true;
}

// 三個投票按鈕共同使用的資格判斷
function eligible() {
    return (
        authenticated &&
        profileReady &&
        presenceRegistered &&
        active &&
        connected &&
        gameOnline() &&
        canVoteThisRound() &&
        round?.phase === "VOTING" &&
        Number.isFinite(Number(round?.endsAt)) &&
        now() < Number(round.endsAt)
    );
}

// ======================================================
// 10. 更新畫面
// ======================================================

function display() {

    const phaseNames = {
        IDLE: "尚未開始",
        WAITING: "等待準備",
        VOTING: "開始點擊！",
        RESULT: "結算中",
        INTERFERENCE: "干擾進行中"
    };

    const phase =
        phaseNames[round?.phase] || "等待回合資料";

    const showTime =
        round?.phase === "WAITING" ||
        round?.phase === "VOTING";

    // ------------------------------------------
    // 顯示回合資訊與倒數
    // ------------------------------------------

    const roundInfo = el("roundInfo");

    if (roundInfo) {
        roundInfo.textContent =
            `第 ${round?.roundId ?? "--"} 輪｜${phase}` +
            (
                showTime
                    ? `｜剩餘 ${remaining()} 秒`
                    : ""
            );
    }

    // ------------------------------------------
    // Unity 在線狀態
    // ------------------------------------------

    const gameStatusElement = el("gameStatus");

    if (gameStatusElement) {
        gameStatusElement.textContent =
            gameOnline()
                ? "Unity 已連線"
                : "等待 Unity 連線";
    }

    // ------------------------------------------
    // 投票按鈕
    // ------------------------------------------

    buttons.forEach(button => {
        if (button) {
            button.disabled = !eligible() || busy;
        }
    });

    // ------------------------------------------
    // 下方提示訊息
    // ------------------------------------------

    const message = el("message");

    if (!message) {
        return;
    }

    if (!authenticated) {
        message.textContent =
            "Firebase 身份驗證中…";
    }
    else if (!active) {
        message.textContent =
            "超過 2 分鐘未操作，已離開互動名單";
    }
    else if (!profileReady) {
        message.textContent =
            "請選擇頭貼並輸入名稱";
    }
    else if (!connected) {
        message.textContent =
            "Firebase 連線中…";
    }
    else if (!presenceRegistered) {
        message.textContent =
            "正在建立在線狀態…";
    }
    else if (!gameOnline()) {
        message.textContent =
            "Unity 尚未連線，請稍候";
    }

    // ==========================================
    // 修正：中途加入者的提示
    // ==========================================

    else if (
        round?.phase === "VOTING" &&
        !round?.eligibleVoters
    ) {
        message.textContent =
            "尚未收到本輪可投票名單，請主機確認 Unity 名單發布與 Firebase 寫入狀態。";
    }

    else if (
        round?.phase === "VOTING" &&
        !canVoteThisRound()
    ) {
        message.textContent =
            "🔒 你不在本輪可投票名單內，請等待下一輪；若準備期間已加入，請主機檢查在線名單。";
    }

    // 正常觀眾可以參與投票
    else if (round?.phase === "VOTING") {
        message.textContent =
            "開始點擊！請選擇想要的干擾效果。";
    }

    else if (round?.phase === "WAITING") {
        message.textContent =
            "等待開始：尚未開放投票";
    }

    else if (round?.phase === "IDLE") {
        message.textContent =
            "等待 Unity 按 T 開始回合";
    }

    else if (
        round?.phase === "RESULT" ||
        round?.phase === "INTERFERENCE"
    ) {
        message.textContent =
            "本輪已結束，請等待下一輪";
    }
    else {
        message.textContent =
            "等待 Unity 回合資料…";
    }
}

// ======================================================
// 11. Firebase 匿名登入
// ======================================================

async function loginVisitor() {

    await auth.authStateReady();

    let user = auth.currentUser;

    if (!user) {
        const result = await signInAnonymously(auth);
        user = result.user;
    }

    if (!user.isAnonymous) {
        throw new Error(
            "目前登入者不是匿名觀眾"
        );
    }

    uid = user.uid;

    me = ref(
        db,
        `${room}/participants/${uid}`
    );

    myPresenceRef = ref(
        db,
        `${room}/presence/${uid}`
    );

    authenticated = true;

    console.log("✅ Firebase 匿名登入成功");
    console.log("👤 Firebase UID：", uid);

    display();
}

// ======================================================
// 12. 建立／更新個人資料
// ======================================================

async function saveProfile(name, avatarId) {

    if (!authenticated || !me) {
        throw new Error("Firebase 尚未登入");
    }

    const snapshot = await get(me);

    if (snapshot.exists()) {

        await update(me, {
            name: name,
            avatarId: avatarId,
            lastActive: serverTimestamp()
        });

        console.log("✅ 已更新原有觀眾資料");

    } else {

        await set(me, {
            name: name,
            avatarId: avatarId,
            joinedAt: serverTimestamp(),
            profileCreatedAt: serverTimestamp(),
            lastActive: serverTimestamp()
        });

        console.log("✅ 已建立新觀眾資料");
    }

    lastActivity = Date.now();

    profileReady = true;
    active = true;
    presenceReady = true;

    if (connected) {
        await registerPresence();
    }
}

// ======================================================
// 13. 建立在線狀態
// ======================================================

async function registerPresence() {

    if (
        !authenticated ||
        !profileReady ||
        !presenceReady ||
        !active ||
        !connected ||
        !myPresenceRef ||
        registeringPresence
    ) {
        return;
    }

    registeringPresence = true;

    try {

        // Firebase 斷線時只刪除在線紀錄
        // 不刪除觀眾的個人資料
        await onDisconnect(myPresenceRef).remove();

        await set(myPresenceRef, {
            lastSeen: serverTimestamp()
        });

        presenceRegistered = true;

        console.log(
            "✅ 觀眾在線狀態建立成功"
        );

    } catch (error) {

        presenceRegistered = false;

        console.error(
            "❌ 建立在線狀態失敗：",
            error
        );

        throw error;

    } finally {

        registeringPresence = false;

        display();
    }
}

// ======================================================
// 14. 更新在線時間
// ======================================================

async function updatePresence() {

    if (
        !authenticated ||
        !active ||
        !profileReady ||
        !presenceRegistered ||
        !connected ||
        !myPresenceRef
    ) {
        return;
    }

    await update(myPresenceRef, {
        lastSeen: serverTimestamp()
    });
}

// ======================================================
// 15. 記錄觀眾操作
// ======================================================

async function touchActivity() {

    if (
        !authenticated ||
        !active ||
        !profileReady
    ) {
        return;
    }

    lastActivity = Date.now();

    await update(me, {
        lastActive: serverTimestamp()
    });

    await updatePresence();
}

// ======================================================
// 16. 2 分鐘閒置退出
// ======================================================

async function checkInactive() {

    if (
        !authenticated ||
        !active ||
        !profileReady
    ) {
        return;
    }

    if (
        Date.now() - lastActivity <
        INACTIVE_TIMEOUT
    ) {
        return;
    }

    active = false;
    presenceReady = false;
    presenceRegistered = false;

    display();

    try {

        if (myPresenceRef) {

            await remove(myPresenceRef);

            await onDisconnect(
                myPresenceRef
            ).cancel();
        }

        console.log(
            "⏰ 超過 2 分鐘未操作，已移除在線名單"
        );

    } catch (error) {

        console.error(
            "❌ 移除在線狀態失敗：",
            error
        );
    }
}

// ======================================================
// 17. Firebase 重新連線
// ======================================================

async function handleConnectionChange(isConnected) {

    connected = isConnected;

    if (!connected) {

        presenceRegistered = false;

        display();

        return;
    }

    if (
        authenticated &&
        profileReady &&
        active
    ) {

        try {

            presenceRegistered = false;

            await registerPresence();

        } catch (error) {

            console.error(
                "❌ 重新連線失敗：",
                error
            );
        }
    }

    display();
}

// ======================================================
// 18. 三種投票按鈕
// ======================================================

keys.forEach(([id, type]) => {

    const button = el(id);

    if (!button) {
        console.warn("找不到按鈕：", id);
        return;
    }

    button.addEventListener("click", async () => {

        // 沒有當輪資格，直接拒絕
        if (!eligible() || busy) {
            return;
        }

        const currentTap = performance.now();

        // 防連點 0.2 秒
        if (
            currentTap - lastTap <
            MIN_TAP_INTERVAL
        ) {
            return;
        }

        lastTap = currentTap;
        busy = true;

        display();

        try {

            const requestRef = push(
                voteRequestsRef
            );

            // 送出投票請求
            await set(requestRef, {
                uid: uid,
                roundId: Number(round.roundId),
                type: type,
                requestedAt: serverTimestamp()
            });

            await touchActivity();

            console.log(
                "✅ 投票請求送出：",
                type
            );

            // 不再直接改寫下方提示文字。
            // 所有提示統一交給 display()，
            // 避免中途加入者顯示錯誤訊息。

        } catch (error) {

            console.error(
                "❌ 投票送出失敗：",
                error
            );

            // 只在 Console 顯示錯誤，
            // 不覆蓋投票資格提示。

        } finally {

            busy = false;

            display();
        }
    });
});

// ======================================================
// 19. 六種頭貼
// ======================================================

const symbols = [
    "🦠",
    "👾",
    "🧬",
    "🤖",
    "👽",
    "🐙"
];

let avatar = -1;

const grid = el("profileAvatarOptions");

if (grid) {

    symbols.forEach((symbol, index) => {

        const button =
            document.createElement("button");

        button.type = "button";
        button.className = "profile-avatar";
        button.textContent = symbol;

        button.setAttribute(
            "aria-pressed",
            "false"
        );

        button.addEventListener("click", () => {

            avatar = index;

            [...grid.children].forEach(
                (item, itemIndex) => {

                    item.setAttribute(
                        "aria-pressed",
                        String(itemIndex === index)
                    );
                }
            );
        });

        grid.appendChild(button);
    });
}

// ======================================================
// 20. 恢復暱稱與頭貼
// ======================================================

let stored = null;

try {

    stored = JSON.parse(
        localStorage.getItem(
            "stomachGoV2Profile"
        ) || "null"
    );

} catch (error) {

    console.warn(
        "無法讀取本機頭貼資料：",
        error
    );
}

if (
    stored?.name &&
    Number.isInteger(stored.avatarId)
) {

    if (el("profileName")) {

        el("profileName").value =
            stored.name;
    }

    grid?.children[
        stored.avatarId
    ]?.click();
}

// ======================================================
// 21. 確認頭貼與暱稱
// ======================================================

const profileConfirm = el("profileConfirm");

if (profileConfirm) {

    profileConfirm.addEventListener(
        "click",
        async () => {

            if (!authenticated) {

                el("profileFeedback").textContent =
                    "Firebase 登入中，請稍候";

                return;
            }

            const name =
                el("profileName").value.trim();

            if (
                avatar < 0 ||
                name.length < 1 ||
                name.length > 12
            ) {

                el("profileFeedback").textContent =
                    "請選擇頭貼並輸入 1–12 字暱稱";

                return;
            }

            profileConfirm.disabled = true;

            try {

                await saveProfile(
                    name,
                    avatar
                );

                localStorage.setItem(
                    "stomachGoV2Profile",
                    JSON.stringify({
                        name: name,
                        avatarId: avatar
                    })
                );

                if (el("profileOverlay")) {

                    el("profileOverlay").hidden =
                        true;
                }

                console.log(
                    "✅ 觀眾資料註冊成功：",
                    uid
                );

                display();

            } catch (error) {

                console.error(
                    "❌ 觀眾註冊失敗：",
                    error
                );

                el("profileFeedback").textContent =
                    "註冊失敗，請檢查 Firebase 權限";

            } finally {

                profileConfirm.disabled = false;
            }
        }
    );
}

// ======================================================
// 22. Firebase 監聽
// ======================================================

function startListeners() {

    // ------------------------------------------
    // Firebase 伺服器時間差
    // ------------------------------------------

    onValue(
        ref(db, ".info/serverTimeOffset"),
        snapshot => {

            offset =
                Number(snapshot.val()) || 0;

            display();
        }
    );

    // ------------------------------------------
    // Firebase 連線
    // ------------------------------------------

    onValue(
        ref(db, ".info/connected"),
        snapshot => {

            handleConnectionChange(
                snapshot.val() === true
            ).catch(console.error);
        }
    );

    // ------------------------------------------
    // Unity 回合狀態與當輪觀眾名單
    // ------------------------------------------

    onValue(
        currentRoundRef,
        snapshot => {

            round = snapshot.val();

            console.info("[Vote eligibility]", {
                uid,
                roundId: round?.roundId,
                phase: round?.phase,
                presenceRegistered,
                voterListReceived: !!round?.eligibleVoters,
                voterCount: Object.keys(round?.eligibleVoters || {}).length,
                included: canVoteThisRound()
            });

            display();
        },
        error => {

            console.error(
                "❌ 回合狀態讀取失敗：",
                error
            );
        }
    );

    // ------------------------------------------
    // Unity 在線狀態
    // ------------------------------------------

    onValue(
        gameStatusRef,
        snapshot => {

            game = snapshot.val();

            display();
        },
        error => {

            console.error(
                "❌ Unity 在線狀態讀取失敗：",
                error
            );
        }
    );

    // ------------------------------------------
    // 觀眾在線人數
    // ------------------------------------------

    onValue(
        presenceRef,
        snapshot => {

            const count = snapshot.size;

            const countElement =
                el("participantCount");

            if (countElement) {

                countElement.textContent =
                    count;
            }
        },
        error => {

            console.error(
                "❌ 在線人數讀取失敗：",
                error
            );
        }
    );
}

// ======================================================
// 23. 定期更新
// ======================================================

// 每 0.2 秒刷新回合倒數與提示
setInterval(display, 200);

// 每秒檢查閒置
setInterval(() => {

    checkInactive().catch(
        console.error
    );

}, INACTIVE_CHECK_INTERVAL);

// 每 30 秒更新在線狀態
setInterval(() => {

    if (
        authenticated &&
        profileReady &&
        active &&
        connected
    ) {

        updatePresence().catch(
            console.error
        );
    }

}, PRESENCE_HEARTBEAT_INTERVAL);

// ======================================================
// 24. 啟動 Stomach GO
// ======================================================

async function initializeStomachGO() {

    console.log(
        "🎮 Stomach GO V2 啟動中..."
    );

    display();

    try {

        await loginVisitor();

        startListeners();

        console.log(
            "✅ vote-app.js 載入成功"
        );

        console.log(
            "🎮 Firebase Room:",
            room
        );

    } catch (error) {

        console.error(
            "❌ Stomach GO 初始化失敗：",
            error
        );

        const message = el("message");

        if (message) {

            message.textContent =
                "Firebase 登入失敗，請重新整理";
        }
    }
}

// 正式啟動
await initializeStomachGO();
