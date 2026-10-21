type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;
export interface Draft<T> { version: 1; owner: string; savedAt: number; released?: boolean; value: T }
const PREFIX = "zbx-draft:";
/** One draft per session; a fresh lease protects a session in another tab. */
export class SessionJournal<T extends { id: string }> {
  constructor(private storage: StoragePort, readonly owner: string, private now = Date.now) {}
  read(id: string): Draft<T> | null {
    try {
      const draft = JSON.parse(this.storage.getItem(PREFIX + id) ?? "null");
      return draft?.version === 1 && draft.value?.id === id && typeof draft.owner === "string"
        && Number.isFinite(draft.savedAt) ? draft : null;
    } catch { return null; }
  }
  available(): Draft<T>[] {
    const drafts: Draft<T>[] = [];
    for (let i = 0; i < this.storage.length; i++) {
      const key = this.storage.key(i);
      if (!key?.startsWith(PREFIX)) continue;
      const draft = this.read(key.slice(PREFIX.length));
      if (draft && (draft.released || draft.owner === this.owner || this.now() - draft.savedAt > 120_000)) drafts.push(draft);
    }
    return drafts.sort((a, b) => b.savedAt - a.savedAt);
  }
  save(value: T): void {
    const previous = this.read(value.id);
    if (previous && previous.owner !== this.owner) throw new Error("这段记录已在另一个页面接续");
    this.storage.setItem(PREFIX + value.id, JSON.stringify({ version: 1, owner: this.owner, savedAt: this.now(), value }));
  }
  claim(id: string): Draft<T> | null {
    const draft = this.read(id);
    if (!draft || (!draft.released && draft.owner !== this.owner && this.now() - draft.savedAt <= 120_000)) return null;
    const claimed = { ...draft, owner: this.owner, released: false };
    this.storage.setItem(PREFIX + id, JSON.stringify({ ...claimed, savedAt: this.now() }));
    return claimed;
  }
  release(id: string): void {
    const draft = this.read(id);
    if (draft?.owner === this.owner) this.storage.setItem(PREFIX + id, JSON.stringify({ ...draft, released: true }));
  }
  remove(id: string): void {
    if (this.read(id)?.owner === this.owner) this.storage.removeItem(PREFIX + id);
  }
}

/** Persist before sending; retries are serialized and keyed by session ID. */
export class SessionOutbox<T extends { id: string }> {
  private flight: Promise<boolean> | null = null;
  constructor(private storage: StoragePort, private send: (value: T) => Promise<boolean>) {}
  list(): T[] {
    const raw = this.storage.getItem("zbx-pending-sessions");
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed) || parsed.some(item => !item || typeof item.id !== "string")) throw new Error("暂存记录格式待检查，请先保留浏览器数据");
    const entries = new Map<string, T>(parsed.map(item => [item.id, item]));
    for (let i = 0; i < this.storage.length; i++) {
      const key = this.storage.key(i);
      if (!key?.startsWith("zbx-outbox:")) continue;
      const value = JSON.parse(this.storage.getItem(key) ?? "null");
      if (!value || key !== `zbx-outbox:${value.id}`) throw new Error("暂存摘要格式待检查");
      entries.set(value.id, value);
    }
    return [...entries.values()];
  }
  enqueue(value: T): void {
    this.list(); // Validate a legacy queue before changing any pending data.
    this.storage.setItem(`zbx-outbox:${value.id}`, JSON.stringify(value));
  }
  flush(): Promise<boolean> {
    if (this.flight) return this.flight;
    this.flight = this.drain().finally(() => { this.flight = null; });
    return this.flight;
  }
  private async drain(): Promise<boolean> {
    let sent = false;
    for (const value of this.list()) {
      try {
        if (!await this.send(value)) continue;
        // Preserve a newer payload queued while this request was in flight.
        const key = `zbx-outbox:${value.id}`;
        if (this.storage.getItem(key) === JSON.stringify(value)) this.storage.removeItem(key);
        const legacy = this.storage.getItem("zbx-pending-sessions");
        if (legacy) this.storage.setItem("zbx-pending-sessions", JSON.stringify(JSON.parse(legacy).filter((item: T) => item.id !== value.id)));
        sent = true;
      } catch { /* Keep this entry for the next retry, and try other entries. */ }
    }
    return sent;
  }
}
