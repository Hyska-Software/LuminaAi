//! Minimal SSE line decoder shared by every protocol adapter.
//!
//! The gateway speaks plain `text/event-stream`: lines are separated by `\n`
//! (usually preceded by `\r`), events are terminated by an empty line, `event:`
//! supplies the event name and `data:` carries a (possibly multi-line) payload.
//! Comments start with `:` (used as keep-alives) and the OpenAI style
//! `data: [DONE]` sentinel ends the stream.
//!
//! `stream_sse` reads the response body incrementally, honours the turn's
//! [`CancellationToken`] between chunks and reports transport failures as
//! typed [`ProviderError`]s.
//!
//! It also owns the stream watchdog: the first model event must arrive within
//! `timeouts.first_event`, every subsequent gap without a data event is capped
//! by `timeouts.idle`, and an optional absolute `timeouts.total` caps the whole
//! stream. Keep-alive comments (`:`) and events without `data` do not reset the
//! deadline — a gateway that only pings must not keep a dead stream parked
//! indefinitely.

use std::time::Duration;

use anyhow::Context;
use futures_util::StreamExt;
use tokio::time::{timeout, Instant};
use tokio_util::sync::CancellationToken;

use super::{ProviderError, StreamTimeouts, TimeoutPhase};

/// Result of one completed SSE read.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SseOutcome {
    /// The OpenAI-style `data: [DONE]` sentinel was received.
    pub done_sentinel: bool,
}

fn stalled(phase: TimeoutPhase, limit: Duration) -> anyhow::Error {
    anyhow::Error::new(ProviderError::StreamStalled(format!(
        "no model event within {} s ({})",
        limit.as_secs(),
        phase.as_str()
    )))
}

fn total_expired(limit: Duration) -> anyhow::Error {
    anyhow::Error::new(ProviderError::Timeout {
        phase: TimeoutPhase::Total,
        detail: format!("stream exceeded the {} s total deadline", limit.as_secs()),
    })
}

/// Incremental SSE parser. Public within the crate so it can be unit tested by
/// feeding arbitrary byte chunks (chunks may split UTF-8 sequences or lines).
pub struct SseDecoder {
    buffer: Vec<u8>,
    event: Option<String>,
    data: String,
    has_data: bool,
    finished: bool,
}

impl Default for SseDecoder {
    fn default() -> Self {
        Self::new()
    }
}

impl SseDecoder {
    pub fn new() -> Self {
        Self {
            buffer: Vec::new(),
            event: None,
            data: String::new(),
            has_data: false,
            finished: false,
        }
    }

    /// Feed a chunk of bytes. Returns `true` when the `[DONE]` sentinel was seen
    /// (the caller should stop reading the body).
    pub fn push<F>(&mut self, chunk: &[u8], on_event: &mut F) -> anyhow::Result<bool>
    where
        F: FnMut(Option<&str>, &str) -> anyhow::Result<()>,
    {
        if self.finished {
            return Ok(true);
        }
        self.buffer.extend_from_slice(chunk);
        loop {
            let Some(newline) = self.buffer.iter().position(|byte| *byte == b'\n') else {
                break;
            };
            let mut line = self.buffer[..newline].to_vec();
            self.buffer.drain(..=newline);
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            if self.process_line(&line, on_event)? {
                self.finished = true;
                return Ok(true);
            }
        }
        Ok(false)
    }

    /// Flush a trailing event that was not followed by a final newline.
    pub fn finish<F>(&mut self, on_event: &mut F) -> anyhow::Result<()>
    where
        F: FnMut(Option<&str>, &str) -> anyhow::Result<()>,
    {
        if self.finished {
            return Ok(());
        }
        if !self.buffer.is_empty() {
            let mut line = std::mem::take(&mut self.buffer);
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            if self.process_line(&line, on_event)? {
                self.finished = true;
                return Ok(());
            }
        }
        self.dispatch(on_event)?;
        self.finished = true;
        Ok(())
    }

