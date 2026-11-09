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

const MAX_STOPWATCHES = 5;

const stopwatches = [];
let resizeScheduled = false;

const appWindow = getCurrentWindow();
const stopwatchesEl = document.getElementById("stopwatches");
const aboutEl = document.getElementById("about");
const aboutContentEl = document.getElementById("about-content");
let aboutVisible = false;

function anyRunning() {
  return stopwatches.some((stopwatch) => stopwatch.isRunning);
}

class Stopwatch {
  constructor(id, el) {
    this.id = id;
    this.el = el;
    this.displayEl = el.querySelector(".display");
    this.isRunning = false;
    this.startTime = null;
    this.displayFormat = "hh:mm:ss";
    this.intervalId = null;
    this.lastDisplayText = null;
    this.timeLogs = [];
    this.timelogsWin = null;
    this.contextMenu = null;
    this.ctxToggleFormatMenuItem = null;
    this.ctxAddItem = null;
    this.ctxRemoveItem = null;

    el.addEventListener("click", () => {
      if (this.isRunning) {
        this.stop();
      } else {
        this.start();
      }
    });
  }

  applyState(state) {
    this.startTime = state.start_time;
    this.displayFormat = state.display_format;
    this.isRunning = state.is_running;
    this.timeLogs = state.time_logs || [];

    this.updateFormatButtonText();

    if (this.isRunning && this.startTime) {
      this.start();
    } else {
      this.updateDisplay();
    }
  }

  async saveState() {
    try {
      await invoke("save_state", {
        stopwatch: this.id,
        state: {
          start_time: this.startTime,
          is_running: this.isRunning,
          display_format: this.displayFormat,
          time_logs: this.timeLogs,
        },
      });
    } catch (error) {
      console.error("Failed to save state:", error);
    }
  }

  getTotalLoggedMs() {
    return this.timeLogs.reduce((sum, log) => sum + log.duration_ms, 0);
  }

