import "./styles.css";
import "./accessibility.css";
import { mountAgentPanel } from "./agent-panel";
import { BlinkMonitor } from "./eye/blink-monitor";
import { FaceEyeDetector } from "./eye/face-detector";
import { PoseDetector } from "./pose/detector";
import { FrameGate } from "./pose/frame-gate";
import { ObservationScheduler } from "./pose/observation-scheduler";
import { SessionJournal, SessionOutbox } from "./session-journal";
import {
  PostureMotionWindow,
  compareWithBaseline,
  createBaseline,
  extractPostureFeatures,
  validateBaseline,
  type DeviationResult,
} from "./pose/features";
import { demoConfig, normalConfig, PostureMonitor, type MonitorOutput } from "./pose/state-machine";
import type {
  Baseline,
  Landmark,
  MonitorState,
  PostureFeatures,
} from "./pose/types";
import {
  applyTheme,
  loadPreferences,
  savePreferences,
  themes,
  type Preferences,
} from "./ui/preferences";
import { announce, formatDuration, stateCopy } from "./ui/view";
import { isQuiet, SessionLedger, type RuntimePreferences, type SessionMode } from "./session";
import { mountDeviceSettings, setEyeStatus, setNotificationStatus, refreshVoiceStatus } from "./ui/device-settings";
import { mountObservationDetails, renderObservation } from "./ui/observation-view";

const app = document.querySelector<HTMLDivElement>("#app")!;
let preferences: Preferences = loadPreferences();
applyTheme(preferences.theme);

app.innerHTML = `
  <main class="shell">
    <header class="topbar">
      <a class="brand" href="#" aria-label="坐标系首页">
        <span class="brand-mark" aria-hidden="true"><i></i><i></i></span>
        <span><strong>坐标系</strong><small>坐有坐标，动有节奏</small></span>
      </a>
      <div class="topbar-actions">
        <div class="privacy-chip"><span></span> 姿态识别在本机完成</div>
        <button class="settings-button" id="settingsButton" aria-label="打开设置"><i></i><i></i><i></i></button>
      </div>
    </header>

    <section class="hero">
      <div>
        <p class="eyebrow">PERSONAL POSTURE RHYTHM</p>
        <h1>坐得舒服，<br /><em>也记得换个姿势。</em></h1>
      </div>
      <p class="hero-copy">从你平时最舒服的坐姿开始，留意专注时身体的细微变化，让坐与动自然交替。</p>
    </section>

    <section class="workspace">
      <article class="camera-card">
        <div class="camera-head">
          <div>
            <span class="section-kicker">01 · 实时陪伴</span>
            <h2>你的舒适坐标</h2>
          </div>
          <span id="modeBadge" class="mode-badge">普通模式</span>
        </div>

        <div class="stage" id="stage">
          <video id="video" playsinline muted></video>
          <canvas id="overlay"></canvas>
          <div class="stage-placeholder" id="stagePlaceholder">
            <div class="frame-figure" aria-hidden="true"><span></span></div>
            <h3>让头部与双肩进入画面</h3>
            <p>画面即看即用，姿态数据留在本机</p>
          </div>
          <div class="stage-status" id="stageStatus"><span></span>准备开始</div>
          <div class="calibration" id="calibration" hidden>
            <div class="calibration-ring"><strong id="calibrationNumber">10</strong><small>秒</small></div>
            <div><b>保持自然、舒服的姿势</b><span>就按平时最舒服的样子坐好</span></div>
          </div>
        </div>

        <div class="controls">
          <button class="button primary" id="startButton">开启摄像头</button>
          <button class="button secondary" id="calibrateButton" disabled>记录舒适坐姿</button>
          <button class="button quiet" id="endSessionButton" disabled>结束本次专注</button>
          <button class="icon-button" id="pauseButton" disabled aria-label="暂停检测" title="暂停检测">Ⅱ</button>
        </div>
        <p class="camera-note" id="cameraNote">建议坐在距屏幕约一臂的位置，取景至少包含头部和双肩。</p>
      </article>

      <aside class="insight-column">
        <article class="status-card" id="statusCard" data-state="idle">
          <div class="status-orbit" aria-hidden="true">
            <span></span><span></span><span></span>
          </div>
          <span class="section-kicker">02 · 当前状态</span>
          <h2 id="statusTitle">准备好了</h2>
          <p id="statusDescription">开启摄像头，记录一段你平时最舒服的坐姿。</p>
          <div class="progress-row">
            <span>姿态变化观察</span><b id="progressLabel">准备开始</b>
          </div>
          <div class="progress"><i id="progressBar"></i></div>
        </article>

        <article class="summary-card">
          <div class="card-title-row">
            <div><span class="section-kicker">03 · 本次小结</span><h2>每一次变化都算数</h2></div>
            <button class="text-button" id="resetStatsButton">清零</button>
          </div>
          <div class="stats">
            <div><strong id="sessionTime">00:00</strong><span>陪伴时长</span></div>
            <div><strong id="reminderCount">0</strong><span>温和提醒</span></div>
            <div><strong id="movementCount">0</strong><span>主动确认活动</span></div>
          </div>
        </article>

        <article class="settings-card">
          <div>
            <b>快速演示模式</b>
            <span>20秒模拟久坐，适合课堂展示</span>
          </div>
          <label class="switch"><input id="demoToggle" type="checkbox" /><span></span></label>
          <button class="simulate-button" id="simulateButton">模拟一次持续偏离</button>
        </article>
      </aside>
    </section>

    <footer>
      <span>坐标系 Agent 版 · 工作节奏与个人记录</span>
      <span>出现持续疼痛或眩晕时，请及时咨询专业人员</span>
    </footer>
  </main>

  <div class="toast" id="toast" role="status" aria-live="polite"></div>

  <div class="modal-backdrop" id="reminderModal" hidden>
    <section class="reminder-modal" role="dialog" aria-modal="true" aria-labelledby="reminderTitle">
      <button class="modal-close" id="modalClose" aria-label="关闭提醒">×</button>
      <div class="modal-icon" aria-hidden="true"><span></span></div>
      <p class="eyebrow">A GENTLE PAUSE</p>
      <h2 id="reminderTitle">换个姿势松一松吧</h2>
      <p id="reminderCopy">这个姿势保持了一会儿。慢慢活动肩膀，或换一个更舒服的位置。</p>
      <div class="reason-block">
        <span>刚才更接近哪种感受？</span>
        <div class="reason-buttons">
          <button data-reason="clarity">想看得更清楚</button>
          <button data-reason="tired">身体有点累</button>
          <button data-reason="focus">刚才很专注</button>
        </div>
        <p id="reasonTip">选择当下的感受，页面会给出更合适的建议。</p>
      </div>
      <div class="modal-actions">
        <button class="button primary" id="doneButton">我已经调整好了</button>
        <button class="button secondary" id="laterButton">稍后再提醒</button>
      </div>
      <small>试着缓慢放松双肩，选择舒服的幅度；出现不适时停下。活动由你确认记录。</small>
    </section>
  </div>

  <div class="drawer-backdrop" id="settingsBackdrop" hidden></div>
  <aside class="settings-drawer" id="settingsDrawer" aria-label="设置" aria-hidden="true">
    <div class="drawer-head">
      <div><span class="section-kicker">SETTINGS</span><h2>按你的习惯来</h2></div>
      <button class="drawer-close" id="settingsClose" aria-label="关闭设置">×</button>
    </div>

    <section class="settings-section">
      <div class="settings-section-title"><b>页面配色</b><span>选择一个看着舒服的色系</span></div>
      <div class="theme-grid">
        ${themes.map((theme) => `
          <button class="theme-option" data-theme="${theme.key}" aria-pressed="false">
            <span class="theme-swatches">${theme.colors.map((color) => `<i style="background:${color}"></i>`).join("")}</span>
            <strong>${theme.name}</strong><small>${theme.description}</small>
          </button>`).join("")}
      </div>
    </section>

    <section class="settings-section">
      <div class="settings-section-title"><b>提醒方式</b><span>声音和系统通知可以分别调整</span></div>
      <label class="setting-row"><span><b>轻提示音</b><small>提醒出现时播放一声短音</small></span><span class="switch"><input id="soundToggle" type="checkbox" /><i></i></span></label>
      <label class="setting-row"><span><b>语音提示</b><small>用一句短语提醒活动身体</small></span><span class="switch"><input id="voiceToggle" type="checkbox" /><i></i></span></label>
      <label class="setting-row"><span><b>桌面通知</b><small>切换到其他页面时显示系统提示</small></span><span class="switch"><input id="notificationToggle" type="checkbox" /><i></i></span></label>
      <p class="settings-note">切到后台后继续尝试姿态采样。浏览器可能降低采样频率；画面中断时暂停姿态累计，专注计时继续。</p>
    </section>

    <section class="settings-section">
      <div class="settings-section-title"><b>用眼观察</b><span>在本次专注结束时汇总眨眼节奏</span></div>
      <label class="setting-row"><span><b>记录眨眼变化</b><small>开启后在本机分析面部眼部变化，采样频率随设备性能变化</small></span><span class="switch"><input id="eyeToggle" type="checkbox" /><i></i></span></label>
      <p class="settings-note">眼镜反光、侧脸和光线变化会影响结果，页面只展示行为趋势。</p>
    </section>
  </aside>

  <div class="modal-backdrop" id="sessionModal" hidden>
    <section class="session-modal" aria-labelledby="sessionTitle">
      <button class="modal-close" id="sessionClose" aria-label="关闭专注总结">×</button>
      <p class="eyebrow">SESSION SUMMARY</p>
      <h2 id="sessionTitle">这段专注告一段落</h2>
      <p>身体的每一次变化，都让这段专注更有节奏。</p>
      <div class="session-stats">
        <div><strong id="sessionSummaryTime">00:00</strong><span>专注时长</span></div>
        <div><strong id="sessionSummaryMovements">0</strong><span>姿势变化</span></div>
        <div><strong id="sessionSummaryBlinks">—</strong><span>每分钟眨眼</span></div>
      </div>
      <div class="eye-summary" id="eyeSummary">
        <b>用眼观察正在积累</b><span>开启用眼观察并保持清晰取景后，这里会出现本次趋势。</span>
      </div>
      <div class="modal-actions">
        <button class="button primary" id="continueButton">开始下一次</button>
        <button class="button secondary" id="finishButton">完成查看</button>
      </div>
    </section>
  </div>
`;

