// ── Paw Engine: HTTP Retry & Circuit-Breaker ───────────────────────────────
//
// Shared retry utilities used by AI providers, channel bridges, and tools.
//
// Features:
//   • Exponential backoff with ±25% jitter (base 1s, max 30s, 3 retries)
//   • Retry on 429 (rate limit), 500, 502, 503, 504, 529
//   • Respects `Retry-After` header
//   • Circuit breaker: 5 consecutive failures → fail fast for 60s
//   • Bridge reconnect helper with escalating backoff + cap

use log::warn;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::time::{Duration, SystemTime};

// ── Constants ──────────────────────────────────────────────────────────────

/// Default maximum number of retry attempts per request.
pub const MAX_RETRIES: u32 = 3;

/// Initial retry delay in milliseconds (doubles each attempt).
const INITIAL_RETRY_DELAY_MS: u64 = 1_000;

/// Maximum retry delay cap in milliseconds (30 seconds).
const MAX_RETRY_DELAY_MS: u64 = 30_000;

/// Maximum bridge reconnect delay cap in milliseconds (5 minutes).
const MAX_RECONNECT_DELAY_MS: u64 = 300_000;

// ── Retryable status detection ─────────────────────────────────────────────

/// Check if an HTTP status code represents a transient/retryable error.
pub fn is_retryable_status(status: u16) -> bool {
    matches!(status, 429 | 500 | 502 | 503 | 504 | 529)
}

// ── Backoff delay ──────────────────────────────────────────────────────────

/// Sleep with exponential backoff + ±25% jitter.
/// Respects Retry-After header if the server sent one.
/// Returns the actual delay duration for logging.
pub async fn retry_delay(attempt: u32, retry_after_secs: Option<u64>) -> Duration {
    let base_ms = INITIAL_RETRY_DELAY_MS * 2u64.pow(attempt);
    let capped_ms = base_ms.min(MAX_RETRY_DELAY_MS);
    let delay_ms = if let Some(secs) = retry_after_secs {
        // Use server-specified delay, but cap at 60s and floor at our computed backoff
        (secs.min(60) * 1000).max(capped_ms)
    } else {
        capped_ms
    };
    let jittered = apply_jitter(delay_ms);
    let delay = Duration::from_millis(jittered);
    tokio::time::sleep(delay).await;
    delay
}

/// Compute exponential backoff delay for bridge reconnection.
/// Uses a longer cap (5 minutes) than request retries.
/// `attempt` is 0-based.
pub async fn reconnect_delay(attempt: u32) -> Duration {
    let base_ms = INITIAL_RETRY_DELAY_MS * 2u64.pow(attempt.min(12));
    let capped_ms = base_ms.min(MAX_RECONNECT_DELAY_MS);
    let jittered = apply_jitter(capped_ms);
    let delay = Duration::from_millis(jittered);
    tokio::time::sleep(delay).await;
    delay
}

/// Apply ±25% jitter to prevent thundering-herd effects.
fn apply_jitter(base_ms: u64) -> u64 {
    let jitter_range = (base_ms / 4) as i64;
    if jitter_range == 0 {
        return base_ms.max(100);
    }
    let offset = (rand_jitter() % (2 * jitter_range + 1)) - jitter_range;
    let result = base_ms as i64 + offset;
    result.max(100) as u64
}

/// Simple jitter source using system clock nanos (no extra crate needed).
fn rand_jitter() -> i64 {
    let nanos = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_nanos();
    (nanos % 1000) as i64
}

// ── Retry-After header parsing ─────────────────────────────────────────────

/// Parse Retry-After header value (integer seconds only).
/// HTTP-date format is not implemented — falls back to computed backoff.
pub fn parse_retry_after(header_value: &str) -> Option<u64> {
    header_value.trim().parse::<u64>().ok()
}

// ── Circuit Breaker ────────────────────────────────────────────────────────

/// A simple circuit breaker that trips after N consecutive failures,
/// then rejects requests for a cooldown period before allowing retries.
///
/// States:
///   Closed   — normal operation, requests pass through
///   Open     — rejecting requests (cooldown active)
///   HalfOpen — cooldown expired, one probe request allowed
pub struct CircuitBreaker {
    /// Number of consecutive failures.
    consecutive_failures: AtomicU32,
    /// Timestamp (epoch secs) when the circuit was tripped open.
    tripped_at: AtomicU64,
    /// Number of consecutive failures before tripping.
    threshold: u32,
    /// Cooldown period in seconds while circuit is open.
    cooldown_secs: u64,
}

