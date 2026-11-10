//! PKCE (RFC 7636), `state` and OIDC `nonce` generation for Sign in with
//! ChatGPT. All values come from the OS CSPRNG via `getrandom`.

use anyhow::{anyhow, Result};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use sha2::{Digest, Sha256};

/// PKCE verifier + S256 challenge pair.
#[derive(Clone)]
pub struct PkceCodes {
    pub verifier: String,
    pub challenge: String,
}

fn random_b64(bytes: usize) -> Result<String> {
    let mut buf = vec![0_u8; bytes];
    getrandom::getrandom(&mut buf).map_err(|error| {
        anyhow!(crate::i18n::t_args(
            "oauth.errors.entropy",
            &[("error", &error.to_string())],
        ))
    })?;
    Ok(URL_SAFE_NO_PAD.encode(buf))
}

/// 64 random bytes -> 86-char URL-safe verifier (within the 43..128 range).
pub fn generate_pkce() -> Result<PkceCodes> {
    let verifier = random_b64(64)?;
    let challenge = challenge_for(&verifier);
    Ok(PkceCodes {
        verifier,
        challenge,
    })
}

/// `BASE64URL(SHA256(ascii(verifier)))` without padding.
pub fn challenge_for(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

/// Fresh OAuth `state` bound to one authorization attempt.
pub fn generate_state() -> Result<String> {
    random_b64(32)
}

/// Fresh OIDC `nonce` bound to one authorization attempt.
pub fn generate_nonce() -> Result<String> {
    random_b64(32)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// RFC 7636 appendix B test vector.
    #[test]
    fn matches_the_rfc7636_vector() {
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        assert_eq!(
            challenge_for(verifier),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn generators_return_url_safe_values_of_the_expected_length() {
        let pkce = generate_pkce().expect("pkce");
        assert!((43..=128).contains(&pkce.verifier.len()));
        assert_eq!(pkce.verifier.len(), 86);
        assert_eq!(pkce.challenge.len(), 43);
        let valid = |value: &str| {
            value
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        };
        assert!(valid(&pkce.verifier));
        assert!(valid(&pkce.challenge));

        let state = generate_state().expect("state");
        let nonce = generate_nonce().expect("nonce");
        assert_eq!(state.len(), 43);
        assert_eq!(nonce.len(), 43);
        assert!(valid(&state) && valid(&nonce));
        assert_ne!(state, generate_state().expect("state 2"));
        assert_ne!(nonce, generate_nonce().expect("nonce 2"));
    }

    #[test]
    fn verifier_and_challenge_are_independent_per_attempt() {
        let a = generate_pkce().expect("a");
        let b = generate_pkce().expect("b");
        assert_ne!(a.verifier, b.verifier);
        assert_ne!(a.challenge, b.challenge);
    }
}