function byId<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

const video = byId<HTMLVideoElement>("video");
const canvas = byId<HTMLCanvasElement>("overlay");
const context = canvas.getContext("2d")!;
const startButton = byId<HTMLButtonElement>("startButton");
const calibrateButton = byId<HTMLButtonElement>("calibrateButton");
const pauseButton = byId<HTMLButtonElement>("pauseButton");
const endSessionButton = byId<HTMLButtonElement>("endSessionButton");
const demoToggle = byId<HTMLInputElement>("demoToggle");
const simulateButton = byId<HTMLButtonElement>("simulateButton");
const calibrationPanel = byId<HTMLDivElement>("calibration");
const reminderModal = byId<HTMLDivElement>("reminderModal");
const sessionModal = byId<HTMLDivElement>("sessionModal");
const settingsDrawer = byId<HTMLElement>("settingsDrawer");
const settingsBackdrop = byId<HTMLDivElement>("settingsBackdrop");
const soundToggle = byId<HTMLInputElement>("soundToggle");
const voiceToggle = byId<HTMLInputElement>("voiceToggle");
const notificationToggle = byId<HTMLInputElement>("notificationToggle");
const eyeToggle = byId<HTMLInputElement>("eyeToggle");

let detector: PoseDetector | null = null;
let eyeDetector: FaceEyeDetector | null = null;
let eyeLoading = false;
let eyeFailed = false;
let eyeLoadGeneration = 0;
let stream: MediaStream | null = null;
let running = false;
let paused = false;
let poseFailed = false;
let poseRetrying = false;
let lastDetectionAt = 0;
let lastEyeDetectionAt = 0;
const frameGate = new FrameGate();
let currentLandmarks: Landmark[] | null = null;
let currentFeatures: PostureFeatures | null = null;
let baseline: Baseline | null = null;
let calibrationSamples: PostureFeatures[] = [];
let calibrationStartedAt: number | null = null;
let session: SessionLedger | null = null;
let calibrationValidMs = 0;
let lastCalibrationAt: number | null = null;
let lastClockReminderAt = 0;
let timerOnly = false;
let lastCause = "stable";
let lastDeviation: DeviationResult | null = null;
let lastMonitorOutput: MonitorOutput | null = null;
let observedCauses: string[] = [];
let startGeneration = 0;
let simulatedDriftUntil = 0;
let simulationOnly = false;
let stats = { reminders: 0, movements: 0 };
const monitor = new PostureMonitor(normalConfig);
const blinkMonitor = new BlinkMonitor();
const motionWindow = new PostureMotionWindow();
const observationScheduler = new ObservationScheduler(loop, () => document.hidden, handlePoseFailure);
let runtimePreferences: RuntimePreferences = { reminderMinutes: 30, driftMinutes: 0.5, snoozeUntil: null, quietHours: [], fontScale: 1 };
let audioContext: AudioContext | null = null;
const timerButton = document.createElement("button");
timerButton.className = "button secondary";
timerButton.textContent = "只用专注计时";
timerButton.id = "timerButton";
startButton.after(timerButton);
const retryPoseButton = document.createElement("button");
retryPoseButton.className = "button secondary";
retryPoseButton.textContent = "重新连接姿态观察";
retryPoseButton.hidden = true;
timerButton.after(retryPoseButton);
retryPoseButton.addEventListener("click", () => void retryPoseObservation());
const incorrectButton = document.createElement("button");
incorrectButton.className = "button quiet";
incorrectButton.textContent = "刚才已经动过";
byId("laterButton").after(incorrectButton);
byId("cameraNote").textContent = "开启摄像头后，画面仅在本机实时识别，结束时释放。用眼观察另行开启，启用后会分析面部眼部变化。";
sessionModal.classList.remove("modal-backdrop");
sessionModal.style.cssText = "position:relative;max-width:1140px;margin:24px auto;padding:16px";
byId("resetStatsButton").hidden = true;

