import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { Menu, MenuItem, Submenu } from "@tauri-apps/api/menu";

let isRunning = false;
let startTime = null;
let displayFormat = "hh:mm:ss"; // or 'hh.hh'
let intervalId = null;
let lastDisplayText = null;
let resizeScheduled = false;
let toggleFormatMenuItem = null;

const appWindow = getCurrentWindow();

const stopwatchEl = document.getElementById("stopwatch");
const displayEl = document.getElementById("display");

// Load state on startup
async function loadState() {
  try {
    const state = await invoke("get_state");
    if (state) {
      startTime = state.start_time;
      displayFormat = state.display_format;
      isRunning = state.is_running;

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

// Save state
async function saveState() {
  try {
    await invoke("save_state", {
      state: {
        start_time: startTime,
        is_running: isRunning,
        display_format: displayFormat,
      },
    });
  } catch (error) {
    console.error("Failed to save state:", error);
  }
}

async function updateAlwaysOnTop() {
  try {
    await appWindow.setAlwaysOnTop(isRunning);
  } catch (error) {
    console.error("Failed to set always-on-top:", error);
  }
}

function formatTime(milliseconds) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (displayFormat === "hh:mm:ss") {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  } else {
    // hh.hh format (decimal hours)
    const decimalHours = milliseconds / (1000 * 60 * 60);
    return decimalHours.toFixed(2);
  }
}

function updateDisplay() {
  let nextText;

  if (isRunning && startTime) {
    const elapsed = Date.now() - startTime;
    nextText = formatTime(elapsed);
  } else if (startTime === null) {
    nextText = displayFormat === "hh:mm:ss" ? "00:00:00" : "0.00";
  } else {
    const elapsed = Date.now() - startTime;
    nextText = formatTime(elapsed);
  }

  if (nextText !== lastDisplayText) {
    displayEl.textContent = nextText;
    lastDisplayText = nextText;
    resizeWindowToFit();
  } else {
    displayEl.textContent = nextText;
  }
}

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
    // 30 pixel fudge factor.  Maybe necessary due to title bar?
    const height = Math.ceil(displayRect.height + paddingY + 31);

    if (width > 0 && height > 0) {
      try {
        await appWindow.setSize(new LogicalSize(width, height));
      } catch (error) {
        console.error("Failed to set window size:", error);
      }
    }
  });
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

function stopStopwatch() {
  isRunning = false;
  stopwatchEl.classList.remove("running");
  stopwatchEl.classList.add("stopped");

  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }

  updateAlwaysOnTop();
  saveState();
}

function resetStopwatch() {
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

function toggleFormat() {
  displayFormat = displayFormat === "hh:mm:ss" ? "hh.hh" : "hh:mm:ss";
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
  if (!toggleFormatMenuItem) return;

  const nextText =
    displayFormat === "hh:mm:ss" ? "Switch to hh.hh" : "Switch to hh:mm:ss";
  toggleFormatMenuItem.setText(nextText).catch((error) => {
    console.error("Failed to update menu text:", error);
  });
}

async function setupAppMenu() {
  const quitItem = await MenuItem.new({
    text: "Quit",
    action: closeApp,
  });

  const fileMenu = await Submenu.new({
    text: "File",
    items: [quitItem],
  });

  const resetItem = await MenuItem.new({
    text: "Reset",
    action: resetStopwatch,
  });

  toggleFormatMenuItem = await MenuItem.new({
    text: displayFormat === "hh:mm:ss" ? "Switch to hh.hh" : "Switch to hh:mm:ss",
    action: toggleFormat,
  });

  const stopwatchMenu = await Submenu.new({
    text: "Stopwatch",
    items: [resetItem, toggleFormatMenuItem],
  });

  const menu = await Menu.new({
    items: [fileMenu, stopwatchMenu],
  });

  try {
    await menu.setAsAppMenu();
  } catch (error) {
    console.error("Failed to set app menu:", error);
  }
}

// Event listeners
stopwatchEl.addEventListener("click", (e) => {
  // Left click
  if (isRunning) {
    stopStopwatch();
  } else {
    startStopwatch();
  }
});

appWindow.onFocusChanged(({ payload }) => {
  if (payload && isRunning) {
    stopStopwatch();
  }
});

// Initialize
(async () => {
  await setupAppMenu();
  await loadState();
  updateDisplay();
})();
