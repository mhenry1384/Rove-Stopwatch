// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use tauri::Manager;
use tauri_plugin_store::StoreExt;

#[derive(Debug, Serialize, Deserialize, Clone)]
struct StopwatchState {
    start_time: Option<i64>,
    is_running: bool,
    display_format: String,
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
            Ok(Some(state))
        }
        None => Ok(None),
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![save_state, get_state])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