interface SessionDraft {
  id: string;
  ledger: ReturnType<SessionLedger["snapshot"]>;
  eye: ReturnType<BlinkMonitor["snapshot"]>;
  stats: { reminders: number; movements: number };
  lastClockReminderAt: number;
}
const tabOwner = crypto.randomUUID();
const journal = new SessionJournal<SessionDraft>(localStorage, tabOwner);
const outbox = new SessionOutbox<ReturnType<SessionLedger["summary"]>>(localStorage, async payload => {
  const response = await fetch("/api/sessions", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(5000) });
  return response.ok;
});
let pendingResume: SessionDraft | null = null;
let lastDraftSavedAt = 0;
let draftErrorShown = false;
let restoringDraft = false;
let leavingDocument = false;
const recoveryPanel = document.createElement("section");
recoveryPanel.className = "session-recovery";
recoveryPanel.setAttribute("aria-label", "接续暂存记录");
recoveryPanel.hidden = true;
byId("cameraNote").after(recoveryPanel);

function saveSessionDraft(): void {
  if (!running || !session || simulationOnly) return;
  try {
    journal.save({ id: session.id, ledger: session.snapshot(), eye: blinkMonitor.snapshot(), stats: { ...stats }, lastClockReminderAt });
    if (leavingDocument) journal.release(session.id);
    lastDraftSavedAt = performance.now();
    draftErrorShown = false;
  } catch {
    if (!draftErrorShown) showToast("本机暂存遇到问题，请保留当前页面并在结束时确认保存结果");
    draftErrorShown = true;
  }
}

function validDraft(value: SessionDraft): boolean {
  const ledger = SessionLedger.restore(value.ledger, performance.now());
  const eyes = new BlinkMonitor();
  return !!ledger && ledger.id === value.id && eyes.restore(value.eye)
    && eyes.snapshot().validMs <= ledger.durationMs
    && [value.stats?.reminders, value.stats?.movements].every(n => Number.isInteger(n) && n >= 0 && n <= 1_000_000)
    && Number.isFinite(value.lastClockReminderAt) && value.lastClockReminderAt >= 0 && value.lastClockReminderAt <= ledger.durationMs;
}

function renderRecoveryPanel(): void {
  recoveryPanel.replaceChildren();
  if (running || restoringDraft) { recoveryPanel.hidden = true; return; }
  let drafts;
  try { drafts = journal.available(); }
  catch { recoveryPanel.hidden = true; return; }
  recoveryPanel.hidden = drafts.length === 0;
  for (const draft of drafts) {
    const restored = SessionLedger.restore(draft.value.ledger, performance.now());
    if (!restored || !validDraft(draft.value) || restored.mode === "demo") continue;
    const row = document.createElement("div");
    const text = document.createElement("p");
    text.textContent = `${new Date(restored.startAt).toLocaleString()} · 已暂存 ${formatDuration(restored.durationMs)}。接续时从已保存时长开始，离开页面的时间留空。`;
    const resume = document.createElement("button"), finish = document.createElement("button");
    resume.className = finish.className = "button secondary";
    resume.textContent = "接续这段专注";
    finish.textContent = "保存为已结束";
    resume.addEventListener("click", async () => {
      if (running || restoringDraft) return;
      let claimed;
      try { claimed = journal.claim(draft.value.id); }
      catch { showToast("暂存记录读取受阻，请保留当前页面"); return; }
      if (!claimed) { showToast("这段专注正在其他页面使用"); renderRecoveryPanel(); return; }
      if (!validDraft(claimed.value)) { showToast("暂存记录格式待检查"); return; }
      pendingResume = claimed.value;
      restoringDraft = true; renderRecoveryPanel();
      try {
        if (restored.mode === "camera") await startCamera();
        else timerButton.click();
      } finally { pendingResume = null; restoringDraft = false; renderRecoveryPanel(); }
      if (running) showToast(restored.mode === "camera" ? "已接续记录，请重新记录此刻舒服的坐姿" : "已接续专注计时");
    });
    finish.addEventListener("click", async () => {
      if (running || restoringDraft) return;
      finish.disabled = true;
      try {
        const claimed = journal.claim(draft.value.id);
        if (!claimed) throw new Error("这段专注正在其他页面使用");
        const saved = SessionLedger.restore(claimed.value.ledger, performance.now());
        const eyes = new BlinkMonitor();
        if (!saved || !validDraft(claimed.value) || !eyes.restore(claimed.value.eye)) throw new Error("暂存记录格式待检查");
        const eye = eyes.summary();
        const payload = saved.summary(claimed.value.stats.reminders, claimed.value.stats.movements, eye.blinkCount, eye.validMinutes * 60_000);
        payload.endAt = new Date(claimed.savedAt).toISOString();
        outbox.enqueue(payload);
        journal.remove(saved.id);
        await retryPendingSessions();
        showToast(outbox.list().some(item => item.id === saved.id) ? "摘要已暂存，服务恢复后自动补存" : "上次的摘要已保存");
      } catch (error) { showToast(error instanceof Error ? error.message : "暂存记录读取受阻"); }
      finally { finish.disabled = false; renderRecoveryPanel(); }
    });
    row.append(text, resume, finish); recoveryPanel.append(row);
  }
}

function handlePoseFailure(_error: unknown): void {
  poseFailed = true;
  observationScheduler.stop();
  interruptObservation();
  retryPoseButton.hidden = false;
  byId("cameraNote").textContent = "姿态观察连接中断，专注计时继续。可以重新连接摄像头与观察模型。";
  syncEyeStatus();
  showToast("姿态观察待恢复，已保留本次记录");
}

