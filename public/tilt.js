// Independent of Firebase: sensor input only changes visual CSS variables.
(() => {
    const toggle = document.getElementById("motionToggle");
    const calibrate = document.getElementById("motionCalibrate");
    const status = document.getElementById("motionStatus");
    const style = document.body.style;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let enabled = false;
    let pending = false;
    let baseline = null;
    let target = { x: 0, y: 0 };
    let current = { x: 0, y: 0 };
    let frame = null;
    let sensorTimeout = null;
    let lastFrame = 0;

    const clamp = value => Math.max(-1, Math.min(1, value));
    const angleDifference = (value, origin) => ((value - origin + 540) % 360) - 180;

    function paint() {
        const values = {
            "tilt-x": `${(-current.y * 18).toFixed(3)}deg`,
            "tilt-y": `${(current.x * 22).toFixed(3)}deg`,
            "logo-x": `${(current.x * 22).toFixed(3)}px`,
            "logo-y": `${(current.y * 18).toFixed(3)}px`,
            "card-x": `${(current.x * 14).toFixed(3)}px`,
            "card-y": `${(current.y * 12).toFixed(3)}px`,
            "icon-x": `${(current.x * 9).toFixed(3)}px`,
            "icon-y": `${(current.y * 7).toFixed(3)}px`,
            "background-x": `${(-current.x * 30).toFixed(3)}px`,
            "background-y": `${(-current.y * 30).toFixed(3)}px`
        };
        for (const [name, value] of Object.entries(values)) {
            style.setProperty(`--${name}`, value);
        }
    }

    function animate(time) {
        frame = null;
        if (!enabled || document.hidden) return;
        const delta = lastFrame ? Math.min(time - lastFrame, 64) : 16;
        lastFrame = time;
        const smoothing = 1 - Math.exp(-delta / 110);
        current.x += (target.x - current.x) * smoothing;
        current.y += (target.y - current.y) * smoothing;
        if (Math.abs(target.x - current.x) + Math.abs(target.y - current.y) < 0.001) {
            current = { ...target };
            paint();
            return;
        }
        paint();
        frame = requestAnimationFrame(animate);
    }

    function schedule() {
        if (frame === null && enabled && !document.hidden) {
            lastFrame = 0;
            frame = requestAnimationFrame(animate);
        }
    }

    function resetAngle() {
        baseline = null;
        target = { x: 0, y: 0 };
        current = { x: 0, y: 0 };
        paint();
    }

    function orientation(event) {
        if (!enabled || document.hidden || !Number.isFinite(event.beta) || !Number.isFinite(event.gamma)) return;
        clearTimeout(sensorTimeout);
        if (!baseline) {
            baseline = { beta: event.beta, gamma: event.gamma };
            status.textContent = "已啟用，輕輕傾斜手機；重設角度可將目前姿勢設為中心。";
        }
        const angle = (window.screen.orientation?.angle ?? window.orientation ?? 0) * Math.PI / 180;
        const x = angleDifference(event.gamma, baseline.gamma);
        const y = angleDifference(event.beta, baseline.beta);
        target = {
            x: clamp((x * Math.cos(angle) + y * Math.sin(angle)) / 15),
            y: clamp((y * Math.cos(angle) - x * Math.sin(angle)) / 15)
        };
        schedule();
    }

    function stop() {
        enabled = false;
        window.removeEventListener("deviceorientation", orientation);
        clearTimeout(sensorTimeout);
        if (frame !== null) cancelAnimationFrame(frame);
        frame = null;
        resetAngle();
        toggle.textContent = "啟用 3D 傾斜效果";
        toggle.setAttribute("aria-pressed", "false");
        calibrate.hidden = true;
    }

    function waitForSensor() {
        clearTimeout(sensorTimeout);
        sensorTimeout = setTimeout(() => {
            if (enabled && !baseline && !document.hidden) {
                stop();
                status.textContent = "未收到傾斜資料，請確認手機感測器權限後重試。";
            }
        }, 8000);
    }

    toggle.addEventListener("click", async () => {
        if (pending) return;
        if (enabled) {
            stop();
            status.textContent = "3D 傾斜效果已關閉。";
            return;
        }
        if (reducedMotion.matches) {
            status.textContent = "系統目前已開啟減少動態效果。";
            return;
        }
        if (!window.isSecureContext) {
            status.textContent = "請使用 HTTPS 網址開啟，才能啟用手機傾斜效果。";
            return;
        }
        const sensor = window.DeviceOrientationEvent;
        if (!sensor) {
            status.textContent = "此裝置或瀏覽器不支援手機傾斜感測。";
            return;
        }
        pending = true;
        toggle.disabled = true;
        try {
            // Must be called directly from the user's click for iOS permission.
            if (typeof sensor.requestPermission === "function" && await sensor.requestPermission() !== "granted") {
                status.textContent = "未取得傾斜感測權限，可允許權限後再試一次。";
                return;
            }
            if (reducedMotion.matches) return;
            enabled = true;
            resetAngle();
            window.addEventListener("deviceorientation", orientation, { passive: true });
            toggle.textContent = "關閉 3D 傾斜效果";
            toggle.setAttribute("aria-pressed", "true");
            calibrate.hidden = false;
            status.textContent = "等待感測器，請以舒適角度握住手機…";
            waitForSensor();
        } catch {
            stop();
            status.textContent = "無法啟用傾斜感測，請確認瀏覽器權限後重試。";
        } finally {
            pending = false;
            toggle.disabled = false;
        }
    });

    calibrate.addEventListener("click", () => {
        resetAngle();
        waitForSensor();
        status.textContent = "正在重設角度，請保持目前的握持姿勢。";
    });
    window.addEventListener("orientationchange", resetAngle);
    window.screen.orientation?.addEventListener("change", resetAngle);
    document.addEventListener("visibilitychange", () => {
        if (!enabled) return;
        if (document.hidden) {
            if (frame !== null) cancelAnimationFrame(frame);
            frame = null;
            clearTimeout(sensorTimeout);
        } else {
            resetAngle();
            waitForSensor();
        }
    });
    reducedMotion.addEventListener("change", () => {
        if (reducedMotion.matches) {
            stop();
            status.textContent = "已依照系統設定停用動態效果。";
        }
    });
})();
