use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;

const OPENROUTER_URL: &str = "https://openrouter.ai/api/v1/chat/completions";
const MODEL: &str = "anthropic/claude-sonnet-5";
const WIKI_TIMEOUT: Duration = Duration::from_secs(4);

pub type OfficeCache = Arc<RwLock<HashMap<String, Value>>>;

#[derive(Deserialize)]
pub struct OfficeQuery {
    pub office: String,
    #[serde(default)]
    pub state: String,
    /// Incumbent marker from Civic API contest data, when it has one.
    #[serde(default)]
    pub incumbent_hint: Option<String>,
    /// Comma-separated candidate names — lets the model spot an open seat.
    #[serde(default)]
    pub candidates: Option<String>,
}

pub fn cache_key(q: &OfficeQuery) -> String {
    format!("{}|{}", q.office.to_lowercase(), q.state.to_lowercase())
}

struct Grounding {
    text: String,
    sources: Vec<(String, String)>, // (label, url)
}

// ---------- Wikipedia grounding ----------

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
}

#[derive(Deserialize)]
struct WikiExtractResponse {
    query: Option<WikiExtractQuery>,
}

#[derive(Deserialize)]
struct WikiExtractQuery {
    pages: HashMap<String, WikiExtractPage>,
}

#[derive(Deserialize)]
struct WikiExtractPage {
    title: Option<String>,
    extract: Option<String>,
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

/// Office titles are fuzzier than person names: accept a hit when most of the
/// office query's meaningful words appear in the page title.
fn office_title_matches(query: &str, title: &str) -> bool {
    let stop = ["member", "of", "the", "for", "district"];
    let q = normalize(query);
    let t = normalize(title);
    let words: Vec<&str> = q
        .split(' ')
        .filter(|w| w.len() > 2 && !stop.contains(w))
        .collect();
    if words.is_empty() {
        return false;
    }
    let hits = words.iter().filter(|w| t.contains(**w)).count();
    hits * 100 / words.len() >= 60
}

/// Person names need the strict match — wrong-person grounding is worse
/// than none at all.
fn person_title_matches(name: &str, title: &str) -> bool {
    let n = normalize(name);
    let base = title.split('(').next().unwrap_or(title);
    let t = normalize(base);
    if n == t {
        return true;
    }
    let title_words: Vec<&str> = t.split(' ').collect();
    let mut idx = 0;
    for word in n.split(' ') {
        match title_words[idx..].iter().position(|w| *w == word) {
            Some(p) => idx += p + 1,
            None => return false,
        }
    }
    t.starts_with(n.split(' ').next().unwrap_or(""))
}

async fn wiki_search(client: &reqwest::Client, term: &str) -> Option<Vec<WikiSearchHit>> {
    let resp: WikiSearchResponse = client
        .get("https://en.wikipedia.org/w/api.php")
        .query(&[
            ("action", "query"),
            ("list", "search"),
            ("srsearch", term),
            ("srlimit", "5"),
            ("format", "json"),
        ])
        .send()
        .await
        .ok()?
        .json()
        .await
        .ok()?;
    resp.query.map(|q| q.search)
}

/// Lead-section plain-text extract plus the canonical page URL.
async fn wiki_extract(client: &reqwest::Client, title: &str) -> Option<(String, String, String)> {
    let resp: WikiExtractResponse = client
        .get("https://en.wikipedia.org/w/api.php")
        .query(&[
            ("action", "query"),
            ("titles", title),
            ("prop", "extracts"),
            ("exintro", "1"),
            ("explaintext", "1"),
            ("exchars", "1500"),
            ("format", "json"),
        ])
        .send()
        .await
        .ok()?
        .json()
        .await
        .ok()?;

    let page = resp.query?.pages.into_values().next()?;
    let title = page.title?;
    let extract = page.extract.filter(|e| e.len() > 100)?;
    let url = format!(
        "https://en.wikipedia.org/wiki/{}",
        title.replace(' ', "_")
    );
    Some((title, extract, url))
}

async fn gather_grounding(client: &reqwest::Client, q: &OfficeQuery) -> Grounding {
    let mut text = String::new();
    let mut sources = Vec::new();

    // Layer: the office itself.
    let office_query = format!("{} {}", q.office, q.state);
    if let Ok(Some(hits)) = tokio::time::timeout(WIKI_TIMEOUT, wiki_search(client, &office_query)).await {
        if let Some(hit) = hits.iter().find(|h| office_title_matches(&office_query, &h.title)) {
            if let Ok(Some((title, extract, url))) =
                tokio::time::timeout(WIKI_TIMEOUT, wiki_extract(client, &hit.title)).await
            {
                text.push_str(&format!("WIKIPEDIA — {title}:\n{extract}\n\n"));
                sources.push((format!("Wikipedia: {title}"), url));
            }
        }
    }

    // Layer: the incumbent, if the Civic data or caller hinted at one.
    if let Some(name) = q.incumbent_hint.as_deref().filter(|n| !n.trim().is_empty()) {
        if let Ok(Some(hits)) = tokio::time::timeout(WIKI_TIMEOUT, wiki_search(client, name)).await {
            if let Some(hit) = hits.iter().find(|h| person_title_matches(name, &h.title)) {
                if let Ok(Some((title, extract, url))) =
                    tokio::time::timeout(WIKI_TIMEOUT, wiki_extract(client, &hit.title)).await
                {
                    text.push_str(&format!("WIKIPEDIA — {title} (possible incumbent):\n{extract}\n\n"));
                    sources.push((format!("Wikipedia: {title}"), url));
                }
            }
        }
    }

    Grounding { text, sources }
}

// ---------- Claude synthesis ----------

#[derive(serde::Serialize)]
struct ChatRequest<'a> {
    model: &'a str,
    max_tokens: u32,
    messages: Vec<ChatMessage<'a>>,
}