async function retryPoseObservation(): Promise<void> {
  if (!running || timerOnly || simulationOnly || poseRetrying) return;
  poseRetrying = true; retryPoseButton.disabled = true;
  releaseCamera();
  poseFailed = true;
  const generation = startGeneration;
  let pending: PoseDetector | null = null;
  try {
    const next = await navigator.mediaDevices.getUserMedia({ audio: false, video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" } });
    if (!running || generation !== startGeneration) { next.getTracks().forEach(track => track.stop()); return; }
    stream = next; video.srcObject = next; await video.play();
    if (!running || generation !== startGeneration) return;
    pending = new PoseDetector(); await pending.initialize();
    if (!running || generation !== startGeneration) { pending.close(); return; }
    detector = pending; pending = null;
    watchCameraTracks(next);
    baseline = null; calibrationStartedAt = null; calibrationPanel.hidden = true;
    monitor.reset(performance.now()); poseFailed = false; retryPoseButton.hidden = true;
    calibrateButton.disabled = false;
    await initializeEyeTracking();
    if (!running || generation !== startGeneration) return;
    observationScheduler.start();
    byId("cameraNote").textContent = "观察已恢复，请重新记录舒服的坐姿。此前的专注记录继续保留。";
  } catch (error) { pending?.close(); if (running && generation === startGeneration) handlePoseFailure(error); }
  finally { poseRetrying = false; retryPoseButton.disabled = false; }
}

function watchCameraTracks(camera: MediaStream): void {
  for (const track of camera.getVideoTracks()) track.addEventListener("ended", () => {
    if (running && stream === camera) handlePoseFailure(new Error("camera ended"));
  }, { once: true });
}

function normalRuntimeConfig() {
  return { ...normalConfig, stillDurationMs: runtimePreferences.reminderMinutes * 60_000, driftDurationMs: runtimePreferences.driftMinutes * 60_000 };
}

function refreshObservationView(): void {
  if (lastMonitorOutput?.observedDrift && lastDeviation?.activeCauses.length) observedCauses = lastDeviation.activeCauses;
  if (!lastMonitorOutput?.observedDrift) observedCauses = [];
  renderObservation({ running, paused, background: document.hidden, timer: timerOnly, demo: simulationOnly,
    calibrated: Boolean(baseline), calibrating: calibrationStartedAt !== null, valid: Boolean(currentFeatures), failed: poseFailed,
    hasHips: Boolean(currentFeatures?.hasHips && (!baseline || baseline.mean.hasHips)), changes: observedCauses, position: lastDeviation?.position,
    elapsedMs: lastMonitorOutput?.driftElapsedMs ?? 0,
    thresholdMs: simulationOnly ? demoConfig.driftDurationMs : runtimePreferences.driftMinutes * 60_000,
    cooldownMs: lastMonitorOutput?.cooldownRemainingMs ?? 0,
    quiet: isQuiet(runtimePreferences), reminderVisible: !reminderModal.hidden });
}

function syncEyeStatus(): void {
  if (!preferences.eyeTracking) setEyeStatus("off");
  else if (eyeLoading) setEyeStatus("loading");
  else if (eyeFailed) setEyeStatus("error", "可以点击重新加载用眼观察再试一次");
  else if (eyeDetector) setEyeStatus(paused || poseFailed ? "paused" : "running", document.hidden ? "后台采样随浏览器调度，画面稀疏时暂停眨眼统计" : undefined);
  else setEyeStatus("waiting", timerOnly || simulationOnly ? "当前采用计时或演示模式" : undefined);
}

function applyRuntimePreferences(detail: Partial<RuntimePreferences>): void {
  const intervalsChanged = (detail.reminderMinutes !== undefined && detail.reminderMinutes !== runtimePreferences.reminderMinutes)
    || (detail.driftMinutes !== undefined && detail.driftMinutes !== runtimePreferences.driftMinutes);
  runtimePreferences = { ...runtimePreferences, ...detail };
  if (intervalsChanged) {
    monitor.setConfig(simulationOnly ? demoConfig : normalRuntimeConfig());
    if (paused) monitor.setPaused(true);
  }
  if (isQuiet(runtimePreferences)) {
    reminderModal.hidden = true;
    monitor.cancelPendingReminder();
    window.speechSynthesis?.cancel();
  }
  refreshObservationView();
}
window.addEventListener("zbx:preferences", (event) => applyRuntimePreferences((event as CustomEvent<Partial<RuntimePreferences>>).detail));
window.addEventListener("zbx:request-session", () => {
  window.dispatchEvent(new CustomEvent("zbx:session", { detail: running && session ? { id: session.id, mode: session.mode } : { id: null, mode: null } }));
});
void fetch("/api/dashboard").then(response => response.ok ? response.json() : null).then(data => {
  if (data?.preferences) applyRuntimePreferences(data.preferences);
}).catch(() => {});

function interruptObservation(): void {
  session?.interrupt();
  blinkMonitor.interrupt();
  motionWindow.reset();
  currentFeatures = null;
  currentLandmarks = null;
  lastCalibrationAt = null;
  lastMonitorOutput = monitor.update({ timestamp: performance.now(), hasPose: false, drifted: false, motion: 0 });
  refreshObservationView();
}

function startSession(mode: SessionMode): void {
  const resumed = pendingResume?.ledger.mode === mode ? SessionLedger.restore(pendingResume.ledger, performance.now()) : null;
  session = resumed ?? new SessionLedger(mode, performance.now());
  stats = resumed && pendingResume ? { ...pendingResume.stats } : { reminders: 0, movements: 0 };
  lastMonitorOutput = null;
  lastDeviation = null;
  observedCauses = [];
  paused = false;
  running = true;
  timerOnly = mode === "timer";
  simulationOnly = mode === "demo";
  blinkMonitor.reset();
  if (resumed && pendingResume) blinkMonitor.restore(pendingResume.eye);
  motionWindow.reset();
  baseline = null;
  monitor.setConfig(simulationOnly ? demoConfig : normalRuntimeConfig());
  lastClockReminderAt = resumed && pendingResume ? Math.min(pendingResume.lastClockReminderAt, session.durationMs) : 0;
  frameGate.reset();
  sessionModal.hidden = true;
  reminderModal.hidden = true;
  pauseButton.disabled = false;
  pauseButton.textContent = "Ⅱ";
  endSessionButton.disabled = false;
  demoToggle.checked = simulationOnly;
  demoToggle.disabled = true;
  startButton.disabled = true;
  timerButton.disabled = true;
  simulateButton.disabled = !simulationOnly;
  window.dispatchEvent(new CustomEvent("zbx:session", { detail: { id: session.id, mode } }));
  byId("sessionTime").textContent = formatDuration(session.durationMs);
  byId("reminderCount").textContent = String(stats.reminders);
  byId("movementCount").textContent = String(stats.movements);
  syncEyeStatus();
  recoveryPanel.hidden = true;
  saveSessionDraft();
}

function releaseCamera(): void {
  startGeneration += 1;
  eyeLoadGeneration += 1;
  eyeLoading = false;
  eyeFailed = false;
  observationScheduler.stop();
  poseFailed = false;
  retryPoseButton.hidden = true;
  stream?.getTracks().forEach(track => track.stop());
  stream = null;
  video.srcObject = null;
  detector?.close(); detector = null;
  eyeDetector?.close(); eyeDetector = null;
  frameGate.reset();
  currentLandmarks = null;
  currentFeatures = null;
  drawPose(null);
  syncEyeStatus();
}

async function recordFeedback(text: string): Promise<void> {
  if (session?.mode === "demo") return;
  try {
    const response = await fetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, sessionId: session?.id ?? null }) });
    if (!response.ok) throw new Error("save failed");
    window.dispatchEvent(new CustomEvent("zbx:refresh"));
  } catch { showToast("反馈暂存失败，请稍后在随手记中补充"); }
}

