import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";

let timeLogs = [];
const deletedLogs = [];

const timeLogsList = document.getElementById("timeLogsList");
const totalDisplay = document.getElementById("totalDisplay");
const undoDeleteLink = document.getElementById("undo-delete");

async function loadLogs() {
  try {
    const state = await invoke("get_state");
    timeLogs = state?.time_logs || [];
  } catch (error) {
    console.error("Failed to load logs:", error);
    timeLogs = [];
  }
  renderLogs();
}

function msToHms(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  return {
    h: Math.floor(totalSeconds / 3600),
    m: Math.floor((totalSeconds % 3600) / 60),
    s: totalSeconds % 60,
  };
}

function hmsToMs(h, m, s) {
  return ((h * 3600) + (m * 60) + s) * 1000;
}

function formatHms(ms) {
  const { h, m, s } = msToHms(ms);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatDecimal(ms) {
  return (ms / (1000 * 60 * 60)).toFixed(4);
}

function formatDateTime(timestamp) {
  return new Date(timestamp).toLocaleString();
}

function formatDateTimeInput(timestamp) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function getTotalMs() {
  return timeLogs.reduce((sum, log) => sum + log.duration_ms, 0);
}

function renderLogs() {
  undoDeleteLink.classList.toggle("hidden", deletedLogs.length === 0);
  const totalMs = getTotalMs();
  totalDisplay.textContent = `Total: ${formatHms(totalMs)} (${formatDecimal(totalMs)} hrs)`;

  timeLogsList.innerHTML = "";

  if (timeLogs.length === 0) {
    timeLogsList.innerHTML = '<div class="empty-message">No time logs yet. Start and stop the stopwatch to create logs.</div>';
    return;
  }

  // Most recent first; data-index still refers to the position in timeLogs.
  timeLogs.map((log, index) => [log, index]).reverse().forEach(([log, index]) => {
    const { h, m, s } = msToHms(log.duration_ms);
    const div = document.createElement("div");
    div.className = "time-log-item";
    div.innerHTML = `
      <div class="log-meta">
        <span class="log-index">#${index + 1}</span>
        <span class="log-range">${formatDateTime(log.start)} → ${log.stop ? formatDateTime(log.stop) : "—"}</span>
      </div>
      <div class="log-edit-row">
        <label>Duration:</label>
        <div class="hms-inputs">
          <input type="number" class="hms-h" value="${h}" min="0" data-index="${index}"> h
          <input type="number" class="hms-m" value="${m}" min="0" max="59" data-index="${index}"> m
          <input type="number" class="hms-s" value="${s}" min="0" max="59" data-index="${index}"> s
        </div>
        <span class="log-decimal" data-index="${index}">${formatDecimal(log.duration_ms)} hrs</span>
      </div>
      <div class="log-edit-row">
        <label for="end-time-${index}">End time:</label>
        <input type="datetime-local" class="end-time-input" id="end-time-${index}" value="${formatDateTimeInput(log.stop)}" data-index="${index}">
      </div>
      <div class="log-actions">
        <button class="btn btn-sm btn-success save-btn" data-index="${index}">Save</button>
        <button class="btn btn-sm btn-danger delete-btn" data-index="${index}">Delete</button>
      </div>
    `;
    timeLogsList.appendChild(div);
  });

  document.querySelectorAll(".hms-h, .hms-m, .hms-s").forEach((input) => {
    input.addEventListener("input", (e) => {
      const index = parseInt(e.target.dataset.index);
      const row = e.target.closest(".log-edit-row");
      const h = parseInt(row.querySelector(".hms-h").value) || 0;
      const m = parseInt(row.querySelector(".hms-m").value) || 0;
      const s = parseInt(row.querySelector(".hms-s").value) || 0;
      const ms = hmsToMs(h, m, s);
      row.querySelector(".log-decimal").textContent = `${formatDecimal(ms)} hrs`;
      row.querySelector(".end-time-input").value = formatDateTimeInput(timeLogs[index].start + ms);
    });
  });

  document.querySelectorAll(".end-time-input").forEach((input) => {
    input.addEventListener("input", (e) => {
      const index = parseInt(e.target.dataset.index);
      const endTime = Date.parse(e.target.value);
      if (Number.isNaN(endTime)) return;
      const duration = Math.max(0, endTime - timeLogs[index].start);
      e.target.closest(".time-log-item").querySelector(".log-decimal").textContent = `${formatDecimal(duration)} hrs`;
    });
  });

  document.querySelectorAll(".save-btn").forEach((btn) => btn.addEventListener("click", saveLog));
  document.querySelectorAll(".delete-btn").forEach((btn) => btn.addEventListener("click", deleteLog));
}

async function saveLog(e) {
  const index = parseInt(e.target.dataset.index);
  const item = e.target.closest(".time-log-item");
  const h = parseInt(item.querySelector(".hms-h").value) || 0;
  const m = parseInt(item.querySelector(".hms-m").value) || 0;
  const s = parseInt(item.querySelector(".hms-s").value) || 0;
  const endTimeInput = item.querySelector(".end-time-input");
  const endTime = endTimeInput.value ? Date.parse(endTimeInput.value) : null;
  const newDuration = endTime !== null && !Number.isNaN(endTime)
    ? Math.max(0, endTime - timeLogs[index].start)
    : hmsToMs(h, m, s);

  timeLogs[index].duration_ms = newDuration;
  timeLogs[index].stop = endTime;

  try {
    await invoke("update_time_log", { index, log: timeLogs[index] });
    await emit("logs-updated", {});
    renderLogs();
  } catch (error) {
    console.error("Failed to update log:", error);
  }
}

async function deleteLog(e) {
  const index = parseInt(e.target.dataset.index);
  const deletedLog = timeLogs[index];
  if (!deletedLog) return;

  try {
    await invoke("delete_time_log", { index });
    timeLogs.splice(index, 1);
    deletedLogs.push({ index, log: deletedLog });
    if (deletedLogs.length > 10) deletedLogs.shift();
    await emit("logs-updated", {});
    renderLogs();
  } catch (error) {
    console.error("Failed to delete log:", error);
  }
}

async function undoDelete() {
  const deleted = deletedLogs.pop();
  if (!deleted) return;

  try {
    await invoke("restore_time_log", deleted);
    timeLogs.splice(Math.min(deleted.index, timeLogs.length), 0, deleted.log);
    await emit("logs-updated", {});
    renderLogs();
  } catch (error) {
    deletedLogs.push(deleted);
    console.error("Failed to undo delete:", error);
  }
}

listen("logs-updated", loadLogs).catch((error) =>
  console.error("Failed to listen for logs-updated:", error)
);

loadLogs();
undoDeleteLink.addEventListener("click", (event) => {
  event.preventDefault();
  undoDelete();
});
