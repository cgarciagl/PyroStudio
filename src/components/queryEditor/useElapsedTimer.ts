import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Live elapsed time of the running query (updates every 50 ms) and its final value.
 * Replaces an interval + start time handled by hand in six places.
 */
export function useElapsedTimer(tickMs = 50) {
  const [elapsedMs, setElapsedMs] = useState(0);
  const startRef = useRef(0);
  const intervalRef = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const start = useCallback(() => {
    stop();
    startRef.current = Date.now();
    setElapsedMs(0);
    intervalRef.current = window.setInterval(() => setElapsedMs(Date.now() - startRef.current), tickMs);
  }, [stop, tickMs]);

  /** Freeze the display at the real duration and return it. */
  const finish = useCallback((): number => {
    const duration = Date.now() - startRef.current;
    setElapsedMs(duration);
    return duration;
  }, []);

  useEffect(() => stop, [stop]);

  return { elapsedMs, start, stop, finish };
}