const connections: Array<[number, number]> = [
  [0, 11], [0, 12], [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
];

function showToast(message: string): void {
  const toast = byId<HTMLDivElement>("toast");
  toast.textContent = message;
  toast.classList.add("visible");
  window.setTimeout(() => toast.classList.remove("visible"), 2600);
}

function storePreferences(): void {
  savePreferences(preferences);
}

function renderPreferences(): void {
  applyTheme(preferences.theme);
  soundToggle.checked = preferences.sound;
  voiceToggle.checked = preferences.voice;
  notificationToggle.checked = preferences.notifications;
  eyeToggle.checked = preferences.eyeTracking;
  settingsDrawer.querySelectorAll<HTMLButtonElement>("button.theme-option[data-theme]").forEach((button) => {
    const selected = button.dataset.theme === preferences.theme;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  setNotificationStatus(preferences.notifications);
  refreshVoiceStatus(preferences.voice);
}

function openSettings(): void {
  settingsBackdrop.hidden = false;
  settingsDrawer.classList.add("open");
  settingsDrawer.setAttribute("aria-hidden", "false");
}

function closeSettings(): void {
  settingsBackdrop.hidden = true;
  settingsDrawer.classList.remove("open");
  settingsDrawer.setAttribute("aria-hidden", "true");
}

function prepareAudio(): void {
  if (!audioContext) audioContext = new AudioContext();
  if (audioContext.state === "suspended") void audioContext.resume();
}

function playChime(preview = false): void {
  if (!preview && !preferences.sound) return;
  prepareAudio();
  if (!audioContext) return;
  const now = audioContext.currentTime;
  const gain = audioContext.createGain();
  const oscillator = audioContext.createOscillator();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(523.25, now);
  oscillator.frequency.exponentialRampToValueAtTime(659.25, now + 0.22);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.16, now + 0.035);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.48);
  oscillator.connect(gain).connect(audioContext.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.5);
}

function showDesktopNotification(title: string, body: string): void {
  if (!preferences.notifications || !("Notification" in window)) return;
  if (Notification.permission !== "granted" || !document.hidden) return;
  try {
    const notification = new Notification(title, { body, tag: "zuobiaoxi-reminder" });
    notification.addEventListener("click", () => { window.focus(); notification.close(); });
  } catch {
    byId("notificationSettingStatus").textContent = "系统通知暂时未送达，可检查浏览器权限或使用声音提醒";
  }
}

async function initializeEyeTracking(): Promise<void> {
  if (!preferences.eyeTracking || simulationOnly || timerOnly || eyeDetector || eyeLoading || !stream) { syncEyeStatus(); return; }
  const generation = startGeneration;
  const eyeGeneration = ++eyeLoadGeneration;
  eyeLoading = true;
  eyeFailed = false;
  setEyeStatus("loading");
  const pending = new FaceEyeDetector();
  try {
    await pending.initialize();
    if (generation !== startGeneration || eyeGeneration !== eyeLoadGeneration || !preferences.eyeTracking) { pending.close(); return; }
    eyeDetector = pending;
    syncEyeStatus();
    showToast("用眼观察已开始");
  } catch (error) {
    console.error(error);
    pending.close();
    if (eyeGeneration === eyeLoadGeneration) {
      eyeFailed = true;
      setEyeStatus("error", "模型加载暂时受阻，可以点击重新准备");
      showToast("用眼观察准备失败，可以在设置里重试");
    }
  } finally {
    if (eyeGeneration === eyeLoadGeneration) { eyeLoading = false; syncEyeStatus(); }
  }
}

const clockTimer = window.setInterval(() => {
  if (!running || !session) return;
  session.tick(performance.now(), !paused);
  if (performance.now() - lastDraftSavedAt >= 5000) saveSessionDraft();
  if (isQuiet(runtimePreferences)) {
    reminderModal.hidden = true;
    monitor.cancelPendingReminder();
    window.speechSynthesis?.cancel();
  }
  byId("sessionTime").textContent = formatDuration(session.durationMs);
  byId("reminderCount").textContent = String(stats.reminders);
  byId("movementCount").textContent = String(stats.movements);
  if (paused || simulationOnly) return;
  if (session.durationMs - lastClockReminderAt >= runtimePreferences.reminderMinutes * 60_000) {
    showReminder("still", true);
  }
  refreshObservationView();
}, 1_000);

mountDeviceSettings({ onTestSound: () => playChime(true), onTestVoice: () => announce("活动一下，让肩膀放松片刻。"), onRetryEye: initializeEyeTracking });
mountObservationDetails();
renderPreferences();
syncEyeStatus();
refreshObservationView();

function setStatus(state: MonitorState, progress = 0): void {
  const copy = stateCopy[state];
  const card = byId<HTMLElement>("statusCard");
  card.dataset.state = state;
  byId("statusTitle").textContent = copy.title;
  byId("statusDescription").textContent = copy.description;
  byId("stageStatus").innerHTML = `<span></span>${copy.title}`;
  byId("progressBar").style.width = `${Math.round(progress * 100)}%`;
  byId("progressLabel").textContent =
    state === "drift-pending" ? `${Math.round(progress * 100)}%` :
    state === "monitoring" ? "稳定观察中" :
    state === "cooldown" ? "已记录变化" :
    state === "not-visible" ? "等待重新取景" :
    state === "reminder-drift" || state === "reminder-still" ? "提醒已送达" :
    state === "paused" ? "观察已暂停" : "准备开始";
  refreshObservationView();
}

function drawPose(landmarks: Landmark[] | null): void {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
    canvas.width = width * dpr;
    canvas.height = height * dpr;
  }
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);
  if (!landmarks) return;

  context.lineWidth = 3;
  const rootStyles = getComputedStyle(document.documentElement);
  context.strokeStyle = rootStyles.getPropertyValue("--skeleton").trim() || "#FFB86B";
  context.fillStyle = rootStyles.getPropertyValue("--skeleton-dot").trim() || "#FFF4DA";
  context.shadowColor = rootStyles.getPropertyValue("--skeleton-glow").trim() || "rgba(255, 184, 107, .55)";
  context.shadowBlur = 10;

  for (const [from, to] of connections) {
    const a = landmarks[from];
    const b = landmarks[to];
    if (!a || !b || (a.visibility ?? 1) < 0.45 || (b.visibility ?? 1) < 0.45) continue;
    context.beginPath();
    context.moveTo(a.x * width, a.y * height);
    context.lineTo(b.x * width, b.y * height);
    context.stroke();
  }
  for (const index of [0, 11, 12, 13, 14, 15, 16, 23, 24]) {
    const landmark = landmarks[index];
    if (!landmark || (landmark.visibility ?? 1) < 0.45) continue;
    context.beginPath();
    context.arc(landmark.x * width, landmark.y * height, 4.5, 0, Math.PI * 2);
    context.fill();
  }
  context.shadowBlur = 0;
}

async function startCamera(): Promise<void> {
  if (running) return;
  prepareAudio();
  releaseCamera();
  const generation = startGeneration;
  simulationOnly = false;
  timerOnly = false;
  startButton.disabled = true;
  timerButton.disabled = true;
  simulateButton.disabled = true;
  startButton.textContent = "正在准备本地模型…";
  try {
    const grantedStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
    });
    if (generation !== startGeneration) { grantedStream.getTracks().forEach(track => track.stop()); return; }
    stream = grantedStream;
    watchCameraTracks(grantedStream);
    video.srcObject = stream;
    await video.play();
    if (generation !== startGeneration) return;
    const pendingDetector = new PoseDetector();
    try { await pendingDetector.initialize(); }
    catch (error) { pendingDetector.close(); throw error; }
    if (generation !== startGeneration) { pendingDetector.close(); return; }
    detector = pendingDetector;
    await initializeEyeTracking();
    if (generation !== startGeneration) return;
    startSession("camera");
    byId("stagePlaceholder").hidden = true;
    byId("stagePlaceholder").innerHTML = "<h3>摄像头画面已释放</h3><p>开启新的专注时段后继续观察。</p>";
    startButton.textContent = "摄像头已开启";
    calibrateButton.disabled = false;
    pauseButton.disabled = false;
    endSessionButton.disabled = false;
    byId("modeBadge").textContent = "摄像头观察";
    setStatus("not-visible");
    observationScheduler.start();
  } catch (error) {
    console.error(error);
    releaseCamera();
    startButton.disabled = false;
    timerButton.disabled = false;
    simulateButton.disabled = false;
    startButton.textContent = "再次连接摄像头";
    byId("cameraNote").textContent = "请检查摄像头权限或模型加载情况，也可以选择专注计时。";
    showToast("摄像头正在等待浏览器权限");
  }
}

