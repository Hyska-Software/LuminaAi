//! Retry policy shared by every provider request.
//!
//! The policy is **global** on purpose: the four wire protocols share the same
//! failure semantics, and the only provider-specific input is the server's own
//! `Retry-After` hint. Classification lives in [`ProviderError::retry_class`];
//! this module owns the decision (retry vs. surface), the exponential backoff
//! with full jitter and the read of the retry headers.
//!
//! It is deliberately I/O free: the harness owns sleeping, cancellation and the
//! `TurnEvent::Retrying` notification.

use std::time::Duration;

use reqwest::header::HeaderMap;

use super::ProviderError;
use crate::domain::Settings;

/// Retry category of one provider failure.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RetryClass {
    /// Safe to repeat the request when nothing was emitted for the UI.
    Transient,
    /// 401-class failure: refresh the OAuth bearer once and repeat.
    AuthRefresh,
    /// Never repeat; surface to the user.
    Permanent,
}

/// Why the harness is retrying (sent to the renderer).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RetryReason {
    Transient,
    AuthRefresh,
}

impl RetryReason {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Transient => "transient",
            Self::AuthRefresh => "auth_refresh",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RetryPolicy {
    /// Extra attempts after the first one (0 disables retries).
    pub max_retries: u32,
    pub base_delay_ms: u64,
    pub max_delay_ms: u64,
    /// Wall-clock budget for the retry sleeps of one step (0 = unlimited).
    pub max_elapsed_ms: u64,
    /// Longest server-requested wait accepted; above it the error is surfaced.
    pub retry_after_cap_ms: u64,
}

impl Default for RetryPolicy {
    fn default() -> Self {
        Self {
            max_retries: 3,
            base_delay_ms: 800,
            max_delay_ms: 20_000,
            max_elapsed_ms: 90_000,
            retry_after_cap_ms: 60_000,
        }
    }
}

impl RetryPolicy {
    pub fn from_settings(settings: &Settings) -> Self {
        Self {
            max_retries: settings.provider_max_retries,
            base_delay_ms: u64::from(settings.provider_retry_base_delay_ms),
            max_delay_ms: u64::from(settings.provider_retry_max_delay_ms),
            max_elapsed_ms: u64::from(settings.provider_retry_max_elapsed_ms),
            retry_after_cap_ms: u64::from(settings.provider_retry_after_cap_ms),
        }
    }

