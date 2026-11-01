//! Semantic version comparison for the in-app updater.
//!
//! GitHub releases use plain SemVer tags (`v0.2.0`, `v0.2.0-rc.1`). The
//! installer has a numeric-only comparator for Windows registry versions; the
//! updater needs the full SemVer ordering (a stable release is newer than its
//! prerelease) and a tolerant fallback for legacy/invalid values.

use std::cmp::Ordering;

#[derive(Debug, PartialEq, Eq)]
enum Identifier {
    Numeric(u64),
    Alpha(String),
}

#[derive(Debug, PartialEq, Eq)]
struct ParsedVersion {
    core: [u64; 3],
    prerelease: Vec<Identifier>,
}

/// Returns whether `candidate` is strictly newer than `current`.
pub fn is_newer(candidate: &str, current: &str) -> bool {
    match (parse(candidate), parse(current)) {
        (Some(candidate), Some(current)) => compare(&candidate, &current) == Ordering::Greater,
        _ => numeric_fallback(candidate, current) > 0,
    }
}

fn parse(value: &str) -> Option<ParsedVersion> {
    let trimmed = value.trim().trim_start_matches(['v', 'V']);
    if trimmed.is_empty() {
        return None;
    }
    // Build metadata does not participate in ordering.
    let without_build = trimmed.split('+').next().unwrap_or_default();
    let (core, prerelease) = match without_build.split_once('-') {
        Some((core, prerelease)) => (core, Some(prerelease)),
        None => (without_build, None),
    };

    let mut numbers = [0u64; 3];
    let mut count = 0usize;
    for part in core.split('.') {
        if count == 3
            || part.is_empty()
            || !part.chars().all(|character| character.is_ascii_digit())
        {
            return None;
        }
        numbers[count] = part.parse().ok()?;
        count += 1;
    }
    if count == 0 {
        return None;
    }

    let mut identifiers = Vec::new();
    if let Some(prerelease) = prerelease {
        if prerelease.is_empty() {
            return None;
        }
        for part in prerelease.split('.') {
            if part.is_empty() {
                return None;
            }
            if part.chars().all(|character| character.is_ascii_digit()) {
                identifiers.push(Identifier::Numeric(part.parse().ok()?));
            } else if part
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || character == '-')
            {
                identifiers.push(Identifier::Alpha(part.to_string()));
            } else {
                return None;
            }
        }
    }

    Some(ParsedVersion {
        core: numbers,
        prerelease: identifiers,
    })
}

fn compare(left: &ParsedVersion, right: &ParsedVersion) -> Ordering {
    for (a, b) in left.core.iter().zip(right.core.iter()) {
        match a.cmp(b) {
            Ordering::Equal => {}
            other => return other,
        }
    }
    compare_prerelease(&left.prerelease, &right.prerelease)
}

fn compare_prerelease(left: &[Identifier], right: &[Identifier]) -> Ordering {
    match (left.is_empty(), right.is_empty()) {
        // A release is newer than any of its prereleases.
        (true, true) => return Ordering::Equal,
        (true, false) => return Ordering::Greater,
        (false, true) => return Ordering::Less,
        (false, false) => {}
    }

    for (a, b) in left.iter().zip(right.iter()) {
        let ordering = match (a, b) {
            (Identifier::Numeric(a), Identifier::Numeric(b)) => a.cmp(b),
            (Identifier::Alpha(a), Identifier::Alpha(b)) => a.cmp(b),
            // Numeric identifiers always have lower precedence than alphanumeric.
            (Identifier::Numeric(_), Identifier::Alpha(_)) => Ordering::Less,
            (Identifier::Alpha(_), Identifier::Numeric(_)) => Ordering::Greater,
        };
        if ordering != Ordering::Equal {
            return ordering;
        }
    }
    left.len().cmp(&right.len())
}

/// Best-effort ordering for values that are not valid SemVer (e.g. a Windows
/// registry version or a hand-edited manifest). Mirrors the installer helper.
fn numeric_fallback(left: &str, right: &str) -> i32 {
    let parts = |value: &str| -> Vec<u64> {
        value
            .split(|character: char| !character.is_ascii_digit())
            .filter(|part| !part.is_empty())
            .filter_map(|part| part.parse::<u64>().ok())
            .collect()
    };
    let left = parts(left);
    let right = parts(right);
    for index in 0..left.len().max(right.len()) {
        let a = left.get(index).copied().unwrap_or(0);
        let b = right.get(index).copied().unwrap_or(0);
        if a != b {
            return if a > b { 1 } else { -1 };
        }
    }
    0
}

#[cfg(test)]
mod tests {
    use super::is_newer;

    #[test]
    fn compares_numeric_versions() {
        assert!(is_newer("0.2.0", "0.1.9"));
        assert!(is_newer("0.1.10", "0.1.9"));
        assert!(is_newer("v0.2.0", "0.1.0"));
        assert!(!is_newer("0.1.0", "0.1.0"));
        assert!(!is_newer("0.1.0", "0.2.0"));
        assert!(!is_newer("0.2.0", "v0.2.0"));
    }

    #[test]
    fn a_stable_release_is_newer_than_its_prerelease() {
        assert!(is_newer("0.2.0", "0.2.0-rc.1"));
        assert!(is_newer("0.2.0-rc.2", "0.2.0-rc.1"));
        assert!(is_newer("0.2.0-rc.10", "0.2.0-rc.9"));
        assert!(!is_newer("0.2.0-rc.1", "0.2.0"));
        assert!(is_newer("0.2.0-beta", "0.2.0-alpha"));
    }

    #[test]
    fn ignores_build_metadata_and_accepts_short_versions() {
        assert!(!is_newer("0.2.0+build.7", "0.2.0"));
        assert!(!is_newer("1.0", "1.0.0"));
        assert!(is_newer("1.1", "1.0.9"));
    }

    #[test]
    fn falls_back_to_numeric_parts_for_invalid_versions() {
        assert!(is_newer("2026.11.1", "2026.10.9"));
        assert!(!is_newer("build-7", "build-7"));
        assert!(is_newer("0.2.0", "not-a-version"));
        assert!(!is_newer("", ""));
    }
}