function startCalibration(): void {
  if (!currentFeatures) {
    showToast("正在等待清晰画面，请让头部和双肩进入取景框");
    return;
  }
  calibrationSamples = [];
  calibrationStartedAt = performance.now();
  calibrationValidMs = 0;
  lastCalibrationAt = null;
  calibrationPanel.hidden = false;
  calibrateButton.disabled = true;
  byId("cameraNote").textContent = "按平时最舒服的样子坐好，保持十秒即可。";
}

function updateCalibration(timestamp: number): void {
  if (calibrationStartedAt === null) return;
  const valid = currentFeatures && currentFeatures.confidence >= 0.6;
  if (valid && lastCalibrationAt !== null && timestamp - lastCalibrationAt <= 500) calibrationValidMs += timestamp - lastCalibrationAt;
  lastCalibrationAt = valid ? timestamp : null;
  const remaining = Math.max(0, 10 - Math.floor(calibrationValidMs / 1000));
  byId("calibrationNumber").textContent = String(remaining);
  if (valid && currentFeatures) calibrationSamples.push(currentFeatures);
  if (calibrationSamples.length > 300) calibrationSamples.shift();

  if (calibrationValidMs >= 10_000 || timestamp - calibrationStartedAt > 45_000) {
    calibrationStartedAt = null;
    calibrationPanel.hidden = true;
    calibrateButton.disabled = false;
    if (calibrationValidMs < 10_000 || calibrationSamples.length < 30) {
      showToast("画面有效时间较短，让头部和双肩保持完整可见后再试一次");
      return;
    }
    const quality = validateBaseline(calibrationSamples);
    if (!quality.valid) {
      showToast(quality.reason || "这段取景变化较大，请固定设备并保持自然坐姿后重试");
      return;
    }
    baseline = createBaseline(calibrationSamples);
    lastMonitorOutput = null;
    monitor.reset(timestamp);
    setStatus("monitoring");
    byId("cameraNote").textContent = "舒适坐姿已记录。移动设备或调整座椅后，可以再次记录。";
    showToast("舒适坐姿已记录");
  }
}

function showReminder(type: "drift" | "still", clockBased = false): void {
  if (!running || paused || isQuiet(runtimePreferences) || !reminderModal.hidden) return;
  lastClockReminderAt = session?.durationMs ?? 0;
  stats.reminders += 1;
  const title = type === "still" ? "活动一下吧" : "换个姿势松一松吧";
  const copy = clockBased ? "这段专注已持续一会儿。按计时提醒，可以放松双肩或稍作休息。"
    : type === "still"
    ? "身体保持同一姿势有一会儿了。活动肩膀，或慢慢换一个位置。"
    : `${lastCause === "closer" ? "画面中身体持续更靠近屏幕" : lastCause === "lower" ? "头部位置持续低于开始时的坐姿" : "姿态与开始时相比持续有些变化"}。可以缓慢放松双肩，换一个舒服的位置。`;
  byId("reminderTitle").textContent = title;
  byId("reminderCopy").textContent = type === "still"
    ? copy
    : copy;
  byId("reasonTip").textContent = "选择当下的感受，页面会给出更合适的建议。";
  reminderModal.hidden = false;
  playChime();
  if (preferences.voice) announce(type === "still" ? "坐了有一会儿，活动一下吧。" : "换个姿势松一松吧。");
  showDesktopNotification(title, copy);
}

function completeReminder(message: string): void {
  if (reminderModal.hidden) return;
  reminderModal.hidden = true;
  stats.movements += 1;
  lastClockReminderAt = session?.durationMs ?? 0;
  monitor.resolveReminder(performance.now());
  setStatus("cooldown");
  showToast(message);
  void recordFeedback("提醒反馈：已主动确认活动");
}

function loop(timestamp: number): void {
  if (!running || paused || timerOnly) return;
  if (timestamp - lastDetectionAt >= 80) {
    lastDetectionAt = timestamp;
    if (simulationOnly && baseline) {
      currentLandmarks = null;
      currentFeatures = baseline.mean;
      if (!document.hidden) drawPose(null);
    } else {
      const frame = frameGate.inspect(video.currentTime, timestamp, video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA);
      if (frame === "waiting") {
        return;
      }
      currentLandmarks = frame === "fresh" ? detector?.detect(video, timestamp) ?? null : null;
      currentFeatures = currentLandmarks ? extractPostureFeatures(currentLandmarks) : null;
      if (!document.hidden) drawPose(currentLandmarks);
    }
    updateCalibration(timestamp);

    if (
      preferences.eyeTracking &&
      eyeDetector &&
      currentFeatures &&
      !simulationOnly &&
      timestamp - lastEyeDetectionAt >= 65
    ) {
      lastEyeDetectionAt = timestamp;
      try {
        const eyes = eyeDetector.detect(video, timestamp);
        if (eyes) blinkMonitor.update(timestamp, eyes.left, eyes.right, eyes.confidence);
        else blinkMonitor.interrupt();
      } catch {
        eyeDetector.close(); eyeDetector = null;
        eyeFailed = true;
        blinkMonitor.interrupt();
        syncEyeStatus();
      }
    } else if (eyeDetector && !currentFeatures) blinkMonitor.interrupt();

    if (baseline && calibrationStartedAt === null && !paused) {
      const motion = currentLandmarks
        ? motionWindow.update(timestamp, currentLandmarks)
        : 0;
      const deviation = currentFeatures
        ? compareWithBaseline(currentFeatures, baseline)
        : null;
      const forcedDrift = timestamp < simulatedDriftUntil;
      lastDeviation = deviation;
      if (forcedDrift && lastDeviation) lastDeviation = { ...lastDeviation, activeCauses: ["side"] };
      lastCause = forcedDrift ? "side" : deviation?.cause ?? "stable";
      if (!simulationOnly) {
        session?.observe(timestamp, Boolean(currentFeatures), lastCause, motion >= normalConfig.movementThreshold, deviation?.activeCauses);
        if (!currentFeatures) motionWindow.reset();
      }
      const output = monitor.update({
        timestamp,
        hasPose: simulationOnly || Boolean(currentFeatures),
        drifted: forcedDrift || Boolean(deviation?.drifted),
        driftKind: lastCause,
        driftScore: forcedDrift ? 2 : deviation?.score,
        motion,
        remindersAllowed: !isQuiet(runtimePreferences),
      });
      lastMonitorOutput = output;
      setStatus(output.state, Math.max(output.driftProgress, output.stillProgress));
      if (output.reminder) showReminder(output.reminder);
    } else if (!baseline && calibrationStartedAt === null) {
      setStatus(currentFeatures ? "idle" : "not-visible");
    }
  }

  if (session) byId("sessionTime").textContent = formatDuration(session.durationMs);
  byId("reminderCount").textContent = String(stats.reminders);
  byId("movementCount").textContent = String(stats.movements);
}

