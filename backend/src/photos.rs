use serde::Deserialize;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;

const LAYER_TIMEOUT: Duration = Duration::from_secs(4);

#[derive(Clone)]
pub struct PhotoResult {
    pub url: Option<String>,
    pub source: Option<&'static str>,
}

pub type PhotoCache = Arc<RwLock<HashMap<String, PhotoResult>>>;

#[derive(Deserialize)]
pub struct PhotoQuery {
    pub name: String,
    #[serde(default)]
    pub context: String,
    /// photoUrl straight from the Civic API, if it had one (layer 1).
    #[serde(default)]
    pub photo_url: Option<String>,
    /// The candidate's own site, for og:image extraction (layer 3).
    #[serde(default)]
    pub candidate_url: Option<String>,
}

pub fn cache_key(q: &PhotoQuery) -> String {
    format!("{}|{}", q.name.to_lowercase(), q.context.to_lowercase())
}

pub async fn resolve(client: &reqwest::Client, q: &PhotoQuery) -> PhotoResult {
    // Layer 1: Civic API already gave us one.
    if let Some(url) = q.photo_url.as_deref() {
        if url.starts_with("http") {
            return PhotoResult {
                url: Some(url.to_string()),
                source: Some("official data"),
            };
        }
    }

    // Layer 2: Wikipedia lead image, only on a confident title match.
    if let Ok(Some(url)) =
        tokio::time::timeout(LAYER_TIMEOUT, wikipedia_lead_image(client, &q.name, &q.context))
            .await
    {
        return PhotoResult {
            url: Some(url),
            source: Some("Wikipedia"),
        };
    }

    // Layer 3: og:image from the campaign site.
    if let Some(site) = q.candidate_url.as_deref() {
        if let Ok(Some(url)) =
            tokio::time::timeout(LAYER_TIMEOUT, og_image(client, site)).await
        {
            return PhotoResult {
                url: Some(url),
                source: Some("campaign site"),
            };
        }
    }

    // Layer 4: nothing — the frontend draws an initials avatar.
    PhotoResult { url: None, source: None }
}

// ---------- Layer 2: Wikipedia ----------

#[derive(Deserialize)]
struct WikiSearchResponse {
    query: Option<WikiSearchQuery>,
}

#[derive(Deserialize)]
struct WikiSearchQuery {
    search: Vec<WikiSearchHit>,
}

#[derive(Deserialize)]
struct WikiSearchHit {
    title: String,
    #[serde(default)]
    snippet: String,
}

#[derive(Deserialize)]
struct WikiImageResponse {
    query: Option<WikiImageQuery>,
}

#[derive(Deserialize)]
struct WikiImageQuery {
    pages: HashMap<String, WikiPage>,
}

#[derive(Deserialize)]
struct WikiPage {
    thumbnail: Option<WikiThumb>,
}

#[derive(Deserialize)]
struct WikiThumb {
    source: String,
}

fn normalize(s: &str) -> String {
    s.to_lowercase()
        .chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace())
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Confident match: the page title equals the name, or is "name (something)"
/// — e.g. "John Smith (politician)". Anything looser risks the wrong person.
fn title_matches(name: &str, title: &str) -> bool {
    let n = normalize(name);
    let base = title.split('(').next().unwrap_or(title);
    let t = normalize(base);
    if n == t {
        return true;
    }
    // Allow a middle name/initial in the title: every word of the search
    // name must appear, in order, in the title.
    let title_words: Vec<&str> = t.split(' ').collect();
    let mut idx = 0;
    for word in n.split(' ') {
        match title_words[idx..].iter().position(|w| *w == word) {
            Some(p) => idx += p + 1,
            None => return false,
        }
    }
    // Reject if the title has words before the first matching name word
    // (e.g. searching "Dan Lee" matching "North Dan Lee Township").
    t.starts_with(n.split(' ').next().unwrap_or(""))
}

async fn wikipedia_lead_image(
    client: &reqwest::Client,
    name: &str,
    context: &str,
) -> Option<String> {
    // Search the NAME only — adding office context makes election-year pages
    // outrank the person. The context still gates confidence below: we only
    // accept a hit whose title matches the name, and prefer one whose search
    // snippet mentions a context word.
    let resp: WikiSearchResponse = client
        .get("https://en.wikipedia.org/w/api.php")
        .query(&[
            ("action", "query"),
            ("list", "search"),
            ("srsearch", name),
            ("srlimit", "5"),
            ("format", "json"),
        ])
        .send()
        .await
        .ok()?
        .json()
        .await
        .ok()?;

    let hits = resp.query?.search;
    let context_words: Vec<String> = context
        .split_whitespace()
        .filter(|w| w.len() > 3)
        .map(|w| w.to_lowercase())
        .collect();

    let matching: Vec<&WikiSearchHit> =
        hits.iter().filter(|h| title_matches(name, &h.title)).collect();
    // Prefer a title-matching hit whose snippet also mentions the office/state;
    // fall back to the first title match (title match alone is already strict).
    let title = matching
        .iter()
        .find(|h| {
            let snip = h.snippet.to_lowercase();
            context_words.iter().any(|w| snip.contains(w.as_str()))
        })
        .or(matching.first())?
        .title
        .clone();

    let resp: WikiImageResponse = client
        .get("https://en.wikipedia.org/w/api.php")
        .query(&[
            ("action", "query"),
            ("titles", title.as_str()),
            ("prop", "pageimages"),
            ("pithumbsize", "240"),
            ("format", "json"),
        ])
        .send()
        .await
        .ok()?
        .json()
        .await
        .ok()?;

    resp.query?
        .pages
        .into_values()
        .find_map(|p| p.thumbnail)
        .map(|t| t.source)
}

// ---------- Layer 3: og:image ----------

async fn og_image(client: &reqwest::Client, site: &str) -> Option<String> {
    if !site.starts_with("http") {
        return None;
    }
    let html = client
        .get(site)
        .header("User-Agent", "Groma/1.0 (civic information tool)")
        .send()
        .await
        .ok()?
        .text()
        .await
        .ok()?;

    // Only scan the head-ish region; og tags live early in the document.
    let head = &html[..html.len().min(40_000)];
    for pattern in [
        "property=\"og:image\"",
        "property='og:image'",
        "name=\"og:image\"",
    ] {
        if let Some(tag_pos) = head.find(pattern) {
            // content attr can precede or follow the property attr.
            let tag_start = head[..tag_pos].rfind('<')?;
            let tag_end = head[tag_pos..].find('>')? + tag_pos;
            let tag = &head[tag_start..tag_end];
            if let Some(url) = extract_attr(tag, "content") {
                if url.starts_with("http") {
                    return Some(url);
                }
            }
        }
    }
    None
}

fn extract_attr(tag: &str, attr: &str) -> Option<String> {
    for quote in ['"', '\''] {
        let needle = format!("{attr}={quote}");
        if let Some(start) = tag.find(&needle) {
            let rest = &tag[start + needle.len()..];
            if let Some(end) = rest.find(quote) {
                return Some(rest[..end].to_string());
            }
        }
    }
    None
}
