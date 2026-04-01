use std::collections::HashMap;
use std::process::Child;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use crate::commands::whisper::WhisperServer;
use crate::python::get_python_bin;

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct DownloadProgress {
    pub progress: u64,
    pub total: u64,
    pub speed: f64,
    pub filename: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct InstallState {
    pub status: String,
    pub logs: Vec<String>,
}

impl Default for InstallState {
    fn default() -> Self {
        Self {
            status: "idle".to_string(),
            logs: Vec::new(),
        }
    }
}

pub struct AppState {
    pub comfy_process: Mutex<Option<Child>>,
    pub comfy_logs: Mutex<Vec<String>>,
    pub comfy_path: Mutex<Option<String>>,
    pub whisper: Mutex<WhisperServer>,
    pub downloads: Arc<Mutex<HashMap<String, DownloadProgress>>>,
    pub install_status: Mutex<InstallState>,
    pub searxng_install: Mutex<InstallState>,
    pub searxng_available: AtomicBool,
    pub python_bin: String,
}

impl AppState {
    pub fn new() -> Self {
        let python_bin = get_python_bin();
        println!("[Python] Resolved: {}", python_bin);

        Self {
            comfy_process: Mutex::new(None),
            comfy_logs: Mutex::new(Vec::new()),
            comfy_path: Mutex::new(None),
            whisper: Mutex::new(WhisperServer::new()),
            downloads: Arc::new(Mutex::new(HashMap::new())),
            install_status: Mutex::new(InstallState::default()),
            searxng_install: Mutex::new(InstallState::default()),
            searxng_available: AtomicBool::new(false),
            python_bin,
        }
    }
}

impl Drop for AppState {
    fn drop(&mut self) {
        // Kill ComfyUI process tree
        if let Ok(mut proc) = self.comfy_process.lock() {
            if let Some(ref mut child) = *proc {
                {
                    let pid = child.id();
                    if cfg!(target_os = "windows") {
                        let _ = std::process::Command::new("taskkill")
                            .args(["/pid", &pid.to_string(), "/T", "/F"])
                            .output();
                    } else {
                        let _ = child.kill();
                    }
                }
                println!("[ComfyUI] Stopped");
            }
        }

        // Stop Whisper server
        if let Ok(mut whisper) = self.whisper.lock() {
            whisper.stop();
        }
    }
}