    fn process_line<F>(&mut self, line: &[u8], on_event: &mut F) -> anyhow::Result<bool>
    where
        F: FnMut(Option<&str>, &str) -> anyhow::Result<()>,
    {
        if line.is_empty() {
            self.dispatch(on_event)?;
            return Ok(self.finished);
        }
        if line[0] == b':' {
            // Comment / keep-alive.
            return Ok(false);
        }
        let text = std::str::from_utf8(line).context("SSE: linha com UTF-8 inválido")?;
        let (field, value) = match text.split_once(':') {
            Some((field, value)) => {
                let value = value.strip_prefix(' ').unwrap_or(value);
                (field, value)
            }
            None => (text, ""),
        };
        match field {
            "event" => self.event = Some(value.to_string()),
            "data" => {
                if self.has_data {
                    self.data.push('\n');
                }
                self.data.push_str(value);
                self.has_data = true;
            }
            // `id`, `retry` and unknown fields are irrelevant here.
            _ => {}
        }
        Ok(false)
    }

    fn dispatch<F>(&mut self, on_event: &mut F) -> anyhow::Result<()>
    where
        F: FnMut(Option<&str>, &str) -> anyhow::Result<()>,
    {
        let event = self.event.take();
        if !self.has_data {
            return Ok(());
        }
        self.has_data = false;
        let data = std::mem::take(&mut self.data);
        if data.trim() == "[DONE]" {
            // Sentinel: mark the stream as finished; the caller stops reading.
            self.finished = true;
            return Ok(());
        }
        on_event(event.as_deref(), data.as_str())
    }
}

/// Read an HTTP response body as an SSE stream, invoking `on_event` for every
/// complete event.
///
/// Returns `Ok(())` when the stream ends naturally, when the `[DONE]` sentinel
/// is received or when the turn is cancelled (the adapters check
/// `cancel.is_cancelled()` afterwards to decide whether to emit `Done`).
pub async fn stream_sse<F>(
    response: reqwest::Response,
    cancel: &CancellationToken,
    timeouts: &StreamTimeouts,
    mut on_event: F,
) -> anyhow::Result<SseOutcome>
where
    F: FnMut(Option<&str>, &str) -> anyhow::Result<()>,
{
    let mut decoder = SseDecoder::new();
    let mut stream = response.bytes_stream();
    let mut first_event = true;
    let mut last_progress = Instant::now();
    let started = Instant::now();
    loop {
        let phase = if first_event {
            TimeoutPhase::FirstEvent
        } else {
            TimeoutPhase::Idle
        };
        let phase_limit = if first_event {
            timeouts.first_event
        } else {
            timeouts.idle
        };
        let mut remaining = phase_limit.saturating_sub(last_progress.elapsed());
        let mut exhausted_total = None;
        if let Some(total) = timeouts.total {
            let total_remaining = total.saturating_sub(started.elapsed());
            if total_remaining <= remaining {
                remaining = total_remaining;
                exhausted_total = Some(total);
            }
        }
        if remaining.is_zero() {
            return Err(match exhausted_total {
                Some(total) => total_expired(total),
                None => stalled(phase, phase_limit),
            });
        }
        let next = tokio::select! {
            _ = cancel.cancelled() => return Ok(SseOutcome { done_sentinel: false }),
            next = timeout(remaining, stream.next()) => match next {
                Ok(next) => next,
                Err(_) => {
                    return Err(match exhausted_total {
                        Some(total) => total_expired(total),
                        None => stalled(phase, phase_limit),
                    });
                }
            },
        };
        match next {
            None => break,
            Some(Err(error)) => {
                return Err(anyhow::Error::new(ProviderError::StreamInterrupted(
                    format!("erro de rede ao ler o stream SSE: {error}"),
                )));
            }
            Some(Ok(chunk)) => {
                // Only a dispatched event with data counts as progress; keep-alives
                // and partial lines must not extend the watchdog.
                let mut on_data = |event: Option<&str>, data: &str| {
                    if !data.trim().is_empty() {
                        first_event = false;
                        last_progress = Instant::now();
                    }
                    on_event(event, data)
                };
                if decoder.push(&chunk, &mut on_data)? {
                    return Ok(SseOutcome { done_sentinel: true });
                }
            }
        }
    }
    let mut on_data = |event: Option<&str>, data: &str| {
        if !data.trim().is_empty() {
            first_event = false;
            last_progress = Instant::now();
        }
        on_event(event, data)
    };
    decoder.finish(&mut on_data)?;
    Ok(SseOutcome {
        done_sentinel: false,
    })
}

