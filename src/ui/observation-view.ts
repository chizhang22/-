import "./observation-view.css";

export interface ObservationView {
  running: boolean;
  paused: boolean;
  background: boolean;
  timer: boolean;
  demo: boolean;
  calibrated: boolean;
  calibrating: boolean;
  valid: boolean;
  hasHips: boolean;
  changes: string[];
  position?: string;
  elapsedMs: number;
  thresholdMs: number;
  cooldownMs: number;
  quiet: boolean;
  reminderVisible: boolean;
  recovered?: boolean;
  failed?: boolean;
}
const seconds = (ms: number) => `${Math.floor(Math.max(0, ms) / 1000)} 秒`;
const labels: Record<string, string> = {
  closer: "身体更靠近屏幕", lower: "头部位置下移", side: "头肩向一侧倾斜",
  torso: "躯干侧倾", turn: "身体转向发生变化", headRoll: "头部向一侧倾斜",
};

export function describeObservation(view: ObservationView) {
  const change = view.changes.map(key => labels[key] || "姿态发生变化").join("、");
  const title = !view.running ? "准备开始" : view.paused ? "观察已暂停" : view.timer ? "专注计时中"
    : view.failed ? "姿态观察待恢复" : view.calibrating ? "正在记住舒服的坐姿" : !view.valid ? "画面待恢复"
    : !view.calibrated ? "可以记录舒服的坐姿了" : change || (view.position && view.position !== "stable" ? "身体在画面中的位置变了" : "与开始时的坐姿接近");
  const measurementAvailable = view.running && !view.timer && !view.paused && !view.failed && view.valid;
  const quality = view.demo ? "演示数据，用于检查提醒流程" : !measurementAvailable ? "等待有效摄像头画面"
    : view.hasHips ? "头肩与髋部可见，可观察躯干侧倾" : "头肩可见；髋部暂未入镜，躯干侧倾范围有限";
  const reason = !view.running ? "开启摄像头或专注计时后开始" : view.paused ? "暂停期间保留记录，观察计时暂停"
    : view.failed ? "专注计时继续，可点击重新连接姿态观察"
    : view.quiet ? "免打扰生效，观察继续，提醒暂缓"
    : view.cooldownMs > 0 ? `上次提醒后的缓冲还剩 ${seconds(Math.ceil(view.cooldownMs / 1000) * 1000)}，姿态变化继续显示`
    : view.reminderVisible ? "提醒已显示，可选择活动或稍后再说" : view.timer ? "按个人设置的活动间隔提醒"
    : !view.valid ? "画面缺失时暂停姿态累计；专注计时继续"
    : !view.calibrated ? "先记录一段自然坐姿，之后比较变化" : view.background ? "后台正在采样，按有效画面累计；浏览器休眠期间暂停观察" : view.changes.length ? "正在累计持续变化，达到设定时间后提醒"
    : view.elapsedMs > 0 ? "正在确认姿态变化，计时会随有效画面更新" : "当前按个人节奏观察";
  return { title, quality, reason,
    duration: view.calibrated && !view.timer ? `${seconds(view.elapsedMs)} / ${seconds(view.thresholdMs)}` : "—",
    position: view.position && view.position !== "stable" ? "画面中的整体位置有变化，单独记录" : "位置较稳定",
  };
}

export function mountObservationDetails(): void {
  const card = document.getElementById("statusCard");
  if (!card || document.getElementById("observationDetails")) return;
  card.insertAdjacentHTML("beforeend", `<details id="observationDetails" class="observation-details"><summary>查看观察详情</summary><dl><dt>画面范围</dt><dd id="observationQuality">等待摄像头画面</dd><dt>持续变化 / 提醒时间</dt><dd id="observationDuration">—</dd><dt>身体位置</dt><dd id="observationPosition">等待画面</dd><dt>提醒状态</dt><dd id="observationReason">准备开始</dd></dl></details>`);
}

export function renderObservation(view: ObservationView): void {
  const copy = describeObservation(view);
  const set = (id: string, value: string) => { const el = document.getElementById(id); if (el) el.textContent = value; };
  set("statusTitle", copy.title);
  set("statusDescription", copy.reason);
  set("progressLabel", copy.duration);
  set("observationQuality", copy.quality);
  set("observationDuration", copy.duration);
  set("observationPosition", copy.position);
  set("observationReason", copy.reason);
  const stage = document.getElementById("stageStatus");
  if (stage) stage.textContent = copy.title;
  const bar = document.getElementById("progressBar");
  if (bar) bar.style.width = `${Math.min(100, view.thresholdMs > 0 ? view.elapsedMs / view.thresholdMs * 100 : 0)}%`;
}
