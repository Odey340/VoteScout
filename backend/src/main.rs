mod briefing;
mod civic;
mod mock;
mod plan;
mod pledge;

use axum::{
    Router,
    extract::{Query, State},
    http::{HeaderValue, Method, StatusCode},
    response::Json,
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::sync::Arc;
use tower_http::cors::CorsLayer;

use briefing::{BatchBriefingRequest, BriefingCache, BriefingRequest};
use civic::{CivicError, VoterInfoOutcome};
use plan::VotingPlanRequest;
use pledge::PledgeCounts;

#[derive(Clone)]
struct AppState {
    client: reqwest::Client,
    api_key: Arc<String>,
    openrouter_key: Arc<Option<String>>,
    briefing_cache: BriefingCache,
    pledge_counts: PledgeCounts,
}

#[derive(Deserialize)]
struct ElectionsQuery {
    address: Option<String>,
    #[serde(default)]
    demo: bool,
}

async fn get_elections(
    State(state): State<AppState>,
    Query(params): Query<ElectionsQuery>,
) -> (StatusCode, Json<Value>) {
    let address = params.address.unwrap_or_default();

    if params.demo {
        return (StatusCode::OK, Json(mock::demo_response(&address)));
    }

    if address.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": { "code": "MISSING_ADDRESS", "message": "Please provide an address." }
            })),
        );
    }

    // A bare ZIP geocodes too imprecisely to place the voter in their
    // districts — Google just reports "no data", which reads as "no
    // elections". Catch it up front and ask for a street address instead.
    let trimmed = address.trim();
    if trimmed.len() <= 10
        && trimmed
            .chars()
            .all(|c| c.is_ascii_digit() || c == '-' || c == ' ')
    {
        return address_too_vague();
    }

    let elections = match civic::fetch_elections(&state.client, &state.api_key).await {
        Ok(e) => e,
        Err(e) => return upstream_error(e),
    };

    // Query voter info for every listed election concurrently; keep the ones
    // that have data for this address.
    let mut tasks = tokio::task::JoinSet::new();
    for election in elections {
        let client = state.client.clone();
        let api_key = state.api_key.clone();
        let address = address.clone();
        tasks.spawn(async move {
            let outcome = civic::fetch_voter_info(&client, &api_key, &address, &election.id).await;
            (election, outcome)
        });
    }

    let mut found = Vec::new();
    let mut vague_address = false;
    while let Some(joined) = tasks.join_next().await {
        let Ok((election, outcome)) = joined else {
            continue;
        };
        match outcome {
            Ok(VoterInfoOutcome::Found(info)) => {
                found.push((election.election_day.clone(), civic::map_election(&election, &info)));
            }
            Ok(VoterInfoOutcome::NoData) => {}
            Err(CivicError::AddressTooVague) => vague_address = true,
            // One election failing shouldn't sink results from the others.
            Err(CivicError::Upstream(msg)) => eprintln!("warning: {msg}"),
        }
    }

    if found.is_empty() && vague_address {
        return address_too_vague();
    }

    found.sort_by(|a, b| a.0.cmp(&b.0));
    let elections: Vec<Value> = found.into_iter().map(|(_, v)| v).collect();

    (
        StatusCode::OK,
        Json(json!({
            "query": { "address": address },
            "elections": elections,
            "message": if elections.is_empty() {
                Some("No upcoming supported elections found for that address.")
            } else {
                None
            },
        })),
    )
}