  formatTime(milliseconds) {
    const totalSeconds = Math.floor(milliseconds / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (this.displayFormat === "hh:mm:ss") {
      return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    } else {
      const decimalHours = milliseconds / (1000 * 60 * 60);
      return decimalHours.toFixed(4);
    }
  }

  updateDisplay() {
    const loggedTime = this.getTotalLoggedMs();
    let totalElapsed;

    if (this.isRunning && this.startTime) {
      totalElapsed = loggedTime + (Date.now() - this.startTime);
    } else {
      totalElapsed = loggedTime;
    }

    const nextText =
      totalElapsed === 0
        ? this.displayFormat === "hh:mm:ss"
          ? "00:00:00"
          : "0.0000"
        : this.formatTime(totalElapsed);

    if (nextText !== this.lastDisplayText) {
      this.displayEl.textContent = nextText;
      this.lastDisplayText = nextText;
      resizeWindowToFit();
    }
  }

  clearTimer() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  start() {
    if (!this.startTime) {
      this.startTime = Date.now();
    }
    this.isRunning = true;
    this.el.classList.remove("stopped");
    this.el.classList.add("running");

    this.clearTimer();
    this.intervalId = setInterval(() => this.updateDisplay(), 100);

    updateAlwaysOnTop();
    this.saveState();
  }

  async stop() {
    if (!this.isRunning || !this.startTime) return;

    const stopTime = Date.now();
    const elapsed = stopTime - this.startTime;
    if (elapsed >= 2000) {
      this.timeLogs.push({ start: this.startTime, stop: stopTime, duration_ms: elapsed });
    }

    this.isRunning = false;
    this.startTime = null;
    this.el.classList.remove("running");
    this.el.classList.add("stopped");
    this.clearTimer();

    this.updateDisplay();
    updateAlwaysOnTop();
    await this.saveState();
    emit("logs-updated", { stopwatch: this.id }).catch((error) =>
      console.error("Failed to notify time logs window:", error)
    );
  }

  async reset() {
    this.isRunning = false;
    this.startTime = null;
    this.timeLogs = [];
    this.el.classList.remove("running");
    this.el.classList.add("stopped");
    this.clearTimer();

    try {
      await invoke("clear_time_logs", { stopwatch: this.id });
    } catch (error) {
      console.error("Failed to clear logs:", error);
    }

    this.updateDisplay();
    updateAlwaysOnTop();
    this.saveState();
  }

  toggleFormat() {
    this.displayFormat = this.displayFormat === "hh:mm:ss" ? "hh.hhhh" : "hh:mm:ss";
    this.updateFormatButtonText();
    this.updateDisplay();
    this.saveState();
  }

  formatMenuText() {
    return this.displayFormat === "hh:mm:ss" ? "Switch to hh.hh" : "Switch to hh:mm:ss";
  }

  updateFormatButtonText() {
    if (this.ctxToggleFormatMenuItem) {
      this.ctxToggleFormatMenuItem.setText(this.formatMenuText()).catch((err) =>
        console.error("Failed to update context menu text:", err)
      );
    }
  }

  timelogsTitle() {
    return stopwatches.length > 1 ? `Time Logs ${stopwatches.indexOf(this) + 1}` : "Time Logs";
  }

  async openTimelogsWindow() {
    try {
      if (this.timelogsWin) {
        const size = await this.timelogsWin.outerSize();
        const spot = await computeTimelogsPosition(size.width, size.height);
        if (spot) {
          await this.timelogsWin.setPosition(new PhysicalPosition(spot.x, spot.y));
        }
        await bringToFront(this.timelogsWin);
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

      // timelogs.js works out which stopwatch it belongs to from this label.
      const win = new WebviewWindow(`timelogs-${this.id}`, {
        url: "timelogs.html",
        title: this.timelogsTitle(),
        width: TIMELOGS_WIDTH,
        height: TIMELOGS_HEIGHT,
        ...(spot ? { x: spot.x / spot.scale, y: spot.y / spot.scale } : { center: true }),
        resizable: true,
        minimizable: false,
        maximizable: false,
        focus: true,
      });
      this.timelogsWin = win;

      win.once("tauri://created", () => {
        bringToFront(win);
      });

      win.once("tauri://destroyed", () => {
        this.timelogsWin = null;
      });

      win.once("tauri://error", (e) => {
        alert("Failed to open Time Logs window: " + JSON.stringify(e));
        this.timelogsWin = null;
      });
    } catch (e) {
      alert("openTimelogsWindow error: " + e);
    }
  }

  async setupMenu() {
    const ctxQuit = await MenuItem.new({ text: "Quit", action: closeApp });
    const ctxReset = await MenuItem.new({ text: "Reset", action: () => this.reset() });
    const ctxReview = await MenuItem.new({
      text: "Review Times",
      action: () => this.openTimelogsWindow(),
    });
    this.ctxToggleFormatMenuItem = await MenuItem.new({
      text: this.formatMenuText(),
      action: () => this.toggleFormat(),
    });
    const ctxAbout = await MenuItem.new({ text: "About", action: showAbout });

    this.ctxAddItem = await MenuItem.new({
      text: "Add Stopwatch",
      action: () => addStopwatch(),
    });
    this.ctxRemoveItem = await MenuItem.new({
      text: "Remove Stopwatch",
      action: () => removeStopwatch(this),
    });

    this.contextMenu = await Menu.new({
      items: [
        ctxReset,
        ctxReview,
        this.ctxToggleFormatMenuItem,
        this.ctxAddItem,
        this.ctxRemoveItem,
        ctxAbout,
        ctxQuit,
      ],
    });
  }
}

function createStopwatchElement() {
  const el = document.createElement("div");
  el.className = "stopwatch stopped";
  const display = document.createElement("div");
  display.className = "display";
  display.textContent = "00:00:00";
  el.appendChild(display);
  stopwatchesEl.appendChild(el);
  return el;
}

// Refresh everything that depends on how many stopwatches there are.
function updateStopwatchControls() {
  const logError = (err) => console.error("Failed to update stopwatch controls:", err);
  for (const stopwatch of stopwatches) {
    if (stopwatch.ctxAddItem) {
      stopwatch.ctxAddItem.setEnabled(stopwatches.length < MAX_STOPWATCHES).catch(logError);
    }
    if (stopwatch.ctxRemoveItem) {
      stopwatch.ctxRemoveItem.setEnabled(stopwatches.length > 1).catch(logError);
    }
    if (stopwatch.timelogsWin) {
      stopwatch.timelogsWin.setTitle(stopwatch.timelogsTitle()).catch(logError);
    }
  }
}

// Ids are permanent and ascending, so a new stopwatch always lands at the bottom
// and removing one doesn't disturb the others' saved data or open log windows.
function nextStopwatchId() {
  return Math.max(...stopwatches.map((stopwatch) => stopwatch.id)) + 1;
}

async function addStopwatch(savedState = null, id = nextStopwatchId()) {
  if (stopwatches.length >= MAX_STOPWATCHES) return;

  const stopwatch = new Stopwatch(id, createStopwatchElement());
  stopwatches.push(stopwatch);
  await stopwatch.setupMenu();

  if (savedState) {
    stopwatch.applyState(savedState);
  } else {
    await stopwatch.saveState();
    stopwatch.updateDisplay();
  }
  updateStopwatchControls();
}

async function removeStopwatch(stopwatch) {
  const index = stopwatches.indexOf(stopwatch);
  if (index === -1 || stopwatches.length <= 1) return;

  stopwatch.clearTimer();
  stopwatches.splice(index, 1);
  stopwatch.el.remove();

  if (stopwatch.timelogsWin) {
    stopwatch.timelogsWin.close().catch((error) =>
      console.error("Failed to close time logs window:", error)
    );
  }

  try {
    await invoke("remove_stopwatch", { stopwatch: stopwatch.id });
  } catch (error) {
    console.error("Failed to remove stopwatch:", error);
  }

  updateStopwatchControls();
  updateAlwaysOnTop();
  resizeWindowToFit();
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
    if (aboutVisible) return;

    // As wide as the widest stopwatch, and tall enough for all of them.
    let width = 0;
    let height = isMac ? MAC_TITLE_BAR_HEIGHT : 0;
    for (const stopwatch of stopwatches) {
      const displayRect = stopwatch.displayEl.getBoundingClientRect();
      const styles = getComputedStyle(stopwatch.el);
      const paddingX = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
      const paddingY = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);
      width = Math.max(width, Math.ceil(displayRect.width + paddingX));
      height += Math.ceil(displayRect.height + paddingY + 4);
    }

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
    await appWindow.setAlwaysOnTop(anyRunning());
  } catch (error) {
    console.error("Failed to set always-on-top:", error);
  }
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

