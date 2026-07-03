import { useCallback, useEffect, useRef, useState } from "react";
import type { ErrorsPayload, ErrorsRangeKey } from "../types/telemetry";
import { fetchAdminErrors } from "../utils/api";

const ERRORS_REFRESH_MS = 60_000;

/**
 * Per-user error rollup over the retained event history (90 days), scoped to
 * the selected range. Refetches on range change and every minute in the
 * background; the previous payload stays visible while a reload is in flight.
 */
export function useAdminErrors(enabled: boolean, range: ErrorsRangeKey) {
  const [data, setData] = useState<ErrorsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  const load = useCallback(
    async (silent: boolean) => {
      const seq = ++requestSeq.current;
      if (!silent) {
        setLoading(true);
      }

      try {
        const res = await fetchAdminErrors(range);
        if (seq !== requestSeq.current) {
          return;
        }

        if (res.ok && res.errors) {
          setData(res.errors);
          setError(null);
        } else if (!silent) {
          setError("Failed to load errors.");
        }
      } catch {
        if (seq === requestSeq.current && !silent) {
          setError("Failed to load errors.");
        }
      } finally {
        if (seq === requestSeq.current) {
          setLoading(false);
        }
      }
    },
    [range]
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }

    void load(false);
    const id = window.setInterval(() => void load(true), ERRORS_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [enabled, load]);

  return { data, loading, error, refresh: () => void load(false) } as const;
}
