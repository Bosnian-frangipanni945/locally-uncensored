use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tauri::State;

use crate::state::AppState;

/// Skip these directories during ComfyUI search
const SKIP_DIRS: &[&str] = &[
    "node_modules", ".git", "__pycache__", "venv", ".venv", "site-packages",
    "Windows", "Program Files", "Program Files (x86)", "$Recycle.Bin", "AppData",
];

fn scan_for_comfyui(dir: &Path, depth: u32) -> Option<PathBuf> {
    if depth == 0 {
        return None;
    }
    let entries = fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let file_type = entry.file_type().ok()?;
        if !file_type.is_dir() {
            continue;
        }
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if name_str.starts_with('.') || SKIP_DIRS.contains(&name_str.as_ref()) {
            continue;
        }
        let full = entry.path();
        // Check if this directory IS ComfyUI
        if name_str.eq_ignore_ascii_case("comfyui") && full.join("main.py").exists() {
            return Some(full);
        }
        // Recurse deeper
        if let Some(found) = scan_for_comfyui(&full, depth - 1) {
            return Some(found);
        }
    }
    None
}

pub fn find_comfyui_path() -> Option<String> {
    // 1. Check environment variable
    if let Ok(env_path) = std::env::var("COMFYUI_PATH") {
        if Path::new(&env_path).join("main.py").exists() {
            return Some(env_path);
        }
    }

    // 2. Read from app config
    if let Some(config_dir) = dirs::config_dir() {
        let config_file = config_dir.join("locally-uncensored").join("config.json");
        if config_file.exists() {
            if let Ok(content) = fs::read_to_string(&config_file) {
                if let Ok(config) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let Some(path) = config.get("comfyui_path").and_then(|v| v.as_str()) {
                        if Path::new(path).join("main.py").exists() {
                            return Some(path.to_string());
                        }
                    }
                }
            }
        }
    }

    let home = dirs::home_dir().unwrap_or_default();

    // 3. Check common fixed locations
    let fixed = [
        home.join("ComfyUI"),
        home.join("Desktop").join("ComfyUI"),
        home.join("Documents").join("ComfyUI"),
        PathBuf::from("C:\\ComfyUI"),
    ];
    for p in &fixed {
        if p.join("main.py").exists() {
            return Some(p.to_string_lossy().to_string());
        }
    }

    // 4. Recursive scan of Desktop, Documents, Downloads, and drive roots
    let mut scan_roots: Vec<PathBuf> = vec![
        home.join("Desktop"),
        home.join("Documents"),
        home.join("Downloads"),
    ];
    if cfg!(target_os = "windows") {
        scan_roots.push(PathBuf::from("C:\\"));
        scan_roots.push(PathBuf::from("D:\\"));
    } else {
        scan_roots.push(PathBuf::from("/opt"));
        scan_roots.push(PathBuf::from("/usr/local"));
    }

    for root in &scan_roots {
        if root.exists() {
            if let Some(found) = scan_for_comfyui(root, 4) {
                return Some(found.to_string_lossy().to_string());
            }
        }
    }

    None
}

fn is_comfyui_running() -> bool {
    reqwest::blocking::get("http://localhost:8188/system_stats")
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

#[tauri::command]
pub fn start_ollama(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    // Check if already running
    if let Ok(output) = Command::new("tasklist")
        .args(["/FI", "IMAGENAME eq ollama.exe"])
        .output()
    {
        let stdout = String::from_utf8_lossy(&output.stdout);
        if stdout.contains("ollama.exe") {
            println!("[Ollama] Already running");
            return Ok(serde_json::json!({"status": "already_running"}));
        }
    }

    println!("[Ollama] Starting...");
    let result = Command::new("ollama")
        .arg("serve")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();

    match result {
        Ok(_) => {
            println!("[Ollama] Started");
            Ok(serde_json::json!({"status": "started"}))
        }
        Err(e) => {
            println!("[Ollama] Failed to start: {}", e);
            Ok(serde_json::json!({"status": "error", "error": e.to_string()}))
        }
    }
}

#[tauri::command]
pub fn start_comfyui(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    if is_comfyui_running() {
        return Ok(serde_json::json!({"status": "already_running"}));
    }

    let comfy_path = {
        let path = state.comfy_path.lock().unwrap();
        path.clone()
    };

    let comfy_path = comfy_path
        .or_else(|| find_comfyui_path())
        .ok_or_else(|| "ComfyUI not found".to_string())?;

    // Store the path for future use
    {
        let mut path = state.comfy_path.lock().unwrap();
        *path = Some(comfy_path.clone());
    }

    // Validate python binary exists
    let python = &state.python_bin;
    println!("[ComfyUI] Using Python: {}", python);
    println!("[ComfyUI] Starting from: {}", comfy_path);

    let mut child = Command::new(python)
        .args(["main.py", "--listen", "127.0.0.1", "--port", "8188"])
        .current_dir(&comfy_path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start ComfyUI (python={}): {}", python, e))?;

    // Read stdout/stderr in background threads to prevent deadlock
    let logs = state.comfy_logs.lock().unwrap().clone();
    drop(logs);

    if let Some(stdout) = child.stdout.take() {
        let logs_ref = state.comfy_logs.lock().unwrap().clone();
        drop(logs_ref);
        std::thread::spawn(move || {
            use std::io::{BufRead, BufReader};
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                if let Ok(line) = line {
                    println!("[ComfyUI] {}", line);
                }
            }
        });
    }

    if let Some(stderr) = child.stderr.take() {
        std::thread::spawn(move || {
            use std::io::{BufRead, BufReader};
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                if let Ok(line) = line {
                    println!("[ComfyUI] {}", line);
                }
            }
        });
    }

    // Store process
    {
        let mut proc = state.comfy_process.lock().unwrap();
        *proc = Some(child);
    }

    println!("[ComfyUI] Started");
    Ok(serde_json::json!({"status": "started", "path": comfy_path}))
}

