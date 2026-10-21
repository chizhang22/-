import { describe, expect, it } from "vitest";
import { defaultPreferences, themes } from "../src/ui/preferences";

describe("theme preferences", () => {
  it("provides five unique palettes with four colors each", () => {
    expect(themes).toHaveLength(5);
    expect(new Set(themes.map((theme) => theme.key)).size).toBe(5);
    expect(themes.every((theme) => theme.colors.length === 4)).toBe(true);
    expect(themes.every((theme) => theme.colors.every((color) => /^#[0-9A-F]{6}$/i.test(color))))
      .toBe(true);
  });

  it("uses the cream palette as the initial choice", () => {
    expect(defaultPreferences.theme).toBe("cream");
    expect(defaultPreferences.sound).toBe(true);
    expect(defaultPreferences.notifications).toBe(false);
    expect(defaultPreferences.eyeTracking).toBe(false);
  });
});
