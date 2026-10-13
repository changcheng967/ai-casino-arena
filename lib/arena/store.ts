// Store factory: DevRepo (JSON file) until DATABASE_URL exists, Neon+Drizzle after.

import { ArenaRepo } from "./repo";
import { DevRepo } from "./store-dev";

let cached: ArenaRepo | null = null;

export async function getStore(): Promise<ArenaRepo> {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (url) {
    const { NeonRepo } = await import("./store-neon");
    cached = new NeonRepo(url);
  } else {
    cached = new DevRepo();
  }
  return cached;
}