#[tauri::command]
pub fn stop_comfyui(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let mut proc = state.comfy_process.lock().unwrap();
    if let Some(ref mut child) = *proc {
        let pid = child.id();
        if cfg!(target_os = "windows") {
            let _ = Command::new("taskkill")
                .args(["/pid", &pid.to_string(), "/T", "/F"])
                .output();
        } else {
            let _ = child.kill();
        }
        *proc = None;
        println!("[ComfyUI] Stopped");
        Ok(serde_json::json!({"status": "stopped"}))
    } else {
        Ok(serde_json::json!({"status": "not_running"}))
    }
}

#[tauri::command]
pub async fn comfyui_status(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let running = reqwest::get("http://localhost:8188/system_stats")
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false);

    let process_alive = {
        let proc = state.comfy_process.lock().unwrap();
        proc.is_some()
    };

    let path = {
        let p = state.comfy_path.lock().unwrap();
        p.clone()
    };

    let found = path.is_some() || find_comfyui_path().is_some();

    Ok(serde_json::json!({
        "running": running,
        "starting": process_alive && !running,
        "found": found,
        "path": path,
        "processAlive": process_alive,
    }))
}

#[tauri::command]
pub fn find_comfyui() -> Result<serde_json::Value, String> {
    match find_comfyui_path() {
        Some(path) => Ok(serde_json::json!({"found": true, "path": path})),
        None => Ok(serde_json::json!({"found": false, "path": null})),
    }
}

#[tauri::command]
pub fn set_comfyui_path(path: String, state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let main_py = Path::new(&path).join("main.py");
    if !main_py.exists() {
        return Err(format!("main.py not found in {}", path));
    }

    // Store in memory
    {
        let mut p = state.comfy_path.lock().unwrap();
        *p = Some(path.clone());
    }

    // Persist to config file
    if let Some(config_dir) = dirs::config_dir() {
        let app_config = config_dir.join("locally-uncensored");
        let _ = fs::create_dir_all(&app_config);
        let config_file = app_config.join("config.json");

        let mut config: serde_json::Value = if config_file.exists() {
            fs::read_to_string(&config_file)
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_else(|| serde_json::json!({}))
        } else {
            serde_json::json!({})
        };

        config["comfyui_path"] = serde_json::json!(path);
        let _ = fs::write(&config_file, serde_json::to_string_pretty(&config).unwrap());
    }

    Ok(serde_json::json!({"status": "saved", "path": path}))
}

/// Auto-start Ollama on app launch (called from setup)
pub fn auto_start_ollama(state: &AppState) {
    // Check if already running
    if let Ok(output) = Command::new("tasklist")
        .args(["/FI", "IMAGENAME eq ollama.exe"])
        .output()
    {
        let stdout = String::from_utf8_lossy(&output.stdout);
        if stdout.contains("ollama.exe") {
            println!("[Ollama] Already running");
            return;
        }
    }

    println!("[Ollama] Starting...");
    match Command::new("ollama")
        .arg("serve")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(_) => println!("[Ollama] Started"),
        Err(e) => println!("[Ollama] Failed to start: {}", e),
    }
}

/// Auto-start ComfyUI on app launch (called from setup)
pub fn auto_start_comfyui(state: &AppState) {
    if is_comfyui_running() {
        println!("[ComfyUI] Already running on port 8188");
        return;
    }

    match find_comfyui_path() {
        Some(path) => {
            println!("[ComfyUI] Auto-starting from: {}", path);
            *state.comfy_path.lock().unwrap() = Some(path.clone());

            match Command::new(&state.python_bin)
                .args(["main.py", "--listen", "127.0.0.1", "--port", "8188"])
                .current_dir(&path)
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
            {
                Ok(child) => {
                    *state.comfy_process.lock().unwrap() = Some(child);
                    println!("[ComfyUI] Started");
                }
                Err(e) => println!("[ComfyUI] Failed to start: {}", e),
            }
        }
        None => println!("[ComfyUI] Not found. Install ComfyUI or set path in settings."),
    }
}
