import { describe, expect, it } from 'vitest';
import { eyeStatusText, notificationStatusText } from '../src/ui/device-settings';

describe('device permission and observation feedback', () => {
  it('distinguishes a saved eye preference from actual observation and loading failure', () => {
    expect(eyeStatusText('waiting')).toContain('启动摄像头');
    expect(eyeStatusText('running')).toContain('运行中');
    expect(eyeStatusText('error')).toContain('重试');
    expect(eyeStatusText('paused', '返回页面后继续')).toContain('返回页面后继续');
  });
  it('shows recovery instructions when permission is denied even with an enabled preference', () => {
    expect(notificationStatusText(true, 'denied', true)).toContain('网站设置');
    expect(notificationStatusText(true, 'denied', true)).not.toContain('已开启');
  });
  it('distinguishes browser grant from product preference and unsupported environments', () => {
    expect(notificationStatusText(true, 'granted', false)).toContain('开启此选项');
    expect(notificationStatusText(true, 'granted', true)).toContain('已开启');
    expect(notificationStatusText(false, 'default', false)).toContain('Chrome');
  });
});
