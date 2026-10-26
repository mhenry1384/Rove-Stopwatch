import { invoke } from "@tauri-apps/api/core";
import {
  getCurrentWindow,
  currentMonitor,
  LogicalSize,
  PhysicalPosition,
} from "@tauri-apps/api/window";
import { Menu, MenuItem } from "@tauri-apps/api/menu";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { emit, listen } from "@tauri-apps/api/event";
import { getName, getVersion } from "@tauri-apps/api/app";

let isRunning = false;
let startTime = null;
let displayFormat = "hh:mm:ss";
let intervalId = null;
let lastDisplayText = null;
let resizeScheduled = false;
let ctxToggleFormatMenuItem = null;
let contextMenu = null;
let timeLogs = [];
let timelogsWin = null;

const appWindow = getCurrentWindow();
const stopwatchEl = document.getElementById("stopwatch");
const displayEl = document.getElementById("display");
const aboutEl = document.getElementById("about");
const aboutContentEl = document.getElementById("about-content");
let aboutVisible = false;

async function loadState() {
  try {
    const state = await invoke("get_state");
    if (state) {
      startTime = state.start_time;
      displayFormat = state.display_format;
      isRunning = state.is_running;
      timeLogs = state.time_logs || [];

      updateFormatButtonText();
      await updateAlwaysOnTop();

      if (isRunning && startTime) {
        startStopwatch();
      } else {
        updateDisplay();
      }
    }
  } catch (error) {
    console.error("Failed to load state:", error);
  }
}

async function saveState() {
  try {
    await invoke("save_state", {
      state: {
        start_time: startTime,
        is_running: isRunning,
        display_format: displayFormat,
        time_logs: timeLogs,
      },
    });
  } catch (error) {
    console.error("Failed to save state:", error);
  }
}

function getTotalLoggedMs() {
  return timeLogs.reduce((sum, log) => sum + log.duration_ms, 0);
}

function formatTime(milliseconds) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (displayFormat === "hh:mm:ss") {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  } else {
    const decimalHours = milliseconds / (1000 * 60 * 60);
    return decimalHours.toFixed(4);
  }
}

function updateDisplay() {
  const loggedTime = getTotalLoggedMs();
  let totalElapsed;

  if (isRunning && startTime) {
    totalElapsed = loggedTime + (Date.now() - startTime);
  } else {
    totalElapsed = loggedTime;
  }

  const nextText =
    totalElapsed === 0
      ? displayFormat === "hh:mm:ss"
        ? "00:00:00"
        : "0.0000"
      : formatTime(totalElapsed);

  if (nextText !== lastDisplayText) {
    displayEl.textContent = nextText;
    lastDisplayText = nextText;
    resizeWindowToFit();
  } else {
    displayEl.textContent = nextText;
  }
}

// On macOS, setSize sets the outer window size (title bar included), so we
// need to add the native title bar height to get the correct content area.
const MAC_TITLE_BAR_HEIGHT = 28;
const isMac = navigator.userAgent.includes("Mac");

function resizeWindowToFit() {
  if (resizeScheduled || aboutVisible) return;
  resizeScheduled = true;

  requestAnimationFrame(async () => {
    resizeScheduled = false;
    const displayRect = displayEl.getBoundingClientRect();
    const stopwatchStyles = getComputedStyle(stopwatchEl);
    const paddingX =
      parseFloat(stopwatchStyles.paddingLeft) +
      parseFloat(stopwatchStyles.paddingRight);
    const paddingY =
      parseFloat(stopwatchStyles.paddingTop) +
      parseFloat(stopwatchStyles.paddingBottom);

    const width = Math.ceil(displayRect.width + paddingX);
    const height = Math.ceil(displayRect.height + paddingY + 4 + (isMac ? MAC_TITLE_BAR_HEIGHT : 0));

    if (width > 0 && height > 0) {
      try {
        await appWindow.setSize(new LogicalSize(width, height));
      } catch (error) {
        console.error("Failed to set window size:", error);
      }
    }
  });
}

async function updateAlwaysOnTop() {
  try {
    await appWindow.setAlwaysOnTop(isRunning);
  } catch (error) {
    console.error("Failed to set always-on-top:", error);
  }
}

