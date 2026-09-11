import type { AccountRepository } from "./storage";
/** Resolve click IDs from persisted data, including after a service-worker restart. */
export async function openNotification(
  repository: AccountRepository,
  id: string,
  open: (url: string) => Promise<unknown>,
  clear: (id: string) => Promise<unknown>,
): Promise<void> {
  const collection = await repository.read();
  const url = Object.values(collection.data)
    .map((data) => data.notificationTargets[id])
    .find(Boolean);
  if (url && ["http:", "https:"].includes(new URL(url).protocol))
    await open(url);
  await clear(id);
}
