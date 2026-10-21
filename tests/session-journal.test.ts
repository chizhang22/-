import { describe, expect, it, vi } from "vitest";
import { SessionJournal, SessionOutbox } from "../src/session-journal";
function storage() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); }, key: (i: number) => [...data.keys()][i] ?? null, get length() { return data.size; } };
}
describe("session drafts and durable outbox", () => {
  it("hands off a released draft immediately to a fresh document owner", () => {
    const s = storage();
    const before = new SessionJournal<{id: string}>(s, "document-one", () => 1000);
    const after = new SessionJournal<{id: string}>(s, "document-two", () => 1100);
    before.save({id: "one"}); expect(after.claim("one")).toBeNull();
    before.release("one"); expect(after.available()).toHaveLength(1);
    expect(after.claim("one")?.savedAt).toBe(1000);
    expect(() => before.save({id:"one"})).toThrow();
  });
  it("stores different sessions independently across two outbox instances", async () => {
    const s=storage(); const first=new SessionOutbox<{id:string}>(s, async () => true);
    const second=new SessionOutbox<{id:string}>(s, async () => true);
    first.enqueue({id:"one"}); second.enqueue({id:"two"});
    expect(first.list()).toHaveLength(2);
    await Promise.all([first.flush(),second.flush()]); expect(first.list()).toHaveLength(0);
  });
  it("restores own drafts, protects other tabs, allows explicit stale takeover", () => {
    const s = storage(); let time = 0;
    const a = new SessionJournal<{id: string; duration: number}>(s, "a", () => time);
    const b = new SessionJournal<{id: string; duration: number}>(s, "b", () => time);
    a.save({id:"one", duration:5000});
    expect(a.available()).toHaveLength(1); expect(b.available()).toHaveLength(0); expect(b.claim("one")).toBeNull();
    time = 120001; expect(b.claim("one")?.value.duration).toBe(5000);
    expect(() => a.save({id:"one",duration:6000})).toThrow();
    a.remove("one"); expect(b.read("one")).not.toBeNull();
  });
  it("retains failed sends and retries once per session", async () => {
    const send = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    const box = new SessionOutbox<{id: string; duration: number}>(storage(), send);
    box.enqueue({id:"one",duration:1000}); box.enqueue({id:"one",duration:2000});
    await Promise.all([box.flush(), box.flush()]); expect(send).toHaveBeenCalledTimes(1); expect(box.list()).toHaveLength(1);
    await box.flush(); expect(box.list()).toHaveLength(0);
  });
  it("keeps newer payloads queued during an in-flight request", async () => {
    let finish!: (ok: boolean) => void;
    const box = new SessionOutbox<{id:string;duration:number}>(storage(), () => new Promise(resolve => { finish=resolve; }));
    box.enqueue({id:"one",duration:1}); const flush=box.flush();
    box.enqueue({id:"one",duration:2}); finish(true); await flush;
    expect(box.list()[0]?.duration).toBe(2);
  });
  it("preserves malformed legacy queues for recovery instead of overwriting them", () => {
    const s=storage(); s.setItem("zbx-pending-sessions", "broken");
    const box=new SessionOutbox<{id:string}>(s, async () => true);
    expect(() => box.enqueue({id:"one"})).toThrow(); expect(s.getItem("zbx-pending-sessions")).toBe("broken");
  });
});