async fn candidate_summary(
    State(state): State<AppState>,
    Json(req): Json<BriefingRequest>,
) -> (StatusCode, Json<Value>) {
    if req.race.trim().is_empty() || req.candidates.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": { "code": "INVALID_REQUEST", "message": "race and candidates are required" }
            })),
        );
    }

    let Some(api_key) = state.openrouter_key.as_ref() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "error": { "code": "NOT_CONFIGURED", "message": "AI briefings are not configured on this server." }
            })),
        );
    };

    let key = briefing::cache_key(req.election_id.as_deref(), &req.race, &req.candidates);

    if let Some(cached) = state.briefing_cache.read().await.get(&key) {
        return (
            StatusCode::OK,
            Json(json!({ "race": req.race, "summary": cached, "cached": true })),
        );
    }

    match briefing::generate_briefing(&state.client, api_key, &req.race, &req.candidates).await {
        Ok(summary) => {
            state
                .briefing_cache
                .write()
                .await
                .insert(key, summary.clone());
            (
                StatusCode::OK,
                Json(json!({ "race": req.race, "summary": summary, "cached": false })),
            )
        }
        Err(msg) => {
            eprintln!("briefing error: {msg}");
            (
                StatusCode::BAD_GATEWAY,
                Json(json!({
                    "error": { "code": "UPSTREAM_ERROR", "message": "Couldn't generate the briefing right now. Please try again shortly." }
                })),
            )
        }
    }
}

/// Generate briefings for every race concurrently and stream results as
/// NDJSON — one line per race, written the moment that race finishes, so the
/// client can fill in cards without waiting for the slowest one.
async fn briefings_batch(
    State(state): State<AppState>,
    Json(req): Json<BatchBriefingRequest>,
) -> axum::response::Response {
    use axum::body::Body;
    use axum::response::IntoResponse;

    if req.races.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": { "code": "INVALID_REQUEST", "message": "races are required" }
            })),
        )
            .into_response();
    }

    let Some(api_key) = state.openrouter_key.as_ref() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "error": { "code": "NOT_CONFIGURED", "message": "AI briefings are not configured on this server." }
            })),
        )
            .into_response();
    };

    let (tx, rx) = tokio::sync::mpsc::channel::<Result<String, std::io::Error>>(16);
    let election_id = req.election_id.clone();

    for race in req.races {
        let client = state.client.clone();
        let api_key = api_key.clone();
        let cache = state.briefing_cache.clone();
        let tx = tx.clone();
        let key = briefing::cache_key(election_id.as_deref(), &race.race, &race.candidates);
        tokio::spawn(async move {
            let line = if let Some(cached) = cache.read().await.get(&key).cloned() {
                json!({ "race": race.race, "summary": cached, "cached": true })
            } else {
                match briefing::generate_briefing(&client, &api_key, &race.race, &race.candidates)
                    .await
                {
                    Ok(summary) => {
                        cache.write().await.insert(key, summary.clone());
                        json!({ "race": race.race, "summary": summary, "cached": false })
                    }
                    Err(msg) => {
                        eprintln!("batch briefing error for {}: {msg}", race.race);
                        json!({ "race": race.race, "error": true })
                    }
                }
            };
            // Receiver dropped means the client disconnected; nothing to do.
            let _ = tx.send(Ok(format!("{line}\n"))).await;
        });
    }
    drop(tx); // stream ends when the last task finishes

    let stream = tokio_stream::wrappers::ReceiverStream::new(rx);
    (
        [(axum::http::header::CONTENT_TYPE, "application/x-ndjson")],
        Body::from_stream(stream),
    )
        .into_response()
}

#[derive(Deserialize)]
struct PledgeQuery {
    zip: String,
}

async fn pledge_count(
    State(state): State<AppState>,
    Query(q): Query<PledgeQuery>,
) -> (StatusCode, Json<Value>) {
    let Some(zip) = pledge::normalize_zip(&q.zip) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": { "code": "INVALID_ZIP", "message": "A 5-digit ZIP is required." } })),
        );
    };
    let count = pledge::get_count(&state.pledge_counts, &zip).await;
    (StatusCode::OK, Json(json!({ "zip": zip, "count": count })))
}

#[derive(Deserialize)]
struct PledgeBody {
    zip: String,
}

