import { defineConfig } from "vitest/config";
import path from "node:path";

// Pin the timezone. The dates tests assert that "today" comes from the LOCAL
// calendar rather than UTC, which is only a meaningful assertion if the local
// zone is NOT UTC — otherwise the bug they exist to catch would pass silently
// on a CI runner (which defaults to UTC).
process.env.TZ = "Australia/Sydney";

export default defineConfig({
  resolve: {
    // Mirror tsconfig's `@/*` → `src/*` alias so tests can import modules the
    // same way Next.js does. Not previously needed because no test file
    // imported anything through the alias; pursuitRequests.test.ts is the
    // first (it imports the pure formatBrief helper from a module that also
    // pulls in the supabase client, which requires the alias to resolve).
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