#[cfg(test)]
mod tests {
    use super::{stalled, ProviderError, SseDecoder, TimeoutPhase};

    #[test]
    fn stall_error_is_typed_and_phase_labeled() {
        for (phase, label) in [
            (TimeoutPhase::FirstEvent, "first event"),
            (TimeoutPhase::Idle, "idle"),
        ] {
            let error = stalled(phase, std::time::Duration::from_secs(42));
            let provider = error
                .downcast_ref::<ProviderError>()
                .expect("stall must stay a typed ProviderError");
            assert!(provider.is_stream_stall());
            let message = provider.to_string();
            assert!(message.contains(label), "{message}");
            assert!(message.contains("42"), "{message}");
        }
    }

    fn collect(chunks: &[&[u8]]) -> (Vec<(Option<String>, String)>, bool) {
        let mut decoder = SseDecoder::new();
        let mut events: Vec<(Option<String>, String)> = Vec::new();
        let mut stopped = false;
        for chunk in chunks {
            let mut callback = |event: Option<&str>, data: &str| -> anyhow::Result<()> {
                events.push((event.map(str::to_string), data.to_string()));
                Ok(())
            };
            if decoder.push(chunk, &mut callback).expect("decoder failed") {
                stopped = true;
                break;
            }
        }
        if !stopped {
            let mut callback = |event: Option<&str>, data: &str| -> anyhow::Result<()> {
                events.push((event.map(str::to_string), data.to_string()));
                Ok(())
            };
            decoder.finish(&mut callback).expect("flush failed");
        }
        (events, stopped)
    }

    #[test]
    fn parses_named_events() {
        let (events, stopped) = collect(&[b"event: message_start\ndata: {\"a\":1}\n\n"]);
        assert!(!stopped);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].0.as_deref(), Some("message_start"));
        assert_eq!(events[0].1, "{\"a\":1}");
    }

    #[test]
    fn supports_crlf_and_keeps_multiline_data() {
        let (events, _) = collect(&[b"data: line1\r\ndata: line2\r\n\r\n: keep-alive\r\n\r\n"]);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].0, None);
        assert_eq!(events[0].1, "line1\nline2");
    }

    #[test]
    fn stops_on_done_sentinel() {
        let (events, stopped) =
            collect(&[b"data: {\"x\":1}\n\ndata: [DONE]\n\ndata: {\"y\":2}\n\n"]);
        assert!(stopped);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].1, "{\"x\":1}");
    }

    #[test]
    fn handles_chunks_splitting_utf8_and_lines() {
        let payload = "data: {\"text\":\"olá 🚀\"}\n\n";
        let bytes = payload.as_bytes();
        // Split in the middle of the two-byte `á` sequence and the four-byte emoji.
        let mid_1 = payload.find('á').expect("á present") + 1;
        let mid_2 = payload.find('🚀').expect("emoji present") + 2;
        let (events, _) = collect(&[&bytes[..mid_1], &bytes[mid_1..mid_2], &bytes[mid_2..]]);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].1, "{\"text\":\"olá 🚀\"}");
    }

    #[test]
    fn flushes_trailing_event_without_final_blank_line() {
        let (events, _) = collect(&[b"data: tail"]);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].1, "tail");
    }

    #[test]
    fn ignores_event_without_data() {
        let (events, _) = collect(&[b"event: ping\n\n"]);
        assert!(events.is_empty());
    }
}