  aboutEl.className = anyRunning() ? "running" : "stopped";
  stopwatchesEl.style.display = "none";

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
  stopwatchesEl.style.display = "";
  aboutVisible = false;
  resizeWindowToFit();
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

// Windows won't always raise a window on setFocus alone; briefly pinning it on top forces it forward.
async function bringToFront(win) {
  if (!win) return;
  try {
    await win.unminimize();
    await win.show();
    await win.setAlwaysOnTop(true);
    await win.setFocus();
    await win.setAlwaysOnTop(false);
  } catch (e) {
    console.error("Failed to bring window to front:", e);
  }
}

async function loadSavedState(id) {
  try {
    return await invoke("get_state", { stopwatch: id });
  } catch (error) {
    console.error("Failed to load state:", error);
    return null;
  }
}

// Event listeners
document.getElementById("about-ok").addEventListener("click", hideAbout);

document.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  // Each stopwatch has its own menu; anywhere else (the About panel) uses the first.
  const target = stopwatches.find((s) => s.el.contains(e.target)) || stopwatches[0];
  if (target && target.contextMenu) {
    target.contextMenu
      .popup()
      .catch((err) => console.error("Failed to show context menu:", err));
  }
});

// Sync a stopwatch's logs when its time logs window makes edits
listen("logs-updated", async (event) => {
  const stopwatch = stopwatches.find((s) => s.id === event.payload.stopwatch);
  if (!stopwatch) return;
  try {
    const state = await invoke("get_state", { stopwatch: stopwatch.id });
    if (state) {
      stopwatch.timeLogs = state.time_logs || [];
      stopwatch.updateDisplay();
    }
  } catch (error) {
    console.error("Failed to reload state after logs-updated:", error);
  }
}).catch((err) => console.error("Failed to listen for logs-updated:", err));

// Initialize
(async () => {
  let savedIds = [];
  try {
    savedIds = await invoke("list_stopwatches");
  } catch (error) {
    console.error("Failed to list stopwatches:", error);
  }

  const first = new Stopwatch(savedIds.length > 0 ? savedIds[0] : 0, document.querySelector(".stopwatch"));
  stopwatches.push(first);
  await first.setupMenu();

  // Saved even when new, because the store's keys decide which stopwatches exist.
  const firstState = await loadSavedState(first.id);
  if (firstState) {
    first.applyState(firstState);
  } else {
    await first.saveState();
  }
  first.updateDisplay();

  for (const id of savedIds.slice(1)) {
    const state = await loadSavedState(id);
    if (state) await addStopwatch(state, id);
  }

  updateStopwatchControls();
  await updateAlwaysOnTop();
})();
