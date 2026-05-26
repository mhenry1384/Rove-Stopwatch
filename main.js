import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { Menu, MenuItem } from "@tauri-apps/api/menu";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { listen } from "@tauri-apps/api/event";

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
  if (resizeScheduled) return;
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

  const elapsed = Date.now() - startTime;
  timeLogs.push({ start: startTime, stop: Date.now(), duration_ms: elapsed });

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
  saveState();
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

function updateFormatButtonText() {
  const nextText =
    displayFormat === "hh:mm:ss" ? "Switch to hh.hh" : "Switch to hh:mm:ss";
  if (ctxToggleFormatMenuItem) {
    ctxToggleFormatMenuItem.setText(nextText).catch((err) =>
      console.error("Failed to update context menu text:", err)
    );
  }
}

async function openTimelogsWindow() {
  try {
    if (timelogsWin) {
      timelogsWin.setFocus().catch(() => {});
      return;
    }

    timelogsWin = new WebviewWindow("timelogs", {
      url: "timelogs.html",
      title: "Time Logs",
      width: 680,
      height: 480,
      resizable: true,
      minimizable: true,
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

  contextMenu = await Menu.new({
    items: [ctxReset, ctxReview, ctxToggleFormatMenuItem, ctxQuit],
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
