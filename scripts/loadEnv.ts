// Loads .env.local (and .env if present) into process.env for tsx scripts.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

for (const name of [".env.local", ".env"]) {
  const p = join(process.cwd(), name);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}
