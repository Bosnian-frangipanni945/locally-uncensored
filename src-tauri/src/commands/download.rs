use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use futures_util::StreamExt;
use tauri::State;

use crate::state::{AppState, DownloadProgress};

fn models_dir(comfy_path: &Option<String>, subfolder: &str) -> Result<PathBuf, String> {
    let base = comfy_path.as_ref().ok_or("ComfyUI path not set. Please set it in settings or install ComfyUI first.")?;
    let dir = PathBuf::from(base).join("models").join(subfolder);
    fs::create_dir_all(&dir).map_err(|e| format!("Create models dir: {}", e))?;
    Ok(dir)
}

#[tauri::command]
pub async fn download_model(
    url: String,
    subfolder: String,
    filename: String,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let comfy_path = {
        let p = state.comfy_path.lock().unwrap();
        p.clone()
    };

    let dest_dir = models_dir(&comfy_path, &subfolder)?;
    let dest_file = dest_dir.join(&filename);

    if dest_file.exists() {
        return Ok(serde_json::json!({"status": "exists", "path": dest_file.to_string_lossy()}));
    }

    let id = format!("{}-{}", subfolder, filename);

    // Initialize progress
    {
        let mut downloads = state.downloads.lock().unwrap();
        downloads.insert(id.clone(), DownloadProgress {
            progress: 0,
            total: 0,
            speed: 0.0,
            filename: filename.clone(),
            status: "connecting".to_string(),
            error: None,
        });
    }

    // Clone the Arc so the spawned task can update progress
    let downloads_arc = Arc::clone(&state.downloads);
    let id_clone = id.clone();
    let filename_clone = filename.clone();

    tokio::spawn(async move {
        match do_download(&url, &dest_file, &downloads_arc, &id_clone).await {
            Ok(_) => {
                if let Ok(mut dl) = downloads_arc.lock() {
                    if let Some(p) = dl.get_mut(&id_clone) {
                        p.status = "complete".to_string();
                    }
                }
                println!("[Download] Complete: {}", filename_clone);
            }
            Err(e) => {
                if let Ok(mut dl) = downloads_arc.lock() {
                    if let Some(p) = dl.get_mut(&id_clone) {
                        p.status = "error".to_string();
                        p.error = Some(e.clone());
                    }
                }
                println!("[Download] Failed: {} - {}", filename_clone, e);
            }
        }
    });

    Ok(serde_json::json!({"status": "started", "id": id}))
}

async fn do_download(
    url: &str,
    dest: &PathBuf,
    downloads: &Arc<Mutex<HashMap<String, DownloadProgress>>>,
    id: &str,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .user_agent("LocallyUncensored/1.5")
        .redirect(reqwest::redirect::Policy::limited(10))
        .timeout(std::time::Duration::from_secs(7200)) // 2 hours for large models
        .build()
        .map_err(|e| e.to_string())?;

    let response = client.get(url)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }

    let total = response.content_length().unwrap_or(0);

    // Update total size
    if let Ok(mut dl) = downloads.lock() {
        if let Some(p) = dl.get_mut(id) {
            p.total = total;
            p.status = "downloading".to_string();
        }
    }

    let tmp_path = dest.with_extension("download");
    let mut file = tokio::fs::File::create(&tmp_path)
        .await
        .map_err(|e| format!("Create file: {}", e))?;

    let mut stream = response.bytes_stream();
    let mut downloaded: u64 = 0;
    let start = Instant::now();
    let mut last_update = Instant::now();

    use tokio::io::AsyncWriteExt;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Stream error: {}", e))?;
        file.write_all(&chunk).await.map_err(|e| format!("Write: {}", e))?;
        downloaded += chunk.len() as u64;

        // Update progress every 500ms
        if last_update.elapsed().as_millis() > 500 {
            last_update = Instant::now();
            let elapsed = start.elapsed().as_secs_f64();
            let speed = if elapsed > 0.0 { downloaded as f64 / elapsed } else { 0.0 };

            if let Ok(mut dl) = downloads.lock() {
                if let Some(p) = dl.get_mut(id) {
                    p.progress = downloaded;
                    p.speed = speed;
                }
            }
        }
    }

    file.flush().await.map_err(|e| format!("Flush: {}", e))?;
    drop(file);

    tokio::fs::rename(&tmp_path, dest)
        .await
        .map_err(|e| format!("Rename: {}", e))?;

    // Final progress update
    if let Ok(mut dl) = downloads.lock() {
        if let Some(p) = dl.get_mut(id) {
            p.progress = downloaded;
            p.total = downloaded;
            p.status = "complete".to_string();
        }
    }

    Ok(())
}

#[tauri::command]
pub fn download_progress(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let downloads = state.downloads.lock().unwrap();
    let map: HashMap<String, DownloadProgress> = downloads.clone();
    Ok(serde_json::to_value(map).unwrap_or_default())
}
