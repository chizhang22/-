import './device-settings.css';

export type EyeSettingState = 'off' | 'waiting' | 'loading' | 'running' | 'paused' | 'error';
type DeviceSettingsActions = {
  onTestSound: () => void;
  onTestVoice: () => void;
  onRetryEye: () => Promise<void>;
};

const eyeMessages: Record<EyeSettingState, string> = {
  off: '用眼观察已关闭',
  waiting: '已开启，启动摄像头后开始观察',
  loading: '正在准备用眼观察…',
  running: '用眼观察运行中，本次结束时汇总',
  paused: '用眼观察已暂停，恢复专注后继续',
  error: '用眼观察加载失败，可点击重试',
};

export function eyeStatusText(state: EyeSettingState, detail?: string): string {
  return detail ? `${eyeMessages[state]}。${detail}` : eyeMessages[state];
}

export function notificationStatusText(
  supported: boolean,
  permission: NotificationPermission,
  enabled: boolean,
): string {
  if (!supported) return '当前环境暂未提供桌面通知，可在独立的 Chrome 或 Edge 窗口打开本机页面，或使用声音提醒';
  if (permission === 'denied') return '浏览器已拦截通知。点击地址栏左侧的网站设置，将通知权限改为允许后，重新开启此选项';
  if (permission === 'default') return '开启后浏览器会询问通知权限，请选择允许';
  return enabled ? '桌面通知已开启，显示效果也受系统专注模式影响' : '浏览器已允许通知，开启此选项后发送提醒';
}

function setStatus(id: string, text: string): void {
  const element = document.getElementById(id);
  if (element && element.textContent !== text) element.textContent = text;
}

export function setEyeStatus(state: EyeSettingState, detail?: string): void {
  setStatus('eyeSettingStatus', eyeStatusText(state, detail));
  const retry = document.getElementById('retryEyeButton') as HTMLButtonElement | null;
  if (retry) retry.hidden = state !== 'error';
}

export function setNotificationStatus(enabled: boolean): void {
  const supported = 'Notification' in window && window.isSecureContext;
  setStatus('notificationSettingStatus', notificationStatusText(
    supported, supported ? Notification.permission : 'default', enabled,
  ));
}

export function refreshVoiceStatus(enabled: boolean): void {
  const supported = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  setStatus('voiceSettingStatus', supported
    ? enabled ? '语音提示已开启，可以先试听音量' : '可先试听，开启后在活动提醒时播放'
    : '当前浏览器暂未提供语音播放，可使用轻提示音');
  const button = document.getElementById('testVoiceButton') as HTMLButtonElement | null;
  if (button) button.disabled = !supported;
}

function addControls(toggleId: string, statusId: string | null, buttonId?: string, label?: string): void {
  const input = document.getElementById(toggleId) as HTMLInputElement | null;
  const row = input?.closest('.setting-row');
  if (!input || !row || (statusId && document.getElementById(statusId)) || (buttonId && document.getElementById(buttonId))) return;
  const controls = document.createElement('div');
  controls.className = 'device-setting-controls';
  if (statusId) {
    const status = document.createElement('p');
    status.id = statusId;
    status.className = 'device-setting-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    controls.append(status);
    input.setAttribute('aria-describedby', statusId);
  }
  if (buttonId && label) {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = buttonId;
    button.className = 'device-setting-action';
    button.textContent = label;
    controls.append(button);
  }
  // Keep preview buttons outside labels so clicking them never toggles a checkbox.
  row.after(controls);
}

export function mountDeviceSettings(actions: DeviceSettingsActions): void {
  if (document.getElementById('testSoundButton')) return;
  addControls('soundToggle', null, 'testSoundButton', '试听提示音');
  addControls('voiceToggle', 'voiceSettingStatus', 'testVoiceButton', '试听语音');
  addControls('notificationToggle', 'notificationSettingStatus');
  addControls('eyeToggle', 'eyeSettingStatus', 'retryEyeButton', '重新加载用眼观察');
  document.getElementById('testSoundButton')?.addEventListener('click', actions.onTestSound);
  document.getElementById('testVoiceButton')?.addEventListener('click', actions.onTestVoice);
  document.getElementById('retryEyeButton')?.addEventListener('click', async () => {
    const button = document.getElementById('retryEyeButton') as HTMLButtonElement;
    button.disabled = true;
    setEyeStatus('loading');
    try {
      await actions.onRetryEye();
    } catch {
      setEyeStatus('error', '请检查网络连接后重试');
    } finally {
      button.disabled = false;
    }
  });
  refreshVoiceStatus((document.getElementById('voiceToggle') as HTMLInputElement).checked);
  setNotificationStatus((document.getElementById('notificationToggle') as HTMLInputElement).checked);
  setEyeStatus((document.getElementById('eyeToggle') as HTMLInputElement).checked ? 'waiting' : 'off');
}
