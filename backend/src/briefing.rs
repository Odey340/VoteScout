use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

const OPENROUTER_URL: &str = "https://openrouter.ai/api/v1/chat/completions";
const MODEL: &str = "anthropic/claude-sonnet-5";

pub type BriefingCache = Arc<RwLock<HashMap<String, String>>>;

#[derive(Deserialize)]
pub struct BriefingRequest {
    pub race: String,
    pub candidates: Vec<CandidateInput>,
}

#[derive(Deserialize)]
pub struct CandidateInput {
    pub name: String,
    pub party: Option<String>,
}

#[derive(Serialize)]
struct ChatRequest<'a> {
    model: &'a str,
    max_tokens: u32,
    messages: Vec<ChatMessage<'a>>,
}

#[derive(Serialize)]
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

#[derive(Deserialize)]
struct OpenRouterErrorEnvelope {
    error: OpenRouterErrorBody,
}

#[derive(Deserialize)]
struct OpenRouterErrorBody {
    #[serde(default)]
    message: String,
}

/// Cache key: race plus the candidate roster, so a changed field re-generates.
pub fn cache_key(req: &BriefingRequest) -> String {
    let mut key = req.race.clone();
    for c in &req.candidates {
        key.push('|');
        key.push_str(&c.name);
        if let Some(p) = &c.party {
            key.push('~');
            key.push_str(p);
        }
    }
    key
}

fn build_prompt(req: &BriefingRequest) -> String {
    let roster = req
        .candidates
        .iter()
        .map(|c| match &c.party {
            Some(p) => format!("- {} ({})", c.name, p),
            None => format!("- {}", c.name),
        })
        .collect::<Vec<_>>()
        .join("\n");

    format!(
        "You are writing a neutral, nonpartisan voter briefing for the race \"{race}\".\n\
         The candidates are:\n{roster}\n\n\
         Write a concise briefing (under 300 words) with:\n\
         1. One short paragraph per candidate: who they are and their party affiliation.\n\
         2. A final section titled \"Key issues\" listing the 3 issues most likely to define this race.\n\n\
         Rules you must follow strictly:\n\
         - Treat all candidates evenhandedly: equal space, equal tone, no endorsements, \
           no language that flatters or disparages any candidate.\n\
         - If you are uncertain about a candidate or don't recognize them, say so plainly \
           (e.g. \"Little public information is available about this candidate\") rather than \
           inventing biography, positions, or accomplishments.\n\
         - Do not speculate about who is likely to win.\n\
         - Plain text only: no markdown headers, no bold, simple paragraphs and hyphenated lists.",
        race = req.race,
        roster = roster
    )
}

pub async fn generate_briefing(
    client: &reqwest::Client,
    api_key: &str,
    req: &BriefingRequest,
) -> Result<String, String> {
    let body = ChatRequest {
        model: MODEL,
        max_tokens: 1024,
        messages: vec![ChatMessage {
            role: "user",
            content: build_prompt(req),
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
        let detail = serde_json::from_str::<OpenRouterErrorEnvelope>(&text)
            .map(|e| e.error.message)
            .unwrap_or_else(|_| text.chars().take(300).collect());
        return Err(format!("OpenRouter returned HTTP {status}: {detail}"));
    }

    let parsed: ChatResponse =
        serde_json::from_str(&text).map_err(|e| format!("OpenRouter parse failed: {e}"))?;

    parsed
        .choices
        .into_iter()
        .next()
        .map(|c| c.message.content)
        .ok_or_else(|| "OpenRouter response contained no choices".to_string())
}
