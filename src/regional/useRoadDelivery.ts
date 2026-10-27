import { useMemo } from "react";
import { useDelivery } from "../geo/useDelivery";
export type TimedSegment = { distance: number; seconds: number };
export function distanceAtTime(segments: TimedSegment[], seconds: number) {
  let remaining = Math.max(0, seconds),
    meters = 0;
  for (const segment of segments) {
    if (remaining >= segment.seconds) {
      meters += segment.distance;
      remaining -= segment.seconds;
    } else {
      return (
        meters +
        (segment.seconds ? (remaining / segment.seconds) * segment.distance : 0)
      );
    }
  }
  return meters;
}
/** Virtual clock follows each edge's recorded/explicitly estimated speed, with user time scaling. */
export function useRoadDelivery(segments: TimedSegment[], speed: number) {
  const seconds = useMemo(
    () => segments.reduce((s, e) => s + e.seconds, 0),
    [segments],
  );
  const clock = useDelivery(seconds, speed / 12);
  return { ...clock, meters: distanceAtTime(segments, clock.meters) };
}
