//! Tabular sources for the importer. Excel workbooks are read with calamine;
//! CSV/TSV and JSON files are parsed into the same `Range<Data>` so preview,
//! column mapping, validation and the import modes work unchanged.

use calamine::{open_workbook_auto, Data, Range, Reader};

pub struct LoadedSheet {
    /// Sheets of a workbook; a single descriptive entry for text files.
    pub sheets: Vec<String>,
    pub sheet: String,
    /// First row holds the headers.
    pub range: Range<Data>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SourceKind {
    Workbook,
    Delimited,
    Json,
}

fn kind_of(path: &str) -> SourceKind {
    let ext = std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    match ext.as_str() {
        "csv" | "tsv" | "txt" => SourceKind::Delimited,
        "json" | "jsonl" | "ndjson" => SourceKind::Json,
        _ => SourceKind::Workbook,
    }
}

pub fn load_sheet(path: &str, sheet: Option<&str>) -> Result<LoadedSheet, String> {
    match kind_of(path) {
        SourceKind::Workbook => {
            let mut workbook = open_workbook_auto(path)
                .map_err(|error| format!("Error abriendo libro Excel: {error}"))?;
            let sheets = workbook.sheet_names().to_vec();
            let sheet = sheet
                .map(str::to_string)
                .or_else(|| sheets.first().cloned())
                .ok_or_else(|| "El archivo Excel no contiene hojas.".to_string())?;
            let range = workbook
                .worksheet_range(&sheet)
                .map_err(|error| format!("Error leyendo hoja '{sheet}': {error}"))?;
            Ok(LoadedSheet {
                sheets,
                sheet,
                range,
            })
        }
        SourceKind::Delimited => {
            let bytes = std::fs::read(path)
                .map_err(|error| format!("Error leyendo el archivo: {error}"))?;
            let (text, encoding) = decode_text(&bytes);
            let delimiter = detect_delimiter(&text);
            let rows = parse_delimited(&text, delimiter);
            let label = format!(
                "Separador {} · {encoding}",
                match delimiter {
                    '\t' => "tabulador".to_string(),
                    other => format!("«{other}»"),
                }
            );
            Ok(LoadedSheet {
                sheets: vec![label.clone()],
                sheet: label,
                range: rows_to_range(
                    rows.into_iter()
                        .map(|r| r.into_iter().map(|cell| infer_text_cell(&cell)).collect()),
                ),
            })
        }
        SourceKind::Json => {
            let bytes = std::fs::read(path)
                .map_err(|error| format!("Error leyendo el archivo: {error}"))?;
            let (text, _) = decode_text(&bytes);
            let records = parse_json_records(&text)?;
            let label = format!("JSON · {} registros", records.len());
            Ok(LoadedSheet {
                sheets: vec![label.clone()],
                sheet: label,
                range: json_records_to_range(&records),
            })
        }
    }
}

/// UTF-8 (with or without BOM); anything else is read as Windows-1252, the
/// usual encoding of CSV files saved by Excel on Windows.
fn decode_text(bytes: &[u8]) -> (String, &'static str) {
    let bytes = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes);
    match std::str::from_utf8(bytes) {
        Ok(text) => (text.to_string(), "UTF-8"),
        Err(_) => (
            bytes.iter().map(|&b| cp1252_char(b)).collect(),
            "Windows-1252",
        ),
    }
}

fn cp1252_char(byte: u8) -> char {
    const HIGH: [char; 32] = [
        '€', '\u{81}', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ', '‰', 'Š', '‹', 'Œ', '\u{8D}', 'Ž',
        '\u{8F}', '\u{90}', '‘', '’', '“', '”', '•', '–', '—', '˜', '™', 'š', '›', 'œ', '\u{9D}',
        'ž', 'Ÿ',
    ];
    match byte {
        0x80..=0x9F => HIGH[(byte - 0x80) as usize],
        other => other as char,
    }
}

/// The candidate that splits the first lines most consistently.
fn detect_delimiter(text: &str) -> char {
    let lines: Vec<&str> = text
        .lines()
        .filter(|l| !l.trim().is_empty())
        .take(20)
        .collect();
    let mut best = (',', 0usize);
    for candidate in [',', ';', '\t', '|'] {
        let counts: Vec<usize> = lines
            .iter()
            .map(|line| count_outside_quotes(line, candidate))
            .collect();
        let Some(&first) = counts.first() else {
            continue;
        };
        // Lines that agree with the header count; a quoted multi-line value may break one.
        let agreeing = counts.iter().filter(|&&c| c == first).count();
        let score = if first == 0 { 0 } else { first * agreeing };
        if score > best.1 {
            best = (candidate, score);
        }
    }
    best.0
}

fn count_outside_quotes(line: &str, delimiter: char) -> usize {
    let mut in_quotes = false;
    let mut count = 0;
    for c in line.chars() {
        if c == '"' {
            in_quotes = !in_quotes;
        } else if c == delimiter && !in_quotes {
            count += 1;
        }
    }
    count
}

