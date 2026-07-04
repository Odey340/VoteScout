use serde::Deserialize;
use serde_json::{Value, json};

const BASE_URL: &str = "https://www.googleapis.com/civicinfo/v2";

#[derive(Debug)]
pub enum CivicError {
    /// Google could not resolve the address precisely enough (e.g. ZIP only).
    AddressTooVague,
    /// Anything else that went wrong talking to Google.
    Upstream(String),
}

// ---------- Google response types ----------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ElectionsListResponse {
    #[serde(default)]
    pub elections: Vec<GoogleElection>,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GoogleElection {
    pub id: String,
    pub name: String,
    pub election_day: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoterInfoResponse {
    pub election: Option<GoogleElection>,
    #[serde(default)]
    pub polling_locations: Vec<GoogleLocation>,
    #[serde(default)]
    pub early_vote_sites: Vec<GoogleLocation>,
    #[serde(default)]
    pub drop_off_locations: Vec<GoogleLocation>,
    #[serde(default)]
    pub contests: Vec<GoogleContest>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleLocation {
    pub address: Option<GoogleAddress>,
    pub polling_hours: Option<String>,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub name: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleAddress {
    pub location_name: Option<String>,
    pub line1: Option<String>,
    pub line2: Option<String>,
    pub city: Option<String>,
    pub state: Option<String>,
    pub zip: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleContest {
    pub office: Option<String>,
    pub referendum_title: Option<String>,
    pub referendum_subtitle: Option<String>,
    pub district: Option<GoogleDistrict>,
    #[serde(default)]
    pub candidates: Vec<GoogleCandidate>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleDistrict {
    pub name: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleCandidate {
    pub name: Option<String>,
    pub party: Option<String>,
    pub candidate_url: Option<String>,
}

#[derive(Deserialize)]
struct GoogleErrorEnvelope {
    error: GoogleErrorBody,
}

#[derive(Deserialize)]
struct GoogleErrorBody {
    #[serde(default)]
    code: i64,
    #[serde(default)]
    message: String,
    #[serde(default)]
    errors: Vec<GoogleErrorDetail>,
}

#[derive(Deserialize)]
struct GoogleErrorDetail {
    #[serde(default)]
    reason: String,
}

// ---------- API calls ----------

pub async fn fetch_elections(
    client: &reqwest::Client,
    api_key: &str,
) -> Result<Vec<GoogleElection>, CivicError> {
    let resp = client
        .get(format!("{BASE_URL}/elections"))
        .query(&[("key", api_key)])
        .send()
        .await
        .map_err(|e| CivicError::Upstream(format!("electionQuery request failed: {e}")))?;

    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| CivicError::Upstream(format!("electionQuery body read failed: {e}")))?;

    if !status.is_success() {
        return Err(CivicError::Upstream(google_error_summary(
            "electionQuery",
            status.as_u16(),
            &body,
        )));
    }

    let parsed: ElectionsListResponse = serde_json::from_str(&body)
        .map_err(|e| CivicError::Upstream(format!("electionQuery parse failed: {e}")))?;
    Ok(parsed.elections)
}

/// Result of asking for voter info for one specific election.
pub enum VoterInfoOutcome {
    Found(VoterInfoResponse),
    /// Google has no data for this address/election combination.
    NoData,
}

pub async fn fetch_voter_info(
    client: &reqwest::Client,
    api_key: &str,
    address: &str,
    election_id: &str,
) -> Result<VoterInfoOutcome, CivicError> {
    let resp = client
        .get(format!("{BASE_URL}/voterinfo"))
        .query(&[
            ("key", api_key),
            ("address", address),
            ("electionId", election_id),
        ])
        .send()
        .await
        .map_err(|e| CivicError::Upstream(format!("voterInfoQuery request failed: {e}")))?;

    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| CivicError::Upstream(format!("voterInfoQuery body read failed: {e}")))?;

    if status.is_success() {
        let parsed: VoterInfoResponse = serde_json::from_str(&body)
            .map_err(|e| CivicError::Upstream(format!("voterInfoQuery parse failed: {e}")))?;
        // Google sometimes answers 200 with all-empty fields for elections
        // that don't cover this address; treat that as no data.
        if parsed.polling_locations.is_empty()
            && parsed.early_vote_sites.is_empty()
            && parsed.drop_off_locations.is_empty()
            && parsed.contests.is_empty()
        {
            return Ok(VoterInfoOutcome::NoData);
        }
        return Ok(VoterInfoOutcome::Found(parsed));
    }

    // Classify the failure using Google's structured error body.
    if let Ok(env) = serde_json::from_str::<GoogleErrorEnvelope>(&body) {
        let reasons: Vec<&str> = env.error.errors.iter().map(|d| d.reason.as_str()).collect();
        let msg = env.error.message.to_lowercase();
        if reasons.iter().any(|r| *r == "parseError") || msg.contains("parse") {
            return Err(CivicError::AddressTooVague);
        }
        if reasons.iter().any(|r| *r == "notFound") || env.error.code == 404 {
            return Ok(VoterInfoOutcome::NoData);
        }
    }

    Err(CivicError::Upstream(google_error_summary(
        "voterInfoQuery",
        status.as_u16(),
        &body,
    )))
}

fn google_error_summary(which: &str, status: u16, body: &str) -> String {
    let detail = serde_json::from_str::<GoogleErrorEnvelope>(body)
        .map(|e| e.error.message)
        .unwrap_or_else(|_| body.chars().take(300).collect());
    format!("{which} returned HTTP {status}: {detail}")
}

// ---------- Mapping into VoteScout's API shape ----------

pub fn map_election(election: &GoogleElection, info: &VoterInfoResponse) -> Value {
    // voterInfoQuery echoes the election it answered for; prefer that record.
    let election = info.election.as_ref().unwrap_or(election);
    json!({
        "id": election.id,
        "name": election.name,
        "date": election.election_day,
        "pollingLocations": info.polling_locations.iter().map(map_location).collect::<Vec<_>>(),
        "earlyVoteSites": info.early_vote_sites.iter().map(map_location).collect::<Vec<_>>(),
        "dropOffLocations": info.drop_off_locations.iter().map(map_location).collect::<Vec<_>>(),
        "contests": info.contests.iter().map(map_contest).collect::<Vec<_>>(),
    })
}

fn map_location(loc: &GoogleLocation) -> Value {
    let (name, address) = match &loc.address {
        Some(a) => {
            let street: Vec<&str> = [a.line1.as_deref(), a.line2.as_deref()]
                .into_iter()
                .flatten()
                .filter(|s| !s.is_empty())
                .collect();
            let locality: Vec<&str> = [a.city.as_deref(), a.state.as_deref(), a.zip.as_deref()]
                .into_iter()
                .flatten()
                .filter(|s| !s.is_empty())
                .collect();
            let mut parts = vec![street.join(" ")];
            parts.push(locality.join(", "));
            let full = parts
                .into_iter()
                .filter(|p| !p.is_empty())
                .collect::<Vec<_>>()
                .join(", ");
            (
                loc.name
                    .clone()
                    .or_else(|| a.location_name.clone())
                    .unwrap_or_else(|| "Polling place".to_string()),
                full,
            )
        }
        None => (
            loc.name.clone().unwrap_or_else(|| "Polling place".to_string()),
            String::new(),
        ),
    };

    json!({
        "name": name,
        "address": address,
        "lat": loc.latitude,
        "lng": loc.longitude,
        "hours": loc.polling_hours,
    })
}

fn map_contest(contest: &GoogleContest) -> Value {
    // Referendums have a title instead of an office and no candidate list.
    let office = contest
        .office
        .clone()
        .or_else(|| contest.referendum_title.clone())
        .unwrap_or_else(|| "Contest".to_string());

    json!({
        "office": office,
        "district": contest.district.as_ref().and_then(|d| d.name.clone()),
        "subtitle": contest.referendum_subtitle,
        "candidates": contest.candidates.iter().map(|c| json!({
            "name": c.name.clone().unwrap_or_else(|| "Unknown".to_string()),
            "party": c.party,
            "candidateUrl": c.candidate_url,
        })).collect::<Vec<_>>(),
    })
}