async function showSessionSummary(): Promise<void> {
  if (!session || !running) return;
  session.tick(performance.now(), !paused);
  saveSessionDraft();
  running = false;
  releaseCamera();
  calibrationStartedAt = null;
  calibrationPanel.hidden = true;
  reminderModal.hidden = true;
  startButton.disabled = false;
  startButton.textContent = "开启摄像头";
  timerButton.disabled = false;
  demoToggle.disabled = false;
  simulateButton.disabled = false;
  calibrateButton.disabled = true;
  pauseButton.disabled = true;
  endSessionButton.disabled = true;
  byId("stagePlaceholder").hidden = false;
  byId("stagePlaceholder").innerHTML = "<h3>这段专注已结束</h3><p>本次摘要已整理，可以开始下一次或到个人记录里查看。</p>";
  byId("modeBadge").textContent = "已结束";
  byId("cameraNote").textContent = "摄像头与实时观察已结束，使用摘要保存在这台电脑。";
  setStatus("idle");
  const elapsed = session.durationMs;
  const eyeSummary = blinkMonitor.summary();
  byId("sessionSummaryTime").textContent = formatDuration(elapsed);
  byId("sessionSummaryMovements").textContent = String(stats.movements);
  byId("sessionSummaryBlinks").textContent = eyeSummary.blinksPerMinute === null
    ? "—"
    : eyeSummary.blinksPerMinute.toFixed(1);

  const summaryBox = byId<HTMLDivElement>("eyeSummary");
  summaryBox.classList.remove("attention");
  if (!preferences.eyeTracking) {
    summaryBox.innerHTML = "<b>想了解眨眼节奏</b><span>可以在设置中开启用眼观察，下次专注时一起记录。</span>";
  } else if (eyeSummary.validMinutes < 0.5) {
    summaryBox.innerHTML = "<b>有效观察时间正在积累</b><span>保持正脸和均匀光线，下一次小结会更完整。</span>";
  } else if (eyeSummary.showRestSuggestion) {
    summaryBox.classList.add("attention");
    summaryBox.innerHTML = "<b>这段时间眨眼节奏偏慢</b><span>接下来可以看看远处，轻轻闭眼休息片刻。</span>";
  } else {
    summaryBox.innerHTML = `<b>本次用眼观察</b><span>共记录 ${eyeSummary.blinkCount} 次眨眼，覆盖 ${eyeSummary.validMinutes.toFixed(1)} 分钟有效画面；采样结果供个人观察参考。</span>`;
  }
  sessionModal.hidden = false;
  sessionModal.scrollIntoView({ behavior: "smooth", block: "nearest" });
  window.dispatchEvent(new CustomEvent("zbx:session", { detail: { id: null, mode: null } }));
  const payload = session.summary(stats.reminders, stats.movements, eyeSummary.blinkCount, eyeSummary.validMinutes * 60_000);
  try {
    outbox.enqueue(payload);
    journal.remove(payload.id);
    await retryPendingSessions();
    showToast(outbox.list().some(item => item.id === payload.id) ? "本次摘要已暂存，服务恢复后自动补存" : "本次记录已保存，实时观察已结束");
  } catch {
    showToast("本次保存受阻，请保留页面与浏览器数据，可从暂存记录重试");
  }
  renderRecoveryPanel();
}

function continueSession(): void {
  sessionModal.hidden = true;
  startButton.focus();
}

startButton.addEventListener("click", startCamera);
calibrateButton.addEventListener("click", startCalibration);
endSessionButton.addEventListener("click", showSessionSummary);

pauseButton.addEventListener("click", () => {
  session?.tick(performance.now(), !paused);
  paused = !paused;
  interruptObservation();
  monitor.setPaused(paused);
  pauseButton.textContent = paused ? "▶" : "Ⅱ";
  pauseButton.setAttribute("aria-label", paused ? "继续检测" : "暂停检测");
  setStatus(paused ? "paused" : baseline ? "monitoring" : "idle");
  syncEyeStatus();
  saveSessionDraft();
});

demoToggle.addEventListener("change", () => {
  if (demoToggle.checked) simulateButton.click();
});

simulateButton.addEventListener("click", () => {
  if (running && !simulationOnly) return;
  prepareAudio();
  if (!running) {
    releaseCamera();
    startSession("demo");
    const synthetic: PostureFeatures = {
      shoulderTilt: 0,
      headOffsetX: 0,
      headOffsetY: -0.9,
      torsoLeanX: 0,
      bodyScale: 0.22,
      confidence: 1,
      hasHips: true,
    };
    baseline = {
      mean: synthetic,
      spread: { ...synthetic, shoulderTilt: 1, headOffsetX: 0.01, headOffsetY: 0.01, torsoLeanX: 0.01, bodyScale: 0.003, confidence: 0 },
      sampleCount: 80,
    };
    simulationOnly = true;
    demoToggle.checked = true;
    monitor.setConfig(demoConfig, performance.now());
    byId("modeBadge").textContent = "无摄像头演示";
    byId("modeBadge").classList.add("active");
    byId("stagePlaceholder").innerHTML = `
      <div class="simulation-graphic" aria-hidden="true"><i></i><i></i><i></i></div>
      <h3>无摄像头演示正在运行</h3>
      <p>当前画面使用模拟数据，用于展示完整提醒流程</p>`;
    byId("stagePlaceholder").hidden = false;
    startButton.disabled = true;
    startButton.textContent = "摄像头";
    calibrateButton.disabled = true;
    pauseButton.disabled = false;
    endSessionButton.disabled = false;
    simulateButton.textContent = "再次模拟持续偏离";
    byId("cameraNote").textContent = "当前记录标为演示数据。结束本次后可以开启真实摄像头。";
    observationScheduler.start();
  }
  simulatedDriftUntil = performance.now() + (demoToggle.checked ? 7_000 : 16_000);
  showToast("持续偏离模拟已开始，页面将按完整流程计时");
});

timerButton.addEventListener("click", () => {
  if (running) return;
  releaseCamera();
  startSession("timer");
  prepareAudio();
  calibrateButton.disabled = true;
  byId("modeBadge").textContent = "专注计时";
  byId("stagePlaceholder").innerHTML = "<h3>专注计时已开始</h3><p>按设定时长提醒活动，使用结束后可以记录身体感受。</p>";
  byId("stagePlaceholder").hidden = false;
  byId("cameraNote").textContent = "当前记录包含计时和主动反馈，姿态与用眼观察为空。";
  byId("statusTitle").textContent = "安心专注";
  byId("statusDescription").textContent = "按个人提醒间隔计时，后台计时可能受浏览器调度影响。";
});

