import './agent-panel.css';

type Item = Record<string, unknown>;
interface Preferences { reminderMinutes: number; driftMinutes: number; snoozeUntil: string | null; quietHours: Array<{start: string; end: string}>; fontScale: number }
interface Dashboard { sessions: Item[]; feedback: Item[]; memories: Item[]; messages: Item[]; actions: Item[]; preferences: Preferences }
interface Health { configured: boolean; providerHost?: string; model?: string; connected?: boolean; detail?: string }
const escape = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
const date = (value: unknown): string => {
  const time = new Date(String(value ?? ''));
  return Number.isNaN(time.getTime()) ? '时间待补充' : time.toLocaleString('zh-CN', {month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit'});
};
const minutes = (value: unknown): string => (Math.max(0, Number(value) || 0) / 60000).toFixed(1);
export const recordedDuration = (value: unknown): string => typeof value === 'number' && Number.isFinite(value) ? `${minutes(value)} 分钟` : '未记录';
const postureDetails = (item: Item): string => `向前靠近 ${recordedDuration(item.forwardMs)} · 头部下移 ${recordedDuration(item.lowerMs)} · 侧倾 ${recordedDuration(item.sideMs)} · 转身 ${recordedDuration(item.turnMs)} · 躯干变化 ${recordedDuration(item.torsoMs)} · 最长静止 ${recordedDuration(item.stillLongestMs)}`;
const reminderDuration = (value: number): string => value < 1 ? `${Number((value * 60).toFixed(2))} 秒` : `${value} 分钟`;
// Escape the entire response first; only this small, predictable subset becomes markup.
const replyMarkup = (value: unknown): string => escape(value).replace(/^#{1,6}\s+/gm, '').replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {...options, headers: {'Content-Type':'application/json', ...options.headers}});
  const body = await response.json().catch(() => ({})) as Item;
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : `请求暂时受阻（${response.status}），请稍后重试。`);
  return body as T;
}

export function mountAgentPanel(): void {
  if (document.querySelector('#personalCompanion')) return;
  const root = document.createElement('section');
  root.className = 'companion';
  root.id = 'personalCompanion';
  root.setAttribute('aria-labelledby', 'companionTitle');
  root.innerHTML = `
    <header class="companion-heading"><div><span class="section-kicker">04 · 慢慢了解你</span><h2 id="companionTitle">身体的感受，也值得记下来</h2><p>随手记一句，给下一次专注留个参考。</p></div><span class="companion-status" id="companionStatus">正在连接本机服务</span></header>
    <div class="companion-intro"><p>使用摘要和身体感受保存在这台电脑。摄像头画面实时处理后释放。</p><p id="companionProvider">聊天时，会将你的文字和相关记录交给已配置的模型分析。</p></div>
    <div class="companion-tabs" role="tablist" aria-label="个人陪伴功能">
      <button id="companionTabChat" role="tab" aria-selected="true" aria-controls="companionChat" data-tab="chat">聊一聊</button>
      <button id="companionTabRecords" role="tab" aria-selected="false" aria-controls="companionRecords" tabindex="-1" data-tab="records">我的记录</button>
      <button id="companionTabPreferences" role="tab" aria-selected="false" aria-controls="companionPreferences" tabindex="-1" data-tab="preferences">使用习惯</button>
    </div>
    <p class="companion-notice" id="companionNotice" role="status" aria-live="polite" hidden></p>
    <div id="companionChat" role="tabpanel" aria-labelledby="companionTabChat">
      <div class="companion-columns">
        <div class="companion-conversation">
          <div id="companionMessages" class="companion-messages" role="log" aria-label="聊天记录" aria-live="polite"></div>
          <div id="companionActions" class="companion-actions"></div>
          <details id="companionToolDetails" class="companion-tool-details" hidden><summary>本次完成的操作</summary><ul id="companionToolList"></ul></details>
          <div class="companion-prompts"><button type="button" data-prompt="帮我看看最近几次专注和身体感受，有哪些值得留意的变化？">看看最近的变化</button><button type="button" data-prompt="接下来半小时先安静一点，帮我设置免打扰。">安静半小时</button></div>
          <form id="companionChatForm" class="companion-form"><label for="companionMessage">想说点什么？</label><textarea id="companionMessage" rows="3" maxlength="4000" placeholder="今天写材料时右肩有点酸，想看看最近有没有类似情况。" required></textarea><div class="companion-consent" id="companionConsent"><label><input id="companionConsentCheck" type="checkbox">同意将聊天文字与相关使用摘要发送给当前模型服务</label><p>授权保留在本页，可随时收回。当前服务见上方说明。</p></div><div class="companion-form-bottom"><span id="companionSessionHint">随时可以聊，也可以先记录感受。</span><button class="companion-primary" id="companionSend" type="submit">发送</button></div><button class="companion-text-button" id="companionRevoke" type="button" hidden>收回聊天授权</button></form>
        </div>
        <aside class="companion-quick"><span class="companion-tag">留在本机</span><h3>随手记</h3><p>工作时的感受，先记在这里。分析时再由你发起聊天。</p><form id="companionFeedbackForm" class="companion-form"><label for="companionFeedback">此刻身体感觉怎么样？</label><textarea id="companionFeedback" rows="4" maxlength="2000" required placeholder="右肩有点紧，活动后轻松了一些。"></textarea><div class="companion-field-pair"><label>部位（选填）<input id="companionArea" maxlength="40" placeholder="例如右肩"></label><label>程度（选填）<select id="companionIntensity"><option value="">留空</option><option value="1">1 · 很轻</option><option value="2">2 · 轻微</option><option value="3">3 · 明显</option><option value="4">4 · 较强</option><option value="5">5 · 很强</option></select></label></div><button type="submit" class="companion-secondary">记下感受</button></form><p class="companion-footnote">原话会一起保留。部位与程度由你补充，之后也可以修改。</p></aside>
      </div>
    </div>
    <div id="companionRecords" role="tabpanel" aria-labelledby="companionTabRecords" hidden><div class="companion-record-toolbar"><p>记录从每一次使用慢慢积累。</p><button id="companionExport" class="companion-secondary">导出全部记录</button></div><div id="companionDayStats" class="companion-day-stats"></div><h3>身体感受</h3><div id="companionFeedbackList" class="companion-record-list"></div><h3>专注小结</h3><div id="companionSessions" class="companion-record-list"></div></div>
    <div id="companionPreferences" role="tabpanel" aria-labelledby="companionTabPreferences" hidden><div class="companion-columns"><div><h3>按你的节奏来</h3><form id="companionPreferencesForm" class="companion-form"><div class="companion-field-pair"><label>活动提醒间隔（分钟）<input id="companionReminder" type="number" min="5" max="120" required></label><label>持续姿态变化多久后提醒<select id="companionDrift" required><option value="0.25">15 秒</option><option value="0.5">30 秒</option><option value="1">1 分钟</option><option value="5">5 分钟</option></select></label></div><label>页面字号<select id="companionFont"><option value="1">标准</option><option value="1.15">大一些</option><option value="1.3">更大</option></select></label><fieldset><legend>每日免打扰时段</legend><p>可以跨过午夜，例如 22:00 至 08:00。每行填写一段，最多三段。</p><div id="companionQuietHours"></div><button id="companionAddQuiet" class="companion-text-button" type="button">添加时段</button></fieldset><p id="companionSnooze"></p><button id="companionClearSnooze" class="companion-text-button" type="button" hidden>恢复提醒</button><button class="companion-primary" type="submit">保存使用习惯</button></form></div><aside class="companion-memory"><h3>已经记住的事</h3><p>明确表达的习惯与待验证的观察分开保存。你随时可以改写或删除。</p><div id="companionMemories" class="companion-record-list"></div></aside></div></div>
    <dialog id="companionEditDialog" class="companion-edit-dialog"><form id="companionEditForm" class="companion-form"><h3 id="companionEditTitle">修改记录</h3><label for="companionEditText">内容</label><textarea id="companionEditText" rows="5" maxlength="2000" required></textarea><div id="companionEditFields" class="companion-field-pair"><label>部位（选填）<input id="companionEditArea" maxlength="40"></label><label>程度（1–5，选填）<input id="companionEditIntensity" type="number" min="1" max="5"></label></div><div class="companion-dialog-buttons"><button type="button" id="companionEditCancel" class="companion-secondary">返回</button><button type="submit" class="companion-primary">保存修改</button></div></form></dialog>`;
  const workspace = document.querySelector('.workspace');
  if (workspace) workspace.insertAdjacentElement('afterend', root);
  else document.querySelector('.shell')?.append(root);
  const el = <T extends HTMLElement = HTMLElement>(id: string): T => root.querySelector(`#${id}`)!;
  el<HTMLSelectElement>('companionIntensity').innerHTML = '<option value="">留空</option>' + Array.from({length:11}, (_, value) => `<option value="${value}">${value}${value === 0 ? ' · 感觉舒适' : value === 5 ? ' · 中等' : value === 10 ? ' · 很强' : ''}</option>`).join('');
  const intensityInput = el<HTMLInputElement>('companionEditIntensity');
  intensityInput.min = '0'; intensityInput.max = '10';
  intensityInput.parentElement!.firstChild!.textContent = '程度（0–10，选填）';
  el<HTMLInputElement>('companionReminder').min = '1';
  el<HTMLInputElement>('companionReminder').max = '180';
  let dashboard: Dashboard | null = null;
  let health: Health | null = null;
  let sessionId: string | undefined;
  let consent = false;
  let chatBusy = false;
  let preferencesDirty = false;
  let refreshId = 0;
  let editing: {kind: 'feedback' | 'memories'; id: string} | null = null;
  let focusBeforeDialog: HTMLElement | null = null;

  const notice = (message: string, error = false) => {
    el('companionNotice').textContent = message;
    el('companionNotice').hidden = !message;
    el('companionNotice').classList.toggle('is-error', error);
  };
  const switchTab = (name: string) => {
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-tab]')) {
      const active = button.dataset.tab === name;
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
      el(button.getAttribute('aria-controls')!).hidden = !active;
    }
  };
  const quietRow = (start = '', end = '') => {
    const row = document.createElement('div');
    row.className = 'companion-quiet-row';
    row.innerHTML = `<input type="time" aria-label="免打扰开始时间" value="${escape(start)}" required><span>至</span><input type="time" aria-label="免打扰结束时间" value="${escape(end)}" required><button type="button" class="companion-text-button" aria-label="移除此免打扰时段">移除</button>`;
    row.querySelector('button')!.addEventListener('click', () => { preferencesDirty = true; row.remove(); el<HTMLButtonElement>('companionAddQuiet').disabled = false; });
    el('companionQuietHours').append(row);
    el<HTMLButtonElement>('companionAddQuiet').disabled = el('companionQuietHours').children.length >= 3;
  };
  const renderActions = () => {
    el('companionActions').innerHTML = (dashboard?.actions ?? []).filter(item => item.status === 'pending' || item.status === 'confirmed').slice(0, 5).map(item => {
      const changes = item.changes as Item | undefined;
      const descriptions: string[] = [];
      if (changes?.reminderMinutes !== undefined) descriptions.push(`活动提醒 ${changes.reminderMinutes} 分钟`);
      if (changes?.driftMinutes !== undefined) descriptions.push(`持续姿态变化 ${reminderDuration(Number(changes.driftMinutes))} 后提醒`);
      if (changes?.snoozeUntil) descriptions.push(`安静到 ${date(changes.snoozeUntil)}`);
      if (changes?.snoozeUntil === null) descriptions.push('恢复提醒');
      if (changes?.fontScale) descriptions.push(`字号 ${Math.round(Number(changes.fontScale) * 100)}%`);
      if (changes?.quietHours) descriptions.push('更新每日免打扰时段');
      return `<article class="companion-action"><span class="companion-tag">${item.status === 'pending' ? '等你决定' : '已应用'}</span><p>${escape(item.reason || '调整使用习惯')}</p><p>${escape(descriptions.join(' · '))}</p><button class="companion-secondary" data-action="${item.status === 'pending' ? 'confirm' : 'undo'}" data-id="${escape(item.id)}">${item.status === 'pending' ? '应用这个调整' : '撤销这个调整'}</button></article>`;
    }).join('');
  };
  const renderMessages = () => {
    const messages = dashboard?.messages ?? [];
    el('companionMessages').innerHTML = messages.length ? messages.slice(-30).map(message => `<article class="companion-message ${message.role === 'user' ? 'from-user' : 'from-assistant'}"><span>${message.role === 'user' ? '你' : '坐标系'} · ${escape(date(message.createdAt))}</span><p>${message.role === 'user' ? escape(message.content) : replyMarkup(message.content)}</p></article>`).join('') : '<div class="companion-welcome"><span class="companion-welcome-mark" aria-hidden="true">＋</span><h3>今天坐得舒服吗？</h3><p>可以聊聊身体感受、看看近期记录，或安排接下来的提醒。</p></div>';
    el('companionMessages').scrollTop = el('companionMessages').scrollHeight;
  };
  const renderRecords = () => {
    if (!dashboard) return;
    el('companionFeedbackList').innerHTML = dashboard.feedback.length ? dashboard.feedback.map(item => `<article class="companion-record"><div><span class="companion-meta">${escape(date(item.createdAt))}${item.area ? ` · ${escape(item.area)}` : ''}${item.intensity !== null && item.intensity !== undefined ? ` · 程度 ${escape(item.intensity)}/10` : ''}</span><p>${escape(item.text)}</p></div><div class="companion-record-controls"><button data-edit="feedback" data-id="${escape(item.id)}">修改</button><button data-delete="feedback" data-id="${escape(item.id)}">删除</button></div></article>`).join('') : '<p class="companion-empty">第一条身体感受，会从随手记开始。</p>';
    el('companionSessions').innerHTML = dashboard.sessions.length ? dashboard.sessions.map(item => `<article class="companion-record"><div><span class="companion-tag">${item.mode === 'demo' ? '演示数据' : item.mode === 'timer' ? '计时专注' : '摄像头观察'}</span><h4>${escape(date(item.startAt))} · ${minutes(item.durationMs)} 分钟</h4><p>有效姿态观察 ${minutes(item.validPoseMs)} 分钟 · 提醒 ${Number(item.reminders) || 0} 次${item.mode !== 'timer' && Number(item.durationMs) > 0 ? ` · 观察覆盖 ${Math.round(100 * Number(item.validPoseMs) / Number(item.durationMs))}%` : ''}</p>${item.mode === 'timer' ? '<p>本次采用计时模式，姿态与眨眼数据留空。</p>' : Number(item.validPoseMs) > 0 ? `<p>${postureDetails(item)}</p><p class="companion-meta">多种变化可能同时出现，时长有重叠。</p>` : '<p>有效姿态观察待积累，姿态统计留空。</p>'}${item.mode !== 'timer' && Number(item.validEyeMs) > 0 ? `<p>用眼观察 ${minutes(item.validEyeMs)} 分钟 · 检测到眨眼 ${Number(item.blinkCount) || 0} 次</p>` : ''}</div></article>`).join('') : '<p class="companion-empty">结束一段专注后，这里会出现本次小结。</p>';
    const today = new Date().toLocaleDateString();
    const sessions = dashboard.sessions.filter(item => item.mode !== 'demo' && new Date(String(item.startAt)).toLocaleDateString() === today);
    const sum = (key: string) => sessions.reduce((total, item) => total + (Number(item[key]) || 0), 0);
    el('companionDayStats').innerHTML = `<div><span>今天的专注</span><strong>${minutes(sum('durationMs'))}<small> 分钟</small></strong></div><div><span>有效姿态观察</span><strong>${minutes(sum('validPoseMs'))}<small> 分钟</small></strong></div><div><span>已保存的小结</span><strong>${sessions.length}<small> 次</small></strong></div>`;
    el('companionMemories').innerHTML = dashboard.memories.length ? dashboard.memories.map(item => `<article class="companion-record"><div><span class="companion-tag">${item.kind === 'pattern' ? '待验证的观察' : '你表达的习惯'}</span><p>${escape(item.text)}</p>${Array.isArray(item.sourceIds) && item.sourceIds.length ? `<span class="companion-meta">关联 ${item.sourceIds.length} 条记录</span><details><summary>查看关联记录</summary><p>${item.sourceIds.map(id => { const record = [...dashboard!.feedback, ...dashboard!.sessions, ...dashboard!.messages].find(row => row.id === id); return escape(record ? `${date(record.createdAt || record.startAt)} · ${record.text || record.content || `专注 ${minutes(record.durationMs)} 分钟`}` : '较早的关联记录，可在导出档案中查看。'); }).join('<br>')}</p></details>` : ''}</div><div class="companion-record-controls"><button data-edit="memories" data-id="${escape(item.id)}">修改</button><button data-delete="memories" data-id="${escape(item.id)}">删除</button></div></article>`).join('') : '<p class="companion-empty">聊到明确的习惯，或积累了可核对的观察后，会保存在这里。</p>';
  };
  const renderPreferences = () => {
    if (!dashboard) return;
    const preferences = dashboard.preferences;
    el<HTMLInputElement>('companionReminder').value = String(preferences.reminderMinutes);
    const driftSelect = el<HTMLSelectElement>('companionDrift');
    for (const option of [...driftSelect.options]) if (option.dataset.custom) option.remove();
    if (![...driftSelect.options].some(option => option.value === String(preferences.driftMinutes))) {
      const customOption = new Option(`当前设置 · ${reminderDuration(preferences.driftMinutes)}`, String(preferences.driftMinutes));
      customOption.dataset.custom = 'true';
      driftSelect.add(customOption);
    }
    driftSelect.value = String(preferences.driftMinutes);
    const fontSelect = el<HTMLSelectElement>('companionFont');
    if (![...fontSelect.options].some(option => option.value === String(preferences.fontScale))) fontSelect.add(new Option(`当前字号 · ${Math.round(preferences.fontScale * 100)}%`, String(preferences.fontScale)));
    fontSelect.value = String(preferences.fontScale);
    el('companionQuietHours').replaceChildren();
    el<HTMLButtonElement>('companionAddQuiet').disabled = false;
    for (const range of preferences.quietHours ?? []) quietRow(range.start, range.end);
    const snoozed = !!preferences.snoozeUntil && Date.parse(preferences.snoozeUntil) > Date.now();
    el('companionSnooze').textContent = snoozed ? `临时免打扰至 ${date(preferences.snoozeUntil)}` : '临时免打扰：已结束';
    el('companionClearSnooze').hidden = !snoozed;
  };
  const refresh = async (includePreferences = true) => {
    const version = ++refreshId;
    try {
      const [next, status] = await Promise.all([request<Dashboard>('/api/dashboard'), request<Health>('/api/health')]);
      if (version !== refreshId) return;
      dashboard = next; health = status;
      el('companionStatus').textContent = status.connected ? '模型已连接' : status.configured ? '模型已配置 · 等待连接验证' : '本机记录已就绪 · 待配置模型';
      el('companionStatus').dataset.connected = String(!!status.connected);
      el('companionProvider').textContent = status.configured ? `聊天服务：${status.providerHost || '已配置服务'}${status.model ? ` · ${status.model}` : ''}。发送时共享聊天文字与相关摘要，视频留在实时处理环节。` : '本机记录可以直接使用。聊天模型请在项目的 .env 中配置，设置方法见使用说明。';
      document.documentElement.style.setProperty('--user-font-scale', String(next.preferences.fontScale || 1));
      window.dispatchEvent(new CustomEvent('zbx:preferences', {detail: next.preferences}));
      renderMessages(); renderRecords(); renderActions(); if (includePreferences && !preferencesDirty) renderPreferences();
    } catch (error) {
      el('companionStatus').textContent = '本机服务连接待恢复';
      notice(`${error instanceof Error ? error.message : '连接暂时中断'} 请确认项目启动窗口仍在运行。`, true);
    }
  };
  const withBusy = async (button: HTMLButtonElement, task: () => Promise<void>) => {
    const label = button.textContent;
    button.disabled = true; button.textContent = '正在处理…';
    try { await task(); } catch (error) { notice(error instanceof Error ? error.message : '操作暂时受阻，请稍后重试。', true); }
    finally { button.disabled = false; button.textContent = label; }
  };
  root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(button => {
    button.addEventListener('click', () => switchTab(button.dataset.tab!));
    button.addEventListener('keydown', event => {
      const tabs = [...root.querySelectorAll<HTMLButtonElement>('[data-tab]')];
      const index = tabs.indexOf(button);
      const target = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
      if (target >= 0) { event.preventDefault(); switchTab(tabs[target]!.dataset.tab!); tabs[target]!.focus(); }
    });
  });
  root.querySelectorAll<HTMLButtonElement>('[data-prompt]').forEach(button => button.addEventListener('click', () => { el<HTMLTextAreaElement>('companionMessage').value = button.dataset.prompt!; el('companionMessage').focus(); }));
  el('companionChatForm').addEventListener('submit', event => {
    event.preventDefault();
    if (chatBusy) return;
    const message = el<HTMLTextAreaElement>('companionMessage').value.trim();
    if (!message) return;
    if (!health?.configured) { notice('请先按使用说明完成模型配置。身体感受仍可通过随手记保存。', true); return; }
    if (!consent && !el<HTMLInputElement>('companionConsentCheck').checked) { notice('请阅读并勾选聊天数据授权，再发送这条消息。', true); el('companionConsentCheck').focus(); return; }
    consent = true;
    el('companionConsent').hidden = true; el('companionRevoke').hidden = false;
    chatBusy = true;
    void withBusy(el<HTMLButtonElement>('companionSend'), async () => {
      notice('正在结合相关记录整理回复…');
      const result = await request<{reply: string; mode: string; error?: string; toolCalls?: Item[]}>('/api/chat', {method:'POST', body:JSON.stringify({message, sessionId, consent:true})});
      const toolNames: Record<string, string> = {query_history:'查阅近期记录', get_trends:'计算使用趋势', save_feedback:'保存身体感受', remember_preference:'记住个人习惯', update_preferences:'准备设置调整', get_activity:'查阅休息动作'};
      el('companionToolDetails').hidden = !result.toolCalls?.length;
      el('companionToolList').innerHTML = (result.toolCalls ?? []).map(call => { const outcome = call.result as Item | undefined; return `<li>${escape(toolNames[String(call.name)] || '处理相关记录')} · ${outcome?.error ? '待重试' : '已完成'}</li>`; }).join('');
      await refresh(false);
      if (result.mode === 'unavailable') {
        notice(`${result.error || result.reply || '模型连接暂时受阻。'} 感受可以先通过随手记保存。`, true);
      } else {
        el<HTMLTextAreaElement>('companionMessage').value = '';
        notice(result.toolCalls?.length ? `已完成本次交流，调用了 ${result.toolCalls.length} 项记录或分析工具。` : '回复已更新。');
      }
    }).finally(() => {chatBusy = false;});
  });
  el('companionRevoke').addEventListener('click', () => { consent = false; el<HTMLInputElement>('companionConsentCheck').checked = false; el('companionConsent').hidden = false; el('companionRevoke').hidden = true; notice('聊天授权已收回。下一次发送时会再次征求你的同意。'); });
  el('companionFeedbackForm').addEventListener('submit', event => {
    event.preventDefault();
    const text = el<HTMLTextAreaElement>('companionFeedback').value.trim();
    if (!text) return;
    void withBusy(el<HTMLFormElement>('companionFeedbackForm').querySelector('button')!, async () => {
      const intensity = el<HTMLSelectElement>('companionIntensity').value;
      await request('/api/feedback', {method:'POST', body:JSON.stringify({text, sessionId, area:el<HTMLInputElement>('companionArea').value.trim() || null, intensity:intensity ? Number(intensity) : null})});
      el<HTMLFormElement>('companionFeedbackForm').reset();
      await refresh(false); notice('感受已保存在本机，可以到我的记录里查看。');
    });
  });
  el('companionPreferencesForm').addEventListener('input', () => { preferencesDirty = true; });
  el('companionPreferencesForm').addEventListener('change', () => { preferencesDirty = true; });
  el('companionAddQuiet').addEventListener('click', () => { if (el('companionQuietHours').children.length < 3) { preferencesDirty = true; quietRow(); } });
  el('companionPreferencesForm').addEventListener('submit', event => {
    event.preventDefault();
    const quietHours = [...el('companionQuietHours').children].map(row => { const inputs = row.querySelectorAll('input'); return {start:inputs[0]!.value, end:inputs[1]!.value}; });
    if (quietHours.some(range => range.start === range.end)) { notice('开始和结束时间请分开填写。整天安静可以使用临时免打扰。', true); return; }
    void withBusy(el<HTMLFormElement>('companionPreferencesForm').querySelector<HTMLButtonElement>('button[type="submit"]')!, async () => {
      await request('/api/preferences', {method:'PATCH', body:JSON.stringify({reminderMinutes:Number(el<HTMLInputElement>('companionReminder').value), driftMinutes:Number(el<HTMLSelectElement>('companionDrift').value), fontScale:Number(el<HTMLSelectElement>('companionFont').value), quietHours})});
      preferencesDirty = false;
      await refresh(); notice('使用习惯已保存，当前页面同步生效。');
    });
  });
  el('companionClearSnooze').addEventListener('click', () => void withBusy(el<HTMLButtonElement>('companionClearSnooze'), async () => { await request('/api/preferences', {method:'PATCH', body:JSON.stringify({snoozeUntil:null})}); await refresh(); notice('提醒已恢复。'); }));
  el('companionExport').addEventListener('click', () => void withBusy(el<HTMLButtonElement>('companionExport'), async () => {
    const data = await request('/api/export');
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type:'application/json'}));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `坐标系记录-${new Date().toLocaleDateString('sv-SE')}.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    notice('记录已导出，请妥善保存这份个人数据。');
  }));
  root.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-id]');
    if (!button) return;
    const id = button.dataset.id!;
    if (button.dataset.action) {
      void withBusy(button, async () => { await request(`/api/actions/${encodeURIComponent(id)}/${button.dataset.action}`, {method:'POST', body:'{}'}); await refresh(); notice(button.dataset.action === 'confirm' ? '调整已应用。' : '已恢复调整前的设置。'); }); return;
    }
    const kind = (button.dataset.edit || button.dataset.delete) as 'feedback' | 'memories';
    if (button.dataset.delete) {
      if (!window.confirm('删除这条记录？删除后将从个人档案移除。')) return;
      void withBusy(button, async () => { await request(`/api/${kind}/${encodeURIComponent(id)}`, {method:'DELETE'}); await refresh(false); notice('记录已删除。'); }); return;
    }
    const item = dashboard?.[kind].find(record => String(record.id) === id);
    if (!item) return;
    editing = {kind, id}; focusBeforeDialog = button;
    el('companionEditTitle').textContent = kind === 'feedback' ? '修改身体感受' : '修改记住的事';
    el<HTMLTextAreaElement>('companionEditText').value = String(item.text || '');
    el('companionEditFields').hidden = kind !== 'feedback';
    el<HTMLInputElement>('companionEditArea').value = String(item.area || '');
    el<HTMLInputElement>('companionEditIntensity').value = item.intensity !== null && item.intensity !== undefined ? String(item.intensity) : '';
    el<HTMLDialogElement>('companionEditDialog').showModal();
  });
  el('companionEditCancel').addEventListener('click', () => el<HTMLDialogElement>('companionEditDialog').close());
  el('companionEditDialog').addEventListener('close', () => { editing = null; if (focusBeforeDialog?.isConnected) focusBeforeDialog.focus(); });
  el('companionEditForm').addEventListener('submit', event => {
    event.preventDefault(); if (!editing) return;
    const current = editing;
    const body: Item = {text:el<HTMLTextAreaElement>('companionEditText').value.trim()};
    if (!body.text) return;
    if (current.kind === 'feedback') { body.area = el<HTMLInputElement>('companionEditArea').value.trim() || null; body.intensity = el<HTMLInputElement>('companionEditIntensity').value ? Number(el<HTMLInputElement>('companionEditIntensity').value) : null; }
    void withBusy(el<HTMLFormElement>('companionEditForm').querySelector<HTMLButtonElement>('button[type="submit"]')!, async () => { await request(`/api/${current.kind}/${encodeURIComponent(current.id)}`, {method:'PATCH', body:JSON.stringify(body)}); el<HTMLDialogElement>('companionEditDialog').close(); await refresh(false); notice('记录已更新。'); });
  });
  window.addEventListener('zbx:refresh', () => void refresh());
  window.addEventListener('zbx:session', event => { const detail = (event as CustomEvent<{id?: string; mode?: string}>).detail; sessionId = detail?.id || undefined; el('companionSessionHint').textContent = sessionId ? `感受将关联当前${detail.mode === 'demo' ? '演示' : '专注'}记录。` : '随时可以聊，也可以先记录感受。'; });
  window.dispatchEvent(new CustomEvent('zbx:request-session'));
  void refresh();
}
