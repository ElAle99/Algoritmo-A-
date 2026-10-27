import { useEffect, useState } from "react";
/** Distance-based progress. Pausing retains traveled distance, never changes route. */
export function useDelivery(total: number, speed: number) {
  const [meters, setMeters] = useState(0),
    [status, setStatus] = useState<"idle" | "moving" | "paused" | "arrived">(
      "idle",
    );
  useEffect(() => {
    if (status !== "moving") return;
    let frame = 0,
      last = performance.now(),
      committed = last,
      accumulator = 0;
    function tick(now: number) {
      accumulator += ((now - last) / 1000) * 12 * speed;
      last = now;
      if (now - committed >= 32) {
        const step = accumulator;
        accumulator = 0;
        committed = now;
        setMeters((current) => Math.min(total, current + step));
      }
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [status, total, speed]);
  useEffect(() => {
    if (status === "moving" && meters >= total) setStatus("arrived");
  }, [meters, total, status]);
  return {
    meters,
    status,
    start: () => {
      setMeters(0);
      setStatus(total > 0 ? "moving" : "arrived");
    },
    pause: () => setStatus("paused"),
    resume: () => setStatus("moving"),
    reset: () => {
      setMeters(0);
      setStatus("idle");
    },
  };
}