async fn pledge_add(
    State(state): State<AppState>,
    Json(body): Json<PledgeBody>,
) -> (StatusCode, Json<Value>) {
    let Some(zip) = pledge::normalize_zip(&body.zip) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": { "code": "INVALID_ZIP", "message": "A 5-digit ZIP is required." } })),
        );
    };
    let count = pledge::increment(&state.pledge_counts, &zip).await;
    (StatusCode::OK, Json(json!({ "zip": zip, "count": count })))
}

async fn voting_plan(
    State(state): State<AppState>,
    Json(req): Json<VotingPlanRequest>,
) -> (StatusCode, Json<Value>) {
    if req.elections.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": { "code": "INVALID_REQUEST", "message": "elections data is required" }
            })),
        );
    }

    let Some(api_key) = state.openrouter_key.as_ref() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "error": { "code": "NOT_CONFIGURED", "message": "AI features are not configured on this server." }
            })),
        );
    };

    let ics = plan::build_ics(&req);

    match plan::generate_plan_email(&state.client, api_key, &req).await {
        Ok(email) => (
            StatusCode::OK,
            Json(json!({ "email": email, "ics": ics })),
        ),
        Err(msg) => {
            eprintln!("voting-plan error: {msg}");
            (
                StatusCode::BAD_GATEWAY,
                Json(json!({
                    "error": { "code": "UPSTREAM_ERROR", "message": "Couldn't generate your voting plan right now. Please try again shortly." }
                })),
            )
        }
    }
}

fn address_too_vague() -> (StatusCode, Json<Value>) {
    (
        StatusCode::UNPROCESSABLE_ENTITY,
        Json(json!({
            "error": {
                "code": "ADDRESS_TOO_VAGUE",
                "message": "That address isn't specific enough. Please add your street address."
            }
        })),
    )
}

fn upstream_error(err: CivicError) -> (StatusCode, Json<Value>) {
    let msg = match err {
        CivicError::AddressTooVague => "Address could not be understood.".to_string(),
        CivicError::Upstream(m) => m,
    };
    eprintln!("upstream error: {msg}");
    (
        StatusCode::BAD_GATEWAY,
        Json(json!({
            "error": {
                "code": "UPSTREAM_ERROR",
                "message": "Couldn't reach the election data service. Please try again shortly."
            }
        })),
    )
}

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();

    let api_key = std::env::var("GOOGLE_CIVIC_API_KEY")
        .expect("GOOGLE_CIVIC_API_KEY must be set in backend/.env");

    let openrouter_key = std::env::var("OPENROUTER_API_KEY")
        .ok()
        .filter(|k| !k.trim().is_empty() && !k.starts_with("your-"));
    if openrouter_key.is_none() {
        eprintln!("warning: OPENROUTER_API_KEY not set — /api/candidate-summary disabled");
    }

    let frontend_origin = std::env::var("FRONTEND_ORIGIN")
        .unwrap_or_else(|_| "http://localhost:5173".to_string());

    let cors = CorsLayer::new()
        .allow_origin(frontend_origin.parse::<HeaderValue>().unwrap())
        .allow_methods([Method::GET, Method::POST])
        .allow_headers([axum::http::header::CONTENT_TYPE]);

    let state = AppState {
        client: reqwest::Client::new(),
        api_key: Arc::new(api_key),
        openrouter_key: Arc::new(openrouter_key),
        briefing_cache: BriefingCache::default(),
        pledge_counts: PledgeCounts::default(),
    };

    let app = Router::new()
        .route("/api/elections", get(get_elections))
        .route("/api/candidate-summary", post(candidate_summary))
        .route("/api/briefings/batch", post(briefings_batch))
        .route("/api/pledges", get(pledge_count).post(pledge_add))
        .route("/api/voting-plan", post(voting_plan))
        .with_state(state)
        .layer(cors);

    let port = std::env::var("PORT").unwrap_or_else(|_| "3001".to_string());
    let addr = format!("0.0.0.0:{port}");
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    println!("VoteScout backend listening on http://localhost:{port}");
    axum::serve(listener, app).await.unwrap();
}
