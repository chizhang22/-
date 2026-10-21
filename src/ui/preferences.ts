export type ThemeKey = "cream" | "blue" | "mint" | "purple" | "dark";

export interface Preferences {
  theme: ThemeKey;
  sound: boolean;
  voice: boolean;
  notifications: boolean;
  eyeTracking: boolean;
}

export const themes: Array<{
  key: ThemeKey;
  name: string;
  description: string;
  colors: [string, string, string, string];
}> = [
  {
    key: "cream",
    name: "暖科技 · 奶油杏",
    description: "柔和温暖，适合长时间使用",
    colors: ["#F7F3EE", "#E8C4A0", "#FF8A65", "#3D3A38"],
  },
  {
    key: "blue",
    name: "静谧蓝 · 雾感",
    description: "沉静清晰，专注感更强",
    colors: ["#F0F4F8", "#A8C5DA", "#5B8FB9", "#2C3E50"],
  },
  {
    key: "mint",
    name: "薄荷绿 · 生机",
    description: "清爽舒展，带一点自然气息",
    colors: ["#F5FAF7", "#B8E0D2", "#6BBF9E", "#2F4F4F"],
  },
  {
    key: "purple",
    name: "暮紫 · 未来",
    description: "克制雅致，保留科技质感",
    colors: ["#F4F1F8", "#C3B1E1", "#8E7CC3", "#3B3548"],
  },
  {
    key: "dark",
    name: "深夜陪伴",
    description: "降低夜间亮度，保留清晰层次",
    colors: ["#1A1D23", "#252A33", "#7FD1B9", "#E8EAED"],
  },
];

const storageKey = "zuobiaoxi-preferences-v1";

export const defaultPreferences: Preferences = {
  theme: "cream",
  sound: true,
  voice: false,
  notifications: false,
  eyeTracking: false,
};

export function loadPreferences(): Preferences {
  try {
    const stored = localStorage.getItem(storageKey);
    if (!stored) return { ...defaultPreferences };
    const parsed = JSON.parse(stored) as Partial<Preferences>;
    return { ...defaultPreferences, ...parsed };
  } catch {
    return { ...defaultPreferences };
  }
}

export function savePreferences(preferences: Preferences): void {
  localStorage.setItem(storageKey, JSON.stringify(preferences));
}

export function applyTheme(theme: ThemeKey): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme === "dark" ? "dark" : "light";
}
