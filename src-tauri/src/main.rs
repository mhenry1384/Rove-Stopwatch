// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
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

#[tauri::command]
fn save_state(state: StopwatchState, app: tauri::AppHandle) -> Result<(), String> {
    let store = app
        .store("store.json")
        .map_err(|e| format!("Failed to get store: {}", e))?;

    store
        .set("stopwatch_state", serde_json::to_value(&state).unwrap());
    
    store
        .save()
        .map_err(|e| format!("Failed to save store: {}", e))?;

    Ok(())
}

#[tauri::command]
fn get_state(app: tauri::AppHandle) -> Result<Option<StopwatchState>, String> {
    let store = app
        .store("store.json")
        .map_err(|e| format!("Failed to get store: {}", e))?;

    let state = store.get("stopwatch_state");
    
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
fn add_time_log(log: TimeLog, app: tauri::AppHandle) -> Result<(), String> {
    let store = app
        .store("store.json")
        .map_err(|e| format!("Failed to get store: {}", e))?;

    let mut state: StopwatchState = match store.get("stopwatch_state") {
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
    store.set("stopwatch_state", serde_json::to_value(&state).unwrap());
    
    store
        .save()
        .map_err(|e| format!("Failed to save store: {}", e))?;

    Ok(())
}

#[tauri::command]
fn get_time_logs(app: tauri::AppHandle) -> Result<Vec<TimeLog>, String> {
    let store = app
        .store("store.json")
        .map_err(|e| format!("Failed to get store: {}", e))?;

    match store.get("stopwatch_state") {
        Some(value) => {
            let state: StopwatchState = serde_json::from_value(value)
                .map_err(|e| format!("Failed to deserialize state: {}", e))?;
            Ok(state.time_logs)
        }
        None => Ok(vec![]),
    }
}

#[tauri::command]
fn update_time_log(index: usize, log: TimeLog, app: tauri::AppHandle) -> Result<(), String> {
    let store = app
        .store("store.json")
        .map_err(|e| format!("Failed to get store: {}", e))?;

    let mut state: StopwatchState = match store.get("stopwatch_state") {
        Some(value) => serde_json::from_value(value)
            .map_err(|e| format!("Failed to deserialize state: {}", e))?,
        None => return Err("No state found".to_string()),
    };

    if index < state.time_logs.len() {
        state.time_logs[index] = log;
        store.set("stopwatch_state", serde_json::to_value(&state).unwrap());
        store
            .save()
            .map_err(|e| format!("Failed to save store: {}", e))?;
        Ok(())
    } else {
        Err(format!("Index {} out of range", index))
    }
}

#[tauri::command]
fn delete_time_log(index: usize, app: tauri::AppHandle) -> Result<(), String> {
    let store = app
        .store("store.json")
        .map_err(|e| format!("Failed to get store: {}", e))?;

    let mut state: StopwatchState = match store.get("stopwatch_state") {
        Some(value) => serde_json::from_value(value)
            .map_err(|e| format!("Failed to deserialize state: {}", e))?,
        None => return Err("No state found".to_string()),
    };

    if index < state.time_logs.len() {
        state.time_logs.remove(index);
        store.set("stopwatch_state", serde_json::to_value(&state).unwrap());
        store.save().map_err(|e| format!("Failed to save store: {}", e))?;
        Ok(())
    } else {
        Err(format!("Index {} out of range", index))
    }
}

#[tauri::command]
fn clear_time_logs(app: tauri::AppHandle) -> Result<(), String> {
    let store = app
        .store("store.json")
        .map_err(|e| format!("Failed to get store: {}", e))?;

    let mut state: StopwatchState = match store.get("stopwatch_state") {
        Some(value) => serde_json::from_value(value)
            .map_err(|e| format!("Failed to deserialize state: {}", e))?,
        None => return Ok(()),
    };

    state.time_logs.clear();
    store.set("stopwatch_state", serde_json::to_value(&state).unwrap());
    
    store
        .save()
        .map_err(|e| format!("Failed to save store: {}", e))?;

    Ok(())
}

fn main() {
    tauri::Builder::default()
        .setup(|_app| {
            // On macOS the menu lives in the system menu bar (not the window),
            // so setting an empty menu removes File/Edit/View/History without
            // adding any blank bar to the window itself. On Windows/Linux we
            // leave the menu alone – adding even an empty menu embeds a blank
            // bar inside the window frame and steals vertical space.
            #[cfg(target_os = "macos")]
            _app.set_menu(tauri::menu::Menu::new(_app.handle())?)?;
            Ok(())
        })
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            save_state,
            get_state,
            add_time_log,
            get_time_logs,
            update_time_log,
            delete_time_log,
            clear_time_logs
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
