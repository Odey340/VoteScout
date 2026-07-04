/// Supported generation languages. Anything unrecognized falls back to English.
pub fn normalize(code: Option<&str>) -> &'static str {
    match code.map(|c| c.trim().to_lowercase()) {
        Some(c) if c.starts_with("es") => "es",
        Some(c) if c.starts_with("vi") => "vi",
        Some(c) if c.starts_with("zh") => "zh",
        _ => "en",
    }
}

/// Instruction block appended to every generation prompt. The neutrality and
/// uncertainty rules live in each prompt and apply identically — this only
/// governs the output language and what stays untranslated.
pub fn instruction(lang: &str) -> String {
    let language_name = match lang {
        "es" => "Spanish (formal register, as used in official U.S. election materials)",
        "vi" => "Vietnamese (formal register, as used in official U.S. election materials)",
        "zh" => "Simplified Chinese (formal register, as used in official U.S. election materials)",
        _ => return String::new(),
    };
    format!(
        "\n\nLANGUAGE: Write your entire response in {language_name}. Do not translate proper \
         nouns: candidate names, the official office/race name as it appears on the ballot, \
         place names, and street addresses stay in their official (English) form. Every rule \
         above — neutrality, evenhandedness, and stating uncertainty plainly instead of \
         guessing — applies exactly the same in this language."
    )
}