/// RFC 4180: quoted fields may hold delimiters, line breaks and doubled quotes.
fn parse_delimited(text: &str, delimiter: char) -> Vec<Vec<String>> {
    let mut rows = Vec::new();
    let mut row = Vec::new();
    let mut field = String::new();
    let mut in_quotes = false;
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if in_quotes {
            match c {
                '"' if chars.peek() == Some(&'"') => {
                    field.push('"');
                    chars.next();
                }
                '"' => in_quotes = false,
                _ => field.push(c),
            }
            continue;
        }
        match c {
            '"' if field.is_empty() => in_quotes = true,
            c if c == delimiter => row.push(std::mem::take(&mut field)),
            '\r' => {}
            '\n' => {
                row.push(std::mem::take(&mut field));
                rows.push(std::mem::take(&mut row));
            }
            _ => field.push(c),
        }
    }
    if !field.is_empty() || !row.is_empty() {
        row.push(field);
        rows.push(row);
    }
    rows.retain(|r| !(r.len() == 1 && r[0].trim().is_empty()));
    rows
}

/// Numbers become numeric cells (as in a workbook); everything else stays text.
fn infer_text_cell(text: &str) -> Data {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Data::Empty;
    }
    // Keep leading zeros ("007", zip codes) and long digit strings as text.
    let leading_zero = trimmed.len() > 1 && trimmed.starts_with('0') && !trimmed.starts_with("0.");
    if !leading_zero && trimmed.len() <= 15 {
        if let Ok(int) = trimmed.parse::<i64>() {
            return Data::Int(int);
        }
        if trimmed.contains('.') {
            if let Ok(float) = trimmed.parse::<f64>() {
                if float.is_finite() {
                    return Data::Float(float);
                }
            }
        }
    }
    Data::String(text.to_string())
}

/// JSON value whose objects keep the key order of the file (serde_json's map
/// sorts keys), so imported columns appear as written.
#[derive(Debug, Clone)]
enum Json {
    Scalar(serde_json::Value),
    Array(Vec<Json>),
    Object(Vec<(String, Json)>),
}

impl<'de> serde::Deserialize<'de> for Json {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct JsonVisitor;
        impl<'de> serde::de::Visitor<'de> for JsonVisitor {
            type Value = Json;
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("un valor JSON")
            }
            fn visit_bool<E>(self, v: bool) -> Result<Json, E> {
                Ok(Json::Scalar(v.into()))
            }
            fn visit_i64<E>(self, v: i64) -> Result<Json, E> {
                Ok(Json::Scalar(v.into()))
            }
            fn visit_u64<E>(self, v: u64) -> Result<Json, E> {
                Ok(Json::Scalar(v.into()))
            }
            fn visit_f64<E>(self, v: f64) -> Result<Json, E> {
                Ok(Json::Scalar(v.into()))
            }
            fn visit_str<E>(self, v: &str) -> Result<Json, E> {
                Ok(Json::Scalar(v.into()))
            }
            fn visit_string<E>(self, v: String) -> Result<Json, E> {
                Ok(Json::Scalar(v.into()))
            }
            fn visit_unit<E>(self) -> Result<Json, E> {
                Ok(Json::Scalar(serde_json::Value::Null))
            }
            fn visit_none<E>(self) -> Result<Json, E> {
                Ok(Json::Scalar(serde_json::Value::Null))
            }
            fn visit_seq<A: serde::de::SeqAccess<'de>>(self, mut seq: A) -> Result<Json, A::Error> {
                let mut items = Vec::new();
                while let Some(item) = seq.next_element()? {
                    items.push(item);
                }
                Ok(Json::Array(items))
            }
            fn visit_map<A: serde::de::MapAccess<'de>>(self, mut map: A) -> Result<Json, A::Error> {
                let mut entries = Vec::new();
                while let Some(entry) = map.next_entry()? {
                    entries.push(entry);
                }
                Ok(Json::Object(entries))
            }
        }
        deserializer.deserialize_any(JsonVisitor)
    }
}

impl Json {
    fn into_value(self) -> serde_json::Value {
        match self {
            Json::Scalar(v) => v,
            Json::Array(items) => items.into_iter().map(Json::into_value).collect(),
            Json::Object(entries) => serde_json::Value::Object(
                entries
                    .into_iter()
                    .map(|(k, v)| (k, v.into_value()))
                    .collect(),
            ),
        }
    }
}

type Record = Vec<(String, Json)>;

/// A JSON array of objects (optionally under a single top-level key) or JSON Lines.
fn parse_json_records(text: &str) -> Result<Vec<Record>, String> {
    let into_records = |items: Vec<Json>| -> Result<Vec<Record>, String> {
        items
            .into_iter()
            .enumerate()
            .map(|(i, item)| match item {
                Json::Object(entries) => Ok(entries),
                _ => Err(format!("El elemento {} no es un objeto JSON.", i + 1)),
            })
            .collect()
    };
    match serde_json::from_str::<Json>(text) {
        Ok(Json::Array(items)) => into_records(items),
        Ok(Json::Object(entries)) => {
            let arrays: Vec<&Json> = entries
                .iter()
                .map(|(_, v)| v)
                .filter(|v| matches!(v, Json::Array(_)))
                .collect();
            match arrays.as_slice() {
                [Json::Array(items)] => into_records(items.clone()),
                _ => into_records(vec![Json::Object(entries)]),
            }
        }
        Ok(_) => Err("El JSON debe ser una lista de objetos.".into()),
        // Not a single document: try JSON Lines.
        Err(whole_error) => {
            let mut items = Vec::new();
            for (i, line) in text
                .lines()
                .enumerate()
                .filter(|(_, l)| !l.trim().is_empty())
            {
                let value = serde_json::from_str::<Json>(line).map_err(|_| {
                    format!(
                        "JSON no válido: {whole_error} (tampoco es JSON Lines: línea {})",
                        i + 1
                    )
                })?;
                items.push(value);
            }
            into_records(items)
        }
    }
}