    /// Total requests a step may make, including the first one. A bearer
    /// credential gets one extra slot for the OAuth refresh retry.
    pub fn max_attempts(&self, bearer: bool) -> u32 {
        self.max_retries + 1 + u32::from(bearer)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RetryDecision {
    Retry { delay: Duration, reason: RetryReason },
    Stop { retry_after: Option<Duration> },
}

/// Exponential backoff with full jitter.
///
/// `sample` is the random `u64` used by the jitter (injected in tests, random
/// in production); the result is uniform in `0..=delay` and never above
/// `max_delay_ms`.
pub fn backoff_delay(policy: &RetryPolicy, failures: u32, sample: u64) -> Duration {
    if failures == 0 || policy.base_delay_ms == 0 {
        return Duration::ZERO;
    }
    let exponent = failures.saturating_sub(1).min(20);
    let grown = policy
        .base_delay_ms
        .saturating_mul(1u64.checked_shl(exponent).unwrap_or(u64::MAX));
    let ceiling = grown.min(policy.max_delay_ms).max(1);
    Duration::from_millis(sample % ceiling)
}

/// Decide whether one failed attempt should be repeated.
///
/// `failures` is the number of transient failures already observed for this
/// step (1 after the first failure); `elapsed` is the time slept in retries so
/// far. The caller must only call this when the attempt produced no UI output.
pub fn decide(
    policy: &RetryPolicy,
    error: &ProviderError,
    failures: u32,
    elapsed: Duration,
    sample: u64,
) -> RetryDecision {
    let retry_after = error.retry_after();
    if error.retry_class() != RetryClass::Transient {
        return RetryDecision::Stop { retry_after };
    }
    if failures == 0 || failures > policy.max_retries {
        return RetryDecision::Stop { retry_after };
    }
    if let Some(after) = retry_after {
        if duration_ms(after) > policy.retry_after_cap_ms {
            // Waiting this long would park the turn; surface the hint instead.
            return RetryDecision::Stop {
                retry_after: Some(after),
            };
        }
    }
    let delay = match retry_after {
        Some(after) => after,
        None => backoff_delay(policy, failures, sample),
    };
    if policy.max_elapsed_ms > 0
        && duration_ms(elapsed).saturating_add(duration_ms(delay)) > policy.max_elapsed_ms
    {
        return RetryDecision::Stop { retry_after };
    }
    RetryDecision::Retry {
        delay,
        reason: RetryReason::Transient,
    }
}

/// Random sample for [`backoff_delay`]. Falls back to half the ceiling when the
/// OS RNG is unavailable (never panics and never blocks a turn).
pub fn jitter_sample() -> u64 {
    let mut buffer = [0u8; 8];
    if getrandom::getrandom(&mut buffer).is_err() {
        return u64::MAX / 2;
    }
    u64::from_le_bytes(buffer)
}

/// Server-requested wait, from `retry-after-ms` (milliseconds), `retry-after`
/// (seconds or HTTP-date) or the OpenAI/OpenCode `x-ratelimit-reset-*` hints.
pub fn retry_after_from_headers(headers: &HeaderMap) -> Option<Duration> {
    if let Some(raw) = headers
        .get("retry-after-ms")
        .and_then(|value| value.to_str().ok())
    {
        if let Ok(milliseconds) = raw.trim().parse::<f64>() {
            if milliseconds.is_finite() && milliseconds >= 0.0 {
                return Some(Duration::from_millis(
                    milliseconds.min(86_400_000.0) as u64,
                ));
            }
        }
    }
    if let Some(value) = headers
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
    {
        if let Some(seconds) = parse_seconds(value) {
            return Some(seconds);
        }
        if let Ok(date) = chrono::DateTime::parse_from_rfc2822(value) {
            let target = date.with_timezone(&chrono::Utc);
            let now = chrono::Utc::now();
            if target > now {
                return Some(Duration::from_secs(
                    u64::try_from((target - now).num_seconds()).unwrap_or(0),
                ));
            }
            return Some(Duration::ZERO);
        }
    }
    // `x-ratelimit-reset-requests: 1s`, `6m0s`, `12ms` (OpenAI-compatible).
    for header in ["x-ratelimit-reset-requests", "x-ratelimit-reset-tokens"] {
        if let Some(duration) = headers
            .get(header)
            .and_then(|value| value.to_str().ok())
            .and_then(parse_go_duration)
        {
            return Some(duration);
        }
    }
    None
}

fn parse_seconds(raw: &str) -> Option<Duration> {
    let seconds: f64 = raw.trim().parse().ok()?;
    if !seconds.is_finite() || seconds < 0.0 {
        return None;
    }
    Some(Duration::from_secs_f64(seconds.min(86_400.0)))
}

/// Parse the compact duration syntax used by the `x-ratelimit-reset-*` headers
/// (`12ms`, `1.5s`, `6m0s`, `1h`). Unknown input yields `None`.
fn parse_go_duration(raw: &str) -> Option<Duration> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    let mut total = Duration::ZERO;
    let mut number = String::new();
    let mut chars = raw.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch.is_ascii_digit() || ch == '.' {
            number.push(ch);
            continue;
        }
        let value: f64 = number.parse().ok()?;
        number.clear();
        let unit = match ch {
            'n' if chars.peek() == Some(&'s') => {
                chars.next();
                Duration::from_nanos(1)
            }
            'u' if chars.peek() == Some(&'s') => {
                chars.next();
                Duration::from_micros(1)
            }
            'm' if chars.peek() == Some(&'s') => {
                chars.next();
                Duration::from_millis(1)
            }
            's' => Duration::from_secs(1),
            'm' => Duration::from_secs(60),
            'h' => Duration::from_secs(3_600),
            _ => return None,
        };
        total = total.checked_add(unit.mul_f64(value))?;
    }
    // Trailing digits without a unit mean the header is not a Go duration.
    if !number.is_empty() {
        return None;
    }
    Some(total).filter(|total| *total <= Duration::from_secs(86_400))
}

pub(crate) fn duration_ms(duration: Duration) -> u64 {
    u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::{ProviderError, TimeoutPhase};

    fn policy() -> RetryPolicy {
        RetryPolicy {
            max_retries: 3,
            base_delay_ms: 1_000,
            max_delay_ms: 10_000,
            max_elapsed_ms: 60_000,
            retry_after_cap_ms: 30_000,
        }
    }

    #[test]
    fn backoff_grows_and_is_capped() {
        let policy = policy();
        assert_eq!(backoff_delay(&policy, 1, 999), Duration::from_millis(999));
        assert!(backoff_delay(&policy, 2, 999) <= Duration::from_millis(999));
        assert!(backoff_delay(&policy, 5, 9_999) <= Duration::from_millis(9_999));
        // Full jitter: a zero sample always yields zero.
        assert_eq!(backoff_delay(&policy, 3, 0), Duration::ZERO);
        // The exponential ceiling itself is capped at `max_delay_ms`.
        assert!(backoff_delay(&policy, 10, u64::MAX) < Duration::from_millis(10_000));
    }

    #[test]
    fn permanent_errors_are_never_retried() {
        let decision = decide(
            &policy(),
            &ProviderError::BadRequest("nope".into()),
            1,
            Duration::ZERO,
            0,
        );
        assert!(matches!(decision, RetryDecision::Stop { .. }));
    }

    #[test]
    fn transient_errors_retry_up_to_the_budget() {
        let error = ProviderError::Transient {
            status: Some(503),
            code: None,
            message: "unavailable".into(),
            retry_after: None,
        };
        assert!(matches!(
            decide(&policy(), &error, 1, Duration::ZERO, 0),
            RetryDecision::Retry { .. }
        ));
        assert!(matches!(
            decide(&policy(), &error, 4, Duration::ZERO, 0),
            RetryDecision::Stop { .. }
        ));
    }

    #[test]
    fn retry_after_is_honored_and_capped() {
        let error = ProviderError::RateLimited {
            message: "slow down".into(),
            retry_after: Some(Duration::from_secs(7)),
        };
        assert_eq!(
            decide(&policy(), &error, 1, Duration::ZERO, 999),
            RetryDecision::Retry {
                delay: Duration::from_secs(7),
                reason: RetryReason::Transient,
            }
        );
        let too_long = ProviderError::RateLimited {
            message: "wait".into(),
            retry_after: Some(Duration::from_secs(600)),
        };
        assert_eq!(
            decide(&policy(), &too_long, 1, Duration::ZERO, 0),
            RetryDecision::Stop {
                retry_after: Some(Duration::from_secs(600))
            }
        );
    }

    #[test]
    fn elapsed_budget_stops_the_retry() {
        let error = ProviderError::Timeout {
            phase: TimeoutPhase::Headers,
            detail: "boom".into(),
        };
        assert!(matches!(
            decide(&policy(), &error, 1, Duration::from_millis(59_500), 999),
            RetryDecision::Stop { .. }
        ));
    }

    #[test]
    fn parses_retry_after_headers() {
        let mut headers = HeaderMap::new();
        headers.insert("retry-after-ms", "1500".parse().unwrap());
        assert_eq!(
            retry_after_from_headers(&headers),
            Some(Duration::from_millis(1_500))
        );

        let mut headers = HeaderMap::new();
        headers.insert(reqwest::header::RETRY_AFTER, "3".parse().unwrap());
        assert_eq!(
            retry_after_from_headers(&headers),
            Some(Duration::from_secs(3))
        );

        let mut headers = HeaderMap::new();
        headers.insert("x-ratelimit-reset-requests", "6m0s".parse().unwrap());
        assert_eq!(
            retry_after_from_headers(&headers),
            Some(Duration::from_secs(360))
        );

        let mut headers = HeaderMap::new();
        headers.insert(reqwest::header::RETRY_AFTER, "soon".parse().unwrap());
        assert_eq!(retry_after_from_headers(&headers), None);
    }

    #[test]
    fn max_attempts_includes_the_auth_slot() {
        assert_eq!(policy().max_attempts(false), 4);
        assert_eq!(policy().max_attempts(true), 5);
    }
}
