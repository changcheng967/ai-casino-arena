import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: (() => {
      const u = process.env.DATABASE_URL;
      if (!u) throw new Error("DATABASE_URL is not set — add it to .env.local or the environment");
      return u;
    })(),
  },
});