#[derive(serde::Serialize)]
struct ChatMessage<'a> {
    role: &'a str,
    content: String,
}

#[derive(Deserialize)]
struct ChatResponse {
    choices: Vec<ChatChoice>,
}

#[derive(Deserialize)]
struct ChatChoice {
    message: ChatResponseMessage,
}

#[derive(Deserialize)]
struct ChatResponseMessage {
    content: String,
}

fn build_prompt(q: &OfficeQuery, grounding: &Grounding) -> String {
    let grounding_block = if grounding.text.is_empty() {
        "No reliable grounding material was found for this office.".to_string()
    } else {
        grounding.text.clone()
    };

    format!(
        "You are Groma, a nonpartisan voting assistant. Write an \"About this seat\" context \
         block for the office \"{office}\"{state_part}.\n\n\
         Grounding material (may be incomplete or slightly outdated):\n{grounding}\n\
         {candidates_part}{incumbent_part}\n\
         Produce three short sections, plain text, in this exact order:\n\
         1. CURRENT OFFICEHOLDER — who currently holds or last held this seat. Use \"as of\" \
            phrasing and note this may have changed. If the candidate list shows the officeholder \
            is not running, add: \"This seat is open — no incumbent is running.\" If it's a new \
            office or you cannot identify the holder, say so plainly.\n\
         2. WHAT THIS OFFICE DOES — 2-3 sentences in plain language about the office's actual \
            powers and responsibilities.\n\
         3. RECORD SNAPSHOT — the officeholder's major actions, votes, or decisions, presented \
            without evaluative language, balanced across the kinds of things supporters and \
            critics would each point to. Facts only, no adjectives like \"landmark\" or \
            \"controversial\".\n\n\
         Strict rules:\n\
         - Ground every claim in the material above or in widely established fact. When \
           uncertain, say so explicitly.\n\
         - If the office is too local or obscure for reliable information, write \"Reliable \
           information about this officeholder isn't available\" for the affected sections \
           rather than guessing.\n\
         - Never suggest the officeholder or any candidate is good or bad. No endorsements, \
           no predictions.\n\
         - Plain text only. Use the section titles above in caps. Under 250 words total.",
        office = q.office,
        state_part = if q.state.is_empty() {
            String::new()
        } else {
            format!(" in {}", q.state)
        },
        grounding = grounding_block,
        candidates_part = q
            .candidates
            .as_deref()
            .map(|c| format!("Candidates on the ballot: {c}\n"))
            .unwrap_or_default(),
        incumbent_part = q
            .incumbent_hint
            .as_deref()
            .map(|i| format!("Incumbent hint from election data: {i}\n"))
            .unwrap_or_default(),
    )
}

pub async fn generate(
    client: &reqwest::Client,
    api_key: &str,
    q: &OfficeQuery,
) -> Result<Value, String> {
    let grounding = gather_grounding(client, q).await;

    let body = ChatRequest {
        model: MODEL,
        // Reasoning tokens count toward the cap on this model; leave headroom
        // so the visible text never truncates mid-sentence.
        max_tokens: 3000,
        messages: vec![ChatMessage {
            role: "user",
            content: build_prompt(q, &grounding),
        }],
    };

    let resp = client
        .post(OPENROUTER_URL)
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("OpenRouter request failed: {e}"))?;

    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("OpenRouter body read failed: {e}"))?;

    if !status.is_success() {
        return Err(format!(
            "OpenRouter returned HTTP {status}: {}",
            text.chars().take(300).collect::<String>()
        ));
    }

    let parsed: ChatResponse =
        serde_json::from_str(&text).map_err(|e| format!("OpenRouter parse failed: {e}"))?;

    let context = parsed
        .choices
        .into_iter()
        .next()
        .map(|c| c.message.content)
        .ok_or_else(|| "OpenRouter response contained no choices".to_string())?;

    let mut sources: Vec<Value> = grounding
        .sources
        .iter()
        .map(|(label, url)| json!({ "label": label, "url": url }))
        .collect();
    sources.push(json!({ "label": "Check your registration (vote.gov)", "url": "https://vote.gov" }));
    sources.push(json!({
        "label": "Find your election office (usa.gov)",
        "url": "https://www.usa.gov/election-office"
    }));

    Ok(json!({ "context": context, "sources": sources }))
}
