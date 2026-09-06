import { defineConfig } from "vitest/config";

// Pin the timezone. The dates tests assert that "today" comes from the LOCAL
// calendar rather than UTC, which is only a meaningful assertion if the local
// zone is NOT UTC — otherwise the bug they exist to catch would pass silently
// on a CI runner (which defaults to UTC).
process.env.TZ = "Australia/Sydney";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
