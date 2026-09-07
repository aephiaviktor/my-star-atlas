'use strict';
// Poll the wall clock cheaply; RPC runs hourly, in the boundary window, on startup,
// and after suspension. UTC arithmetic is independent of local DST.
function createToolkitBoundaryScheduler({ capture, retry = async () => {}, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let timer, stopped = false, lastTick = null, lastRetry = null, lastCaptureHour = null, running = false;
  async function tick() {
    if (stopped || running) return;
    running = true;
    const at = now(), day = 86400000, phase = ((at % day) + day) % day;
    const hour = Math.floor(at / 3600000);
    const due = hour !== lastCaptureHour || lastTick === null || at - lastTick > 90000 || at < lastTick || phase >= day - 300000 || phase < 600000;
    lastTick = at;
    try {
      if (due) { lastCaptureHour = hour; lastRetry = at; await capture(); }
      else if (lastRetry === null || at - lastRetry >= 300000) { lastRetry = at; await retry(); }
    }
    catch (_) { /* Retry during the next boundary tick; no fabricated observation. */ }
    finally {
      running = false;
      if (!stopped) { timer = setTimer(tick, 30000); timer?.unref?.(); }
    }
  }
  return { start: tick, stop() { stopped = true; clearTimer(timer); } };
}
module.exports = { createToolkitBoundaryScheduler };