function startStopwatch() {
  if (!startTime) {
    startTime = Date.now();
  }
  isRunning = true;
  stopwatchEl.classList.remove("stopped");
  stopwatchEl.classList.add("running");

  if (intervalId) clearInterval(intervalId);
  intervalId = setInterval(updateDisplay, 100);

  updateAlwaysOnTop();
  saveState();
}

async function stopStopwatch() {
  if (!isRunning || !startTime) return;

  const stopTime = Date.now();
  const elapsed = stopTime - startTime;
  if (elapsed >= 2000) {
    timeLogs.push({ start: startTime, stop: stopTime, duration_ms: elapsed });
  }

  isRunning = false;
  startTime = null;
  stopwatchEl.classList.remove("running");
  stopwatchEl.classList.add("stopped");

  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }

  updateDisplay();
  updateAlwaysOnTop();
  await saveState();
  emit("logs-updated", {}).catch((error) =>
    console.error("Failed to notify time logs window:", error)
  );
}

async function resetStopwatch() {
  isRunning = false;
  startTime = null;
  timeLogs = [];
  stopwatchEl.classList.remove("running");
  stopwatchEl.classList.add("stopped");

  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }

  try {
    await invoke("clear_time_logs");
  } catch (error) {
    console.error("Failed to clear logs:", error);
  }

  updateDisplay();
  updateAlwaysOnTop();
  saveState();
}

function toggleFormat() {
  displayFormat = displayFormat === "hh:mm:ss" ? "hh.hhhh" : "hh:mm:ss";
  updateFormatButtonText();
  updateDisplay();
  saveState();
}

function closeApp() {
  appWindow.close().catch((error) => {
    console.error("Failed to close app:", error);
  });
}

async function showAbout() {
  if (aboutVisible) return;
  aboutVisible = true;

  const name = await getName();
  const version = await getVersion();
  document.getElementById("about-title").textContent = name;
  document.getElementById("about-ver").textContent = `v${version}`;

  aboutEl.className = isRunning ? "running" : "stopped";
  stopwatchEl.style.display = "none";

  requestAnimationFrame(async () => {
    const rect = aboutContentEl.getBoundingClientRect();
    const w = Math.ceil(rect.width);
    const h = Math.ceil(rect.height + (isMac ? MAC_TITLE_BAR_HEIGHT : 0));
    try {
      await appWindow.setSize(new LogicalSize(w, h));
    } catch (e) {
      console.error("Failed to resize for about:", e);
    }
  });
}

function hideAbout() {
  aboutEl.className = "hidden";
  stopwatchEl.style.display = "";
  aboutVisible = false;
  lastDisplayText = null; // force resize recalculation
  resizeWindowToFit();
}

function updateFormatButtonText() {
  const nextText =
    displayFormat === "hh:mm:ss" ? "Switch to hh.hh" : "Switch to hh:mm:ss";
  if (ctxToggleFormatMenuItem) {
    ctxToggleFormatMenuItem.setText(nextText).catch((err) =>
      console.error("Failed to update context menu text:", err)
    );
  }
}

const TIMELOGS_WIDTH = 680;
const TIMELOGS_HEIGHT = 480;
const TIMELOGS_GAP = 8;

// Pick a spot for the time logs window next to the stopwatch (below, above,
// right, then left), keeping it inside the monitor's work area. Returns
// physical coordinates, or null if the monitor can't be determined.
async function computeTimelogsPosition(outerWidth, outerHeight) {
  const monitor = await currentMonitor();
  if (!monitor) return null;
  const scale = await appWindow.scaleFactor();
  const pos = await appWindow.outerPosition();
  const size = await appWindow.outerSize();
  const area = monitor.workArea || { position: monitor.position, size: monitor.size };
  const left = area.position.x;
  const top = area.position.y;
  const right = left + area.size.width;
  const bottom = top + area.size.height;
  const gap = Math.round(TIMELOGS_GAP * scale);

  const clampX = (x) => Math.max(left, Math.min(x, right - outerWidth));
  const clampY = (y) => Math.max(top, Math.min(y, bottom - outerHeight));

  const candidates = [
    { room: bottom - (pos.y + size.height + gap), need: outerHeight,
      x: clampX(pos.x), y: pos.y + size.height + gap },
    { room: pos.y - gap - top, need: outerHeight,
      x: clampX(pos.x), y: pos.y - gap - outerHeight },
    { room: right - (pos.x + size.width + gap), need: outerWidth,
      x: pos.x + size.width + gap, y: clampY(pos.y) },
    { room: pos.x - gap - left, need: outerWidth,
      x: pos.x - gap - outerWidth, y: clampY(pos.y) },
  ];

  // First side with enough room wins; otherwise use the roomiest side.
  const best =
    candidates.find((c) => c.room >= c.need) ||
    candidates.reduce((a, b) => (b.room / b.need > a.room / a.need ? b : a));
  return { x: clampX(best.x), y: clampY(best.y), scale };
}

