use serde_json::{Value, json};

/// Demo payload served for `?demo=true` so there is always something to show.
pub fn demo_response(address: &str) -> Value {
    json!({
        "query": { "address": address },
        "demo": true,
        "elections": [
            {
                "id": "gen-2026",
                "name": "2026 General Election",
                "date": "2026-11-03",
                "pollingLocations": [
                    {
                        "name": "Lincoln Elementary School",
                        "address": "742 Evergreen Terrace",
                        "lat": 39.9526,
                        "lng": -75.1652,
                        "hours": "7:00 AM - 8:00 PM"
                    },
                    {
                        "name": "Riverside Community Center",
                        "address": "18 River Rd",
                        "lat": 39.9612,
                        "lng": -75.1580,
                        "hours": "7:00 AM - 8:00 PM"
                    }
                ],
                "earlyVoteSites": [
                    {
                        "name": "County Election Office",
                        "address": "100 Government Plaza",
                        "lat": 39.9500,
                        "lng": -75.1600,
                        "hours": "Mon-Fri 9:00 AM - 5:00 PM, Oct 20 - Nov 1"
                    }
                ],
                "dropOffLocations": [
                    {
                        "name": "City Hall Ballot Drop Box",
                        "address": "1 City Hall Sq",
                        "lat": 39.9530,
                        "lng": -75.1640,
                        "hours": "24 hours through Election Day"
                    }
                ],
                "contests": [
                    {
                        "office": "U.S. Senate",
                        "district": "Pennsylvania",
                        "subtitle": null,
                        "candidates": [
                            { "name": "Maria Alvarez", "party": "Democratic", "candidateUrl": "https://example.com/alvarez" },
                            { "name": "John Whitfield", "party": "Republican", "candidateUrl": "https://example.com/whitfield" },
                            { "name": "Dana Kim", "party": "Independent", "candidateUrl": null }
                        ]
                    },
                    {
                        "office": "Governor",
                        "district": "Pennsylvania",
                        "subtitle": null,
                        "candidates": [
                            { "name": "Samuel Ortiz", "party": "Democratic", "candidateUrl": null },
                            { "name": "Rebecca Lane", "party": "Republican", "candidateUrl": null }
                        ]
                    },
                    {
                        "office": "State Ballot Measure 4: Transit Funding",
                        "district": "Pennsylvania",
                        "subtitle": "Authorizes $2.1B in bonds for regional transit improvements",
                        "candidates": [
                            { "name": "Yes", "party": null, "candidateUrl": null },
                            { "name": "No", "party": null, "candidateUrl": null }
                        ]
                    }
                ]
            },
            {
                "id": "primary-2026",
                "name": "2026 Municipal Primary",
                "date": "2026-08-18",
                "pollingLocations": [
                    {
                        "name": "Fire Station No. 7",
                        "address": "1200 Oak Ave",
                        "lat": 39.9480,
                        "lng": -75.1710,
                        "hours": "6:30 AM - 7:30 PM"
                    }
                ],
                "earlyVoteSites": [],
                "dropOffLocations": [],
                "contests": [
                    {
                        "office": "Mayor",
                        "district": "City of Springfield",
                        "subtitle": null,
                        "candidates": [
                            { "name": "Priya Natarajan", "party": "Democratic", "candidateUrl": null },
                            { "name": "Carl Jensen", "party": "Democratic", "candidateUrl": null },
                            { "name": "Alicia Fontaine", "party": "Republican", "candidateUrl": null }
                        ]
                    },
                    {
                        "office": "City Council District 3",
                        "district": "District 3",
                        "subtitle": null,
                        "candidates": [
                            { "name": "Tom Beckett", "party": "Democratic", "candidateUrl": null },
                            { "name": "Grace Liu", "party": "Republican", "candidateUrl": null }
                        ]
                    }
                ]
            }
        ]
    })
}
