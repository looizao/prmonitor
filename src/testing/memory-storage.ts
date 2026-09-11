import type { LocalStorage } from "../accounts/storage";
export class MemoryStorage implements LocalStorage {
  values: Record<string, unknown>;
  failWrite = false;
  failRemove = false;
  constructor(values: Record<string, unknown> = {}) {
    this.values = structuredClone(values);
  }
  async get(keys: string[]) {
    return structuredClone(
      Object.fromEntries(keys.map((key) => [key, this.values[key]])),
    );
  }
  async set(values: Record<string, unknown>) {
    if (this.failWrite) throw new Error("Storage full");
    Object.assign(this.values, structuredClone(values));
  }
  async remove(keys: string[]) {
    if (this.failRemove) throw new Error("Interrupted cleanup");
    keys.forEach((key) => delete this.values[key]);
  }
}
