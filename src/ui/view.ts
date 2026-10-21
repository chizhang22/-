import type { MonitorState } from "../pose/types";

export const stateCopy: Record<MonitorState, { title: string; description: string }> = {
  idle: { title: "准备好了", description: "先记录一段你平时最舒服的坐姿。" },
  "not-visible": { title: "重新取景", description: "让头部和双肩回到画面中央。" },
  monitoring: { title: "正在观察", description: "保持自己的节奏，身体变化会被轻轻记录。" },
  "drift-pending": { title: "确认变化中", description: "系统正在分辨短暂动作和持续姿势。" },
  "reminder-drift": { title: "换个姿势吧", description: "这个姿势保持了一会儿，可以松一松了。" },
  "reminder-still": { title: "活动一下吧", description: "身体保持同一姿势有一会儿了。" },
  cooldown: { title: "舒服多了", description: "这次变化已经记下，继续保持自己的节奏。" },
  paused: { title: "观察已暂停", description: "准备继续时，点击播放按钮即可。" },
};

export function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function announce(text: string): void {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "zh-CN";
  utterance.rate = 0.92;
  window.speechSynthesis.speak(utterance);
}
