use serde::{Deserialize, Serialize};

const OPENROUTER_URL: &str = "https://openrouter.ai/api/v1/chat/completions";
const MODEL: &str = "anthropic/claude-sonnet-5";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VotingPlanRequest {
    pub address: String,
    #[serde(default)]
    pub interests: Vec<String>,
    #[serde(default)]
    pub selected_races: Vec<String>,
    pub elections: Vec<PlanElection>,
    #[serde(default)]
    pub lang: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanElection {
    pub name: String,
    pub date: String,
    #[serde(default)]
    pub polling_locations: Vec<PlanLocation>,
    #[serde(default)]
    pub early_vote_sites: Vec<PlanLocation>,
    #[serde(default)]
    pub drop_off_locations: Vec<PlanLocation>,
    #[serde(default)]
    pub contests: Vec<PlanContest>,
}

#[derive(Deserialize)]
pub struct PlanLocation {
    pub name: Option<String>,
    pub address: Option<String>,
    pub hours: Option<String>,
}

#[derive(Deserialize)]
pub struct PlanContest {
    pub office: String,
    #[serde(default)]
    pub candidates: Vec<PlanCandidate>,
}

#[derive(Deserialize)]
pub struct PlanCandidate {
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

fn location_line(loc: &PlanLocation) -> String {
    let mut parts = Vec::new();
    if let Some(n) = &loc.name {
        parts.push(n.clone());
    }
    if let Some(a) = &loc.address {
        parts.push(a.clone());
    }
    if let Some(h) = &loc.hours {
        // Hours can be a huge per-day list; the first few lines carry the gist.
        let brief: Vec<&str> = h.lines().take(3).collect();
        let mut hours = brief.join("; ");
        if h.lines().count() > 3 {
            hours.push_str("; (more days — see full schedule)");
        }
        parts.push(format!("hours: {hours}"));
    }
    parts.join(" — ")
}

fn build_prompt(req: &VotingPlanRequest) -> String {
    let mut data = String::new();

    for e in &req.elections {
        data.push_str(&format!("\nELECTION: {} on {}\n", e.name, e.date));
        if !e.polling_locations.is_empty() {
            data.push_str("Election-day polling locations:\n");
            for l in &e.polling_locations {
                data.push_str(&format!("  - {}\n", location_line(l)));
            }
        }
        if !e.early_vote_sites.is_empty() {
            data.push_str("Early voting sites:\n");
            for l in &e.early_vote_sites {
                data.push_str(&format!("  - {}\n", location_line(l)));
            }
        }
        if !e.drop_off_locations.is_empty() {
            data.push_str("Ballot drop-off locations:\n");
            for l in &e.drop_off_locations {
                data.push_str(&format!("  - {}\n", location_line(l)));
            }
        }
        for c in &e.contests {
            let selected = req.selected_races.iter().any(|r| r == &c.office);
            data.push_str(&format!(
                "Contest{}: {}\n",
                if selected { " (SELECTED BY VOTER)" } else { "" },
                c.office
            ));
            for cand in &c.candidates {
                match &cand.party {
                    Some(p) => data.push_str(&format!("  - {} ({})\n", cand.name, p)),
                    None => data.push_str(&format!("  - {}\n", cand.name)),
                }
            }
        }
    }

    let interests = if req.interests.is_empty() {
        "none stated".to_string()
    } else {
        req.interests.join(", ")
    };

    format!(
        "You are Groma, a nonpartisan voting assistant. Write a personalized plain-text \
         email a voter can send to themselves as their voting plan.\n\n\
         Voter's address: {address}\n\
         Voter's stated issue interests: {interests}\n\n\
         Election data (authoritative — use only this for dates, places, hours, and candidates):\n\
         {data}\n\n\
         The email must contain, in this order:\n\
         1. A short friendly greeting and one-line purpose.\n\
         2. \"Your elections\" — each election with its date.\n\
         3. \"Where to vote\" — election-day polling place(s) with hours, then early voting \
            options and ballot drop-offs if present.\n\
         4. \"Get ready\" — link to https://vote.gov for registration checks and \
            https://www.usa.gov/election-office to find their local election office. Use only \
            these two URLs; do not invent state-specific links.\n\
         5. \"Your races\" — for each contest marked (SELECTED BY VOTER): a brief neutral \
            briefing of the candidates (who they are, party), and where relevant note how the \
            race may touch the voter's stated interests ({interests}). If no races are marked, \
            briefly list the contests instead.\n\
         6. A closing reminder to verify details with their local election office.\n\n\
         Strict rules:\n\
         - Neutral between candidates: equal space and tone, no endorsements, no predictions, \
           nothing that flatters or disparages any candidate or party.\n\
         - Framing around interests means explaining what the office controls relevant to those \
           issues — never which candidate is better for them.\n\
         - If you don't recognize a candidate, say little public information is available \
           rather than inventing facts.\n\
         - Plain text only: no markdown symbols, no HTML. Use simple section titles in caps or \
           followed by a blank line, and hyphens for lists.\n\
         - Keep it under 500 words.\n\
         - Output only the email body, starting with the greeting — no subject line, no \
           commentary before or after.{lang_block}",
        address = req.address,
        interests = interests,
        data = data,
        lang_block = crate::lang::instruction(crate::lang::normalize(req.lang.as_deref())),
    )
}

pub async fn generate_plan_email(
    client: &reqwest::Client,
    api_key: &str,
    req: &VotingPlanRequest,
) -> Result<String, String> {
    let body = ChatRequest {
        model: MODEL,
        max_tokens: 2048,
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
        return Err(format!(
            "OpenRouter returned HTTP {status}: {}",
            text.chars().take(300).collect::<String>()
        ));
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

// ---------- ICS generation (no external crates) ----------

fn is_leap(y: u32) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}

fn days_in_month(y: u32, m: u32) -> u32 {
    match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if is_leap(y) {
                29
            } else {
                28
            }
        }
        _ => 30,
    }
}

/// "2026-11-03" -> ("20261103", "20261104"); DTEND is exclusive for all-day events.
fn ics_dates(date: &str) -> Option<(String, String)> {
    let parts: Vec<&str> = date.split('-').collect();
    if parts.len() != 3 {
        return None;
    }
    let (mut y, mut m, mut d): (u32, u32, u32) = (
        parts[0].parse().ok()?,
        parts[1].parse().ok()?,
        parts[2].parse().ok()?,
    );
    let start = format!("{y:04}{m:02}{d:02}");
    d += 1;
    if d > days_in_month(y, m) {
        d = 1;
        m += 1;
        if m > 12 {
            m = 1;
            y += 1;
        }
    }
    Some((start, format!("{y:04}{m:02}{d:02}")))
}

/// Escape per RFC 5545: backslash, semicolon, comma, newline.
fn ics_escape(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace(';', "\\;")
        .replace(',', "\\,")
        .replace('\r', "")
        .replace('\n', "\\n")
}

/// Fold lines to 75 octets with CRLF + space continuation (RFC 5545 §3.1).
fn ics_fold(line: &str) -> String {
    let mut out = String::new();
    let mut count = 0;
    for ch in line.chars() {
        let len = ch.len_utf8();
        if count + len > 73 {
            out.push_str("\r\n ");
            count = 1;
        }
        out.push(ch);
        count += len;
    }
    out
}

pub fn build_ics(req: &VotingPlanRequest) -> String {
    let mut lines: Vec<String> = vec![
        "BEGIN:VCALENDAR".into(),
        "VERSION:2.0".into(),
        "PRODID:-//Groma//Voting Plan//EN".into(),
        "CALSCALE:GREGORIAN".into(),
        "METHOD:PUBLISH".into(),
    ];

    for (i, e) in req.elections.iter().enumerate() {
        let Some((start, end)) = ics_dates(&e.date) else {
            continue;
        };

        let mut description = String::new();
        if let Some(loc) = e.polling_locations.first() {
            description.push_str("Polling place: ");
            description.push_str(&location_line(loc));
        }
        if !e.early_vote_sites.is_empty() {
            if !description.is_empty() {
                description.push('\n');
            }
            description.push_str("Early voting available — see your Groma plan.");
        }
        if description.is_empty() {
            description.push_str("Check your local election office for polling details.");
        }
        description.push_str("\nGenerated by Groma. Verify with official sources.");

        let location = e
            .polling_locations
            .first()
            .map(|l| {
                [l.name.as_deref(), l.address.as_deref()]
                    .into_iter()
                    .flatten()
                    .collect::<Vec<_>>()
                    .join(", ")
            })
            .unwrap_or_default();

        lines.push("BEGIN:VEVENT".into());
        lines.push(format!("UID:groma-{start}-{i}@groma.local"));
        lines.push(format!("DTSTAMP:{start}T000000Z"));
        lines.push(format!("DTSTART;VALUE=DATE:{start}"));
        lines.push(format!("DTEND;VALUE=DATE:{end}"));
        lines.push(format!("SUMMARY:Vote: {}", ics_escape(&e.name)));
        if !location.is_empty() {
            lines.push(format!("LOCATION:{}", ics_escape(&location)));
        }
        lines.push(format!("DESCRIPTION:{}", ics_escape(&description)));
        lines.push("BEGIN:VALARM".into());
        lines.push("ACTION:DISPLAY".into());
        lines.push(format!("DESCRIPTION:Election day: {}", ics_escape(&e.name)));
        lines.push("TRIGGER:-PT12H".into());
        lines.push("END:VALARM".into());
        lines.push("END:VEVENT".into());
    }

    lines.push("END:VCALENDAR".into());

    lines
        .into_iter()
        .map(|l| ics_fold(&l))
        .collect::<Vec<_>>()
        .join("\r\n")
        + "\r\n"
}