impl CircuitBreaker {
    /// Create a new circuit breaker.
    /// - `threshold`: number of consecutive failures before tripping (default: 5)
    /// - `cooldown_secs`: seconds to wait before allowing probe requests (default: 60)
    pub const fn new(threshold: u32, cooldown_secs: u64) -> Self {
        Self {
            consecutive_failures: AtomicU32::new(0),
            tripped_at: AtomicU64::new(0),
            threshold,
            cooldown_secs,
        }
    }

    /// Check if a request should be allowed through.
    /// Returns `Ok(())` if allowed, `Err(message)` if circuit is open.
    pub fn check(&self) -> Result<(), String> {
        let failures = self.consecutive_failures.load(Ordering::Relaxed);
        if failures < self.threshold {
            return Ok(());
        }

        let tripped = self.tripped_at.load(Ordering::Relaxed);
        let now = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        if now - tripped < self.cooldown_secs {
            Err(format!(
                "Circuit breaker open: {} consecutive failures, cooling down for {}s",
                failures,
                self.cooldown_secs - (now - tripped)
            ))
        } else {
            // Half-open: allow one probe request through
            Ok(())
        }
    }

    /// Record a successful request — resets the failure counter.
    pub fn record_success(&self) {
        self.consecutive_failures.store(0, Ordering::Relaxed);
        self.tripped_at.store(0, Ordering::Relaxed);
    }

    /// Record a failed request — increments the failure counter.
    /// If the threshold is reached, trips the circuit open.
    pub fn record_failure(&self) {
        let prev = self.consecutive_failures.fetch_add(1, Ordering::Relaxed);
        if prev + 1 >= self.threshold {
            let now = SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            self.tripped_at.store(now, Ordering::Relaxed);
            warn!(
                "[circuit-breaker] Tripped after {} consecutive failures — cooling down {}s",
                prev + 1,
                self.cooldown_secs
            );
        }
    }
}

// ── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retryable_statuses() {
        assert!(is_retryable_status(429));
        assert!(is_retryable_status(500));
        assert!(is_retryable_status(502));
        assert!(is_retryable_status(503));
        assert!(is_retryable_status(504));
        assert!(is_retryable_status(529));
        assert!(!is_retryable_status(200));
        assert!(!is_retryable_status(400));
        assert!(!is_retryable_status(401));
        assert!(!is_retryable_status(403));
        assert!(!is_retryable_status(404));
    }

    #[test]
    fn parse_retry_after_valid() {
        assert_eq!(parse_retry_after("5"), Some(5));
        assert_eq!(parse_retry_after(" 30 "), Some(30));
        assert_eq!(parse_retry_after("not-a-number"), None);
    }

    #[test]
    fn jitter_stays_in_range() {
        for base in [100, 1000, 5000, 30_000] {
            let result = apply_jitter(base);
            let lower = (base as f64 * 0.7) as u64;
            let upper = (base as f64 * 1.3) as u64;
            assert!(
                result >= lower.max(100) && result <= upper,
                "jitter({}) = {} not in [{}, {}]",
                base, result, lower, upper
            );
        }
    }

    #[test]
    fn circuit_breaker_trips_and_recovers() {
        let cb = CircuitBreaker::new(3, 1); // trip after 3 failures, 1s cooldown

        // Normal operation
        assert!(cb.check().is_ok());
        cb.record_failure();
        cb.record_failure();
        assert!(cb.check().is_ok()); // 2 failures, threshold is 3

        cb.record_failure(); // 3rd failure — trips
        assert!(cb.check().is_err()); // circuit is open

        // Reset on success
        cb.record_success();
        assert!(cb.check().is_ok());
    }

    #[test]
    fn circuit_breaker_resets_on_success() {
        let cb = CircuitBreaker::new(3, 60);
        cb.record_failure();
        cb.record_failure();
        cb.record_success(); // Reset counter
        cb.record_failure();
        cb.record_failure();
        assert!(cb.check().is_ok()); // Still only 2 since reset
    }
}