fn json_records_to_range(records: &[Record]) -> Range<Data> {
    use serde_json::Value;
    // Columns in first-seen order across all records.
    let mut headers: Vec<String> = Vec::new();
    for record in records {
        for (key, _) in record {
            if !headers.contains(key) {
                headers.push(key.clone());
            }
        }
    }
    let header_row = headers.iter().map(|h| Data::String(h.clone())).collect();
    let data_rows = records.iter().map(|record| {
        headers
            .iter()
            .map(|h| {
                let value = record
                    .iter()
                    .find(|(k, _)| k == h)
                    .map(|(_, v)| v.clone().into_value());
                match value {
                    None | Some(Value::Null) => Data::Empty,
                    Some(Value::Bool(b)) => Data::Bool(b),
                    Some(Value::Number(n)) => n
                        .as_i64()
                        .map(Data::Int)
                        .unwrap_or_else(|| Data::Float(n.as_f64().unwrap_or_default())),
                    Some(Value::String(s)) => Data::String(s),
                    Some(other) => Data::String(other.to_string()),
                }
            })
            .collect::<Vec<_>>()
    });
    rows_to_range(std::iter::once(header_row).chain(data_rows))
}

fn rows_to_range(rows: impl IntoIterator<Item = Vec<Data>>) -> Range<Data> {
    let rows: Vec<Vec<Data>> = rows.into_iter().collect();
    let width = rows.iter().map(Vec::len).max().unwrap_or(0);
    if rows.is_empty() || width == 0 {
        return Range::empty();
    }
    let mut range = Range::new((0, 0), (rows.len() as u32 - 1, width as u32 - 1));
    for (r, row) in rows.into_iter().enumerate() {
        for (c, cell) in row.into_iter().enumerate() {
            range.set_value((r as u32, c as u32), cell);
        }
    }
    range
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cells(range: &Range<Data>) -> Vec<Vec<Data>> {
        range.rows().map(|r| r.to_vec()).collect()
    }

    #[test]
    fn parses_quoted_csv_with_detected_semicolon() {
        let text = "id;name;note\n1;\"Pérez; Ana\";\"dice \"\"hola\"\"\nen dos líneas\"\n2;Luis;\n";
        assert_eq!(detect_delimiter(text), ';');
        let rows = parse_delimited(text, ';');
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[1], ["1", "Pérez; Ana", "dice \"hola\"\nen dos líneas"]);
        assert_eq!(rows[2], ["2", "Luis", ""]);
    }

    #[test]
    fn detects_tabs_and_decodes_windows_1252() {
        let bytes = b"a\tb\n1\tCaf\xe9 \x80\n";
        let (text, encoding) = decode_text(bytes);
        assert_eq!(encoding, "Windows-1252");
        assert_eq!(detect_delimiter(&text), '\t');
        assert_eq!(parse_delimited(&text, '\t')[1], ["1", "Café €"]);
    }

    #[test]
    fn infers_numbers_but_keeps_codes_as_text() {
        assert_eq!(infer_text_cell("42"), Data::Int(42));
        assert_eq!(infer_text_cell("3.5"), Data::Float(3.5));
        assert_eq!(infer_text_cell("007"), Data::String("007".into()));
        assert_eq!(
            infer_text_cell("1234567890123456789"),
            Data::String("1234567890123456789".into())
        );
        assert_eq!(infer_text_cell(" "), Data::Empty);
    }

    #[test]
    fn reads_json_arrays_wrapped_arrays_and_json_lines() {
        let array = parse_json_records(r#"[{"id":1,"a":"x"},{"id":2,"b":true}]"#).unwrap();
        let range = json_records_to_range(&array);
        assert_eq!(
            cells(&range),
            [
                vec![
                    Data::String("id".into()),
                    Data::String("a".into()),
                    Data::String("b".into())
                ],
                vec![Data::Int(1), Data::String("x".into()), Data::Empty],
                vec![Data::Int(2), Data::Empty, Data::Bool(true)],
            ]
        );
        assert_eq!(
            parse_json_records(r#"{"data":[{"id":1}]}"#).unwrap().len(),
            1
        );
        assert_eq!(
            parse_json_records("{\"id\":1}\n{\"id\":2}\n")
                .unwrap()
                .len(),
            2
        );
        assert!(parse_json_records("[1, 2]").is_err());
    }
}
