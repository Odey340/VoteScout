use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

pub type PledgeCounts = Arc<RwLock<HashMap<String, u64>>>;

/// Deterministic per-zip seed in the 40–160 range so demo counters look
/// alive without ever showing zero. Real pledges increment from there.
fn seed_for(zip: &str) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in zip.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x1000_0000_01b3);
    }
    40 + (h % 121)
}

pub fn normalize_zip(raw: &str) -> Option<String> {
    let zip: String = raw.chars().filter(|c| c.is_ascii_digit()).take(5).collect();
    if zip.len() == 5 { Some(zip) } else { None }
}

pub async fn get_count(counts: &PledgeCounts, zip: &str) -> u64 {
    if let Some(n) = counts.read().await.get(zip) {
        return *n;
    }
    let mut w = counts.write().await;
    *w.entry(zip.to_string()).or_insert_with(|| seed_for(zip))
}

pub async fn increment(counts: &PledgeCounts, zip: &str) -> u64 {
    let mut w = counts.write().await;
    let entry = w.entry(zip.to_string()).or_insert_with(|| seed_for(zip));
    *entry += 1;
    *entry
}