byId("doneButton").addEventListener("click", () => completeReminder("已记录一次主动调整"));
byId("laterButton").addEventListener("click", () => {
  reminderModal.hidden = true;
  monitor.resolveReminder(performance.now());
  lastClockReminderAt = session?.durationMs ?? 0;
  void recordFeedback("提醒反馈：稍后再提醒");
  showToast("稍后再提醒");
});
byId("modalClose").addEventListener("click", () => {
  reminderModal.hidden = true;
  monitor.resolveReminder(performance.now());
  lastClockReminderAt = session?.durationMs ?? 0;
});
incorrectButton.addEventListener("click", () => {
  reminderModal.hidden = true;
  monitor.resolveReminder(performance.now());
  lastClockReminderAt = session?.durationMs ?? 0;
  void recordFeedback("提醒反馈：刚才已经动过；本次提醒由用户标记为误提醒");
  showToast("已记下这次误提醒反馈");
});

document.querySelectorAll<HTMLButtonElement>("[data-reason]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-reason]").forEach((item) => item.classList.remove("selected"));
    button.classList.add("selected");
    const reason = button.dataset.reason;
    void recordFeedback(`提醒时的感受：${button.textContent?.trim() ?? ""}`);
    byId("reasonTip").textContent =
      reason === "clarity" ? "可以先放大文字、提高对比度或调近屏幕，再选择舒服的坐姿。" :
      reason === "tired" ? "试试调整靠背和支撑；出现持续疼痛时，请咨询专业人员。" :
      "专注感受已记录，可以在个人设置里调整提醒间隔。";
  });
});


byId("settingsButton").addEventListener("click", openSettings);
byId("settingsClose").addEventListener("click", closeSettings);
settingsBackdrop.addEventListener("click", closeSettings);

settingsDrawer.querySelectorAll<HTMLButtonElement>("button.theme-option[data-theme]").forEach((button) => {
  button.addEventListener("click", () => {
    preferences.theme = button.dataset.theme as Preferences["theme"];
    renderPreferences();
    storePreferences();
  });
});

soundToggle.addEventListener("change", () => {
  preferences.sound = soundToggle.checked;
  if (preferences.sound) {
    prepareAudio();
    playChime();
  }
  storePreferences();
});

voiceToggle.addEventListener("change", () => {
  preferences.voice = voiceToggle.checked;
  storePreferences();
  if (preferences.voice) announce("语音提示已开启");
  refreshVoiceStatus(preferences.voice);
});

notificationToggle.addEventListener("change", async () => {
  if (!notificationToggle.checked) {
    preferences.notifications = false;
    storePreferences();
    setNotificationStatus(false);
    return;
  }
  if (!("Notification" in window)) {
    notificationToggle.checked = false;
    showToast("当前浏览器更适合使用声音提醒");
    setNotificationStatus(false);
    return;
  }
  let permission: NotificationPermission = "default";
  notificationToggle.disabled = true;
  try { permission = await Notification.requestPermission(); }
  catch { showToast("系统通知暂未获得授权，可以查看浏览器的网站权限"); }
  finally { notificationToggle.disabled = false; }
  preferences.notifications = permission === "granted";
  notificationToggle.checked = preferences.notifications;
  storePreferences();
  setNotificationStatus(preferences.notifications);
  showToast(preferences.notifications ? "桌面通知已开启" : "桌面通知保持关闭");
});

eyeToggle.addEventListener("change", async () => {
  preferences.eyeTracking = eyeToggle.checked;
  storePreferences();
  if (!preferences.eyeTracking) {
    eyeLoadGeneration += 1;
    eyeLoading = false;
    eyeFailed = false;
    eyeDetector?.close();
    eyeDetector = null;
    blinkMonitor.interrupt();
    showToast("用眼观察已暂停");
    setEyeStatus("off");
    return;
  }
  if (simulationOnly) {
    showToast("切换到真实摄像头后，用眼观察会自动开始");
    syncEyeStatus();
    return;
  }
  if (running && !timerOnly) await initializeEyeTracking();
  else syncEyeStatus();
});

byId("sessionClose").addEventListener("click", continueSession);
byId("continueButton").addEventListener("click", continueSession);
byId("finishButton").addEventListener("click", () => {
  sessionModal.hidden = true;
  showToast("可以在个人记录中查看本次摘要");
});

document.addEventListener("visibilitychange", () => {
  session?.tick(performance.now(), running && !paused);
  saveSessionDraft();
  observationScheduler.wake();
  syncEyeStatus();
  refreshObservationView();
  if (!document.hidden) void retryPendingSessions();
  if (!document.hidden && running && baseline) {
    showToast("姿态观察已回到前台");
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeSettings();
    if (!reminderModal.hidden) {
      reminderModal.hidden = true;
      monitor.resolveReminder(performance.now());
    }
  }
});

window.addEventListener("beforeunload", () => {
  leavingDocument = true;
  session?.tick(performance.now(), running && !paused);
  saveSessionDraft();
  if (running && session) { try { journal.release(session.id); } catch { /* Last durable checkpoint remains. */ } }
  observationScheduler.stop();
  window.clearInterval(clockTimer);
  window.clearInterval(retryTimer);
  stream?.getTracks().forEach((track) => track.stop());
  detector?.close();
  eyeDetector?.close();
  void audioContext?.close();
});

mountAgentPanel();

async function retryPendingSessions(): Promise<void> {
  try { if (await outbox.flush()) window.dispatchEvent(new CustomEvent("zbx:refresh")); }
  catch { /* Preserve malformed entries for manual recovery. */ }
}
void retryPendingSessions();
window.addEventListener("online", () => void retryPendingSessions());
window.addEventListener("focus", () => { void retryPendingSessions(); renderRecoveryPanel(); });
window.addEventListener("pagehide", () => {
  leavingDocument = true;
  session?.tick(performance.now(), running && !paused);
  saveSessionDraft();
  if (running && session) { try { journal.release(session.id); } catch { /* Keep the previous checkpoint. */ } }
});
window.addEventListener("pageshow", () => {
  leavingDocument = false;
  if (running && session && journal.read(session.id)?.owner === journal.owner) {
    saveSessionDraft();
    if (!timerOnly && !poseFailed) observationScheduler.start();
  }
  renderRecoveryPanel();
});
window.addEventListener("storage", event => {
  if (running && session && event.key === `zbx-draft:${session.id}` && event.newValue) {
    const draft = journal.read(session.id);
    if (draft && draft.owner !== journal.owner) {
      running = false; paused = true; session = null;
      releaseCamera(); reminderModal.hidden = true;
      startButton.disabled = timerButton.disabled = demoToggle.disabled = simulateButton.disabled = false;
      startButton.textContent = "开启摄像头";
      endSessionButton.disabled = calibrateButton.disabled = pauseButton.disabled = true;
      window.dispatchEvent(new CustomEvent("zbx:session", { detail: { id: null, mode: null } }));
      refreshObservationView(); showToast("这段记录已在另一个页面接续，当前页面可以开始新专注");
    }
  }
  renderRecoveryPanel();
});
const retryTimer = window.setInterval(() => { void retryPendingSessions(); if (!running) renderRecoveryPanel(); }, 30_000);
renderRecoveryPanel();
