import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type FontAvailability = "available" | "unavailable" | "unknown";

export interface FontAvailabilityProvider {
  check(family: string): Promise<FontAvailability>;
}

function normalizedFamily(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

/**
 * Minimal cross-platform probe. fontconfig provides an exact/fallback signal
 * on Linux and on macOS installations that expose it; other hosts report
 * unknown instead of guessing from renderer-specific defaults.
 */
export function createSystemFontAvailabilityProvider(): FontAvailabilityProvider {
  const cache = new Map<string, FontAvailability>();
  return {
    async check(family: string): Promise<FontAvailability> {
      const normalized = normalizedFamily(family);
      const cached = cache.get(normalized);
      if (cached !== undefined) {
        return cached;
      }
      if (["sans-serif", "serif", "monospace"].includes(normalized)) {
        cache.set(normalized, "available");
        return "available";
      }
      if (process.platform !== "linux" && process.platform !== "darwin") {
        cache.set(normalized, "unknown");
        return "unknown";
      }

      try {
        const { stdout } = await execFileAsync(
          "fc-match",
          ["--format=%{family}", family],
          { encoding: "utf8", timeout: 2_000, maxBuffer: 64 * 1024 },
        );
        const matchedFamilies = stdout
          .split(",")
          .map(normalizedFamily)
          .filter((name) => name.length > 0);
        const availability = matchedFamilies.includes(normalized)
          ? "available"
          : "unavailable";
        cache.set(normalized, availability);
        return availability;
      } catch {
        cache.set(normalized, "unknown");
        return "unknown";
      }
    },
  };
}
