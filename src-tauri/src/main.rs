// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use tauri::Manager;
use tauri_plugin_store::StoreExt;

#[derive(Debug, Serialize, Deserialize, Clone)]
struct TimeLog {
    start: i64,
    stop: Option<i64>,
    duration_ms: i64, // Adjusted duration in milliseconds
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct StopwatchState {
    start_time: Option<i64>,
    is_running: bool,
    display_format: String,
    time_logs: Vec<TimeLog>,
}

const STATE_KEY: &str = "stopwatch_state";

// Stopwatch 0 keeps the original key so existing saved data still loads.
// A stopwatch exists exactly when its key is in the store.
fn state_key(stopwatch: usize) -> String {
    if stopwatch == 0 {
        STATE_KEY.to_string()
    } else {
        format!("{}_{}", STATE_KEY, stopwatch + 1)
    }
}

fn stopwatch_id(key: &str) -> Option<usize> {
    if key == STATE_KEY {
        return Some(0);
    }
    key.strip_prefix(STATE_KEY)?
        .strip_prefix('_')?
        .parse::<usize>()
        .ok()?
        .checked_sub(1)
}

// Ids in display order: new stopwatches always get the highest id.
#[tauri::command]
fn list_stopwatches(app: tauri::AppHandle) -> Result<Vec<usize>, String> {
    let store = app
        .store("store.json")
        .map_err(|e| format!("Failed to get store: {}", e))?;

    let mut ids: Vec<usize> = store.keys().iter().filter_map(|key| stopwatch_id(key)).collect();
    ids.sort_unstable();
    Ok(ids)
}

#[tauri::command]
fn save_state(stopwatch: usize, state: StopwatchState, app: tauri::AppHandle) -> Result<(), String> {
    let store = app
        .store("store.json")
        .map_err(|e| format!("Failed to get store: {}", e))?;

    store
        .set(state_key(stopwatch), serde_json::to_value(&state).unwrap());
    
    store
        .save()
        .map_err(|e| format!("Failed to save store: {}", e))?;

    Ok(())
}

#[tauri::command]
fn get_state(stopwatch: usize, app: tauri::AppHandle) -> Result<Option<StopwatchState>, String> {
    let store = app
        .store("store.json")
        .map_err(|e| format!("Failed to get store: {}", e))?;

    let state = store.get(state_key(stopwatch));
    
    match state {
        Some(value) => {
            let state: StopwatchState = serde_json::from_value(value.clone())
                .map_err(|e| format!("Failed to deserialize state: {}", e))?;
            // Ensure time_logs field exists for backward compatibility
            if state.time_logs.is_empty() && state.start_time.is_some() {
                // Migration: if we have an old state without logs, keep it as is
            }
            Ok(Some(state))
        }
        None => Ok(None),
    }
}

#[tauri::command]
fn add_time_log(stopwatch: usize, log: TimeLog, app: tauri::AppHandle) -> Result<(), String> {
    let store = app
        .store("store.json")
        .map_err(|e| format!("Failed to get store: {}", e))?;

    let mut state: StopwatchState = match store.get(state_key(stopwatch)) {
        Some(value) => serde_json::from_value(value)
            .map_err(|e| format!("Failed to deserialize state: {}", e))?,
        None => StopwatchState {
            start_time: None,
            is_running: false,
            display_format: "hh:mm:ss".to_string(),
            time_logs: vec![],
        },
    };

    state.time_logs.push(log);
    store.set(state_key(stopwatch), serde_json::to_value(&state).unwrap());
    
    store
        .save()
        .map_err(|e| format!("Failed to save store: {}", e))?;

    Ok(())
}

#[tauri::command]
fn get_time_logs(stopwatch: usize, app: tauri::AppHandle) -> Result<Vec<TimeLog>, String> {
    let store = app
        .store("store.json")
        .map_err(|e| format!("Failed to get store: {}", e))?;

    match store.get(state_key(stopwatch)) {
        Some(value) => {
            let state: StopwatchState = serde_json::from_value(value)
                .map_err(|e| format!("Failed to deserialize state: {}", e))?;
            Ok(state.time_logs)
        }
        None => Ok(vec![]),
    }
}

#[tauri::command]
fn update_time_log(stopwatch: usize, index: usize, log: TimeLog, app: tauri::AppHandle) -> Result<(), String> {
    let store = app
        .store("store.json")
        .map_err(|e| format!("Failed to get store: {}", e))?;

    let mut state: StopwatchState = match store.get(state_key(stopwatch)) {
        Some(value) => serde_json::from_value(value)
            .map_err(|e| format!("Failed to deserialize state: {}", e))?,
        None => return Err("No state found".to_string()),
    };

    if index < state.time_logs.len() {
        state.time_logs[index] = log;
        store.set(state_key(stopwatch), serde_json::to_value(&state).unwrap());
        store
            .save()
            .map_err(|e| format!("Failed to save store: {}", e))?;
        Ok(())
    } else {
        Err(format!("Index {} out of range", index))
    }
}

#[tauri::command]
fn delete_time_log(stopwatch: usize, index: usize, app: tauri::AppHandle) -> Result<(), String> {
    let store = app
        .store("store.json")
        .map_err(|e| format!("Failed to get store: {}", e))?;

    let mut state: StopwatchState = match store.get(state_key(stopwatch)) {
        Some(value) => serde_json::from_value(value)
            .map_err(|e| format!("Failed to deserialize state: {}", e))?,
        None => return Err("No state found".to_string()),
    };

    if index < state.time_logs.len() {
        state.time_logs.remove(index);
        store.set(state_key(stopwatch), serde_json::to_value(&state).unwrap());
        store.save().map_err(|e| format!("Failed to save store: {}", e))?;
        Ok(())
    } else {
        Err(format!("Index {} out of range", index))
    }
}

#[tauri::command]
fn restore_time_log(stopwatch: usize, index: usize, log: TimeLog, app: tauri::AppHandle) -> Result<(), String> {
    let store = app
        .store("store.json")
        .map_err(|e| format!("Failed to get store: {}", e))?;

    let mut state: StopwatchState = match store.get(state_key(stopwatch)) {
        Some(value) => serde_json::from_value(value)
            .map_err(|e| format!("Failed to deserialize state: {}", e))?,
        None => return Err("No state found".to_string()),
    };

    let insert_at = index.min(state.time_logs.len());
    state.time_logs.insert(insert_at, log);
    store.set(state_key(stopwatch), serde_json::to_value(&state).unwrap());
    store.save().map_err(|e| format!("Failed to save store: {}", e))?;
    Ok(())
}

#[tauri::command]
fn remove_stopwatch(stopwatch: usize, app: tauri::AppHandle) -> Result<(), String> {
    let store = app
        .store("store.json")
        .map_err(|e| format!("Failed to get store: {}", e))?;

    store.delete(state_key(stopwatch));
    store.save().map_err(|e| format!("Failed to save store: {}", e))?;
    Ok(())
}

#[tauri::command]
fn clear_time_logs(stopwatch: usize, app: tauri::AppHandle) -> Result<(), String> {
    let store = app
        .store("store.json")
        .map_err(|e| format!("Failed to get store: {}", e))?;

    let mut state: StopwatchState = match store.get(state_key(stopwatch)) {
        Some(value) => serde_json::from_value(value)
            .map_err(|e| format!("Failed to deserialize state: {}", e))?,
        None => return Ok(()),
    };

    state.time_logs.clear();
    store.set(state_key(stopwatch), serde_json::to_value(&state).unwrap());
    
    store
        .save()
        .map_err(|e| format!("Failed to save store: {}", e))?;

    Ok(())
}

// Hide the (disabled) minimize and zoom buttons so the title has room to show.
#[cfg(target_os = "macos")]
fn hide_mac_window_buttons(window: &tauri::WebviewWindow) {
    use objc2_app_kit::{NSWindow, NSWindowButton};
    if let Ok(ptr) = window.ns_window() {
        let ns_window = unsafe { &*(ptr as *const NSWindow) };
        for kind in [NSWindowButton::MiniaturizeButton, NSWindowButton::ZoomButton] {
            if let Some(button) = ns_window.standardWindowButton(kind) {
                button.setHidden(true);
            }
        }
    }
}

fn main() {
    tauri::Builder::default()
        // Must be the first plugin registered. A second launch exits and raises this one.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                // Windows won't always raise a window on set_focus alone; briefly
                // pinning it forces it forward. Restore the pin a running stopwatch set.
                let pinned = window.is_always_on_top().unwrap_or(false);
                let _ = window.set_always_on_top(true);
                let _ = window.set_focus();
                let _ = window.set_always_on_top(pinned);
            }
        }))
        .setup(|_app| {
            // On macOS the menu lives in the system menu bar (not the window),
            // so setting an empty menu removes File/Edit/View/History without
            // adding any blank bar to the window itself. On Windows/Linux we
            // leave the menu alone – adding even an empty menu embeds a blank
            // bar inside the window frame and steals vertical space.
            #[cfg(target_os = "macos")]
            _app.set_menu(tauri::menu::Menu::new(_app.handle())?)?;
            #[cfg(target_os = "macos")]
            {
                if let Some(window) = _app.get_webview_window("main") {
                    hide_mac_window_buttons(&window);
                }
            }
            Ok(())
        })
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            list_stopwatches,
            save_state,
            get_state,
            add_time_log,
            get_time_logs,
            update_time_log,
            delete_time_log,
            restore_time_log,
            remove_stopwatch,
            clear_time_logs
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
