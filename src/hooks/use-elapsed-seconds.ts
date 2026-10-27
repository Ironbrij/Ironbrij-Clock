import { useEffect, useState } from "react";

/**
 * Wall-clock seconds since `startTime`, ticking once a second; 0 when
 * there's no timer. `host` is the window whose timers do the ticking —
 * the floating mini timer passes its own, since it stays on screen while
 * the IronTrack tab sits in the background, where Chrome runs timers
 * only about once a minute.
 */
export function useElapsedSeconds(startTime: string | null, host?: Window) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!startTime) {
      setSeconds(0);
      return;
    }
    const timers = host ?? window;
    const tick = () =>
      setSeconds(Math.max(0, Math.floor((Date.now() - new Date(startTime).getTime()) / 1000)));
    tick();
    const interval = timers.setInterval(tick, 1000);
    return () => timers.clearInterval(interval);
  }, [startTime, host]);
  return seconds;
}