async function openTimelogsWindow() {
  try {
    if (timelogsWin) {
      const size = await timelogsWin.outerSize();
      const spot = await computeTimelogsPosition(size.width, size.height);
      if (spot) {
        await timelogsWin.setPosition(new PhysicalPosition(spot.x, spot.y));
      }
      timelogsWin.setFocus().catch(() => {});
      return;
    }

    // Estimate the new window's frame (title bar/borders) from the main window's.
    const scale = await appWindow.scaleFactor();
    const mainOuter = await appWindow.outerSize();
    const mainInner = await appWindow.innerSize();
    const frameW = mainOuter.width - mainInner.width;
    const frameH = mainOuter.height - mainInner.height;
    const spot = await computeTimelogsPosition(
      Math.round(TIMELOGS_WIDTH * scale) + frameW,
      Math.round(TIMELOGS_HEIGHT * scale) + frameH
    );

    timelogsWin = new WebviewWindow("timelogs", {
      url: "timelogs.html",
      title: "Time Logs",
      width: TIMELOGS_WIDTH,
      height: TIMELOGS_HEIGHT,
      ...(spot ? { x: spot.x / spot.scale, y: spot.y / spot.scale } : { center: true }),
      resizable: true,
      minimizable: false,
      maximizable: false,
    });

    timelogsWin.once("tauri://destroyed", () => {
      timelogsWin = null;
    });

    timelogsWin.once("tauri://error", (e) => {
      alert("Failed to open Time Logs window: " + JSON.stringify(e));
      timelogsWin = null;
    });
  } catch (e) {
    alert("openTimelogsWindow error: " + e);
  }
}

async function setupAppMenu() {
  const ctxQuit = await MenuItem.new({ text: "Quit", action: closeApp });
  const ctxReset = await MenuItem.new({ text: "Reset", action: resetStopwatch });
  const ctxReview = await MenuItem.new({
    text: "Review Times",
    action: openTimelogsWindow,
  });
  ctxToggleFormatMenuItem = await MenuItem.new({
    text: displayFormat === "hh:mm:ss" ? "Switch to hh.hh" : "Switch to hh:mm:ss",
    action: toggleFormat,
  });

  const ctxAbout = await MenuItem.new({ text: "About", action: showAbout });

  contextMenu = await Menu.new({
    items: [ctxReset, ctxReview, ctxToggleFormatMenuItem, ctxAbout, ctxQuit],
  });
}

// Event listeners
stopwatchEl.addEventListener("click", () => {
  if (isRunning) {
    stopStopwatch();
  } else {
    startStopwatch();
  }
});

document.getElementById("about-ok").addEventListener("click", hideAbout);

document.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  if (contextMenu) {
    contextMenu
      .popup()
      .catch((err) => console.error("Failed to show context menu:", err));
  }
});


// Sync timeLogs when timelogs window makes edits
listen("logs-updated", async () => {
  try {
    const state = await invoke("get_state");
    if (state) {
      timeLogs = state.time_logs || [];
      updateDisplay();
    }
  } catch (error) {
    console.error("Failed to reload state after logs-updated:", error);
  }
}).catch((err) => console.error("Failed to listen for logs-updated:", err));

// Initialize
(async () => {
  await setupAppMenu();
  await loadState();
  updateDisplay();
})();
