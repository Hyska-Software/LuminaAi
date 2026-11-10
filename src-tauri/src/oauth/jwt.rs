//! OpenID Connect ID-token validation: JWKS parsing (RS256), signature check,
//! issuer/audience/expiry/nonce validation.
//!
//! The ChatGPT plan-usage flow requires the ID token to be verified against
//! OpenAI's JWKS before the account identity (`sub`) is trusted.

use anyhow::{anyhow, Result};
use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
use serde::Deserialize;
use serde_json::Value;

/// Minimal JWKS key (RSA).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Jwk {
    pub kid: String,
    pub n: String,
    pub e: String,
}

#[derive(Debug, Deserialize)]
struct RawJwks {
    #[serde(default)]
    keys: Vec<RawJwk>,
}

#[derive(Debug, Deserialize)]
struct RawJwk {
    #[serde(default)]
    kid: String,
    #[serde(default)]
    kty: String,
    #[serde(default)]
    n: String,
    #[serde(default)]
    e: String,
}

/// Parses the RSA signing keys of a JWKS document (non-RSA/incomplete entries
/// are ignored; a JWKS with zero usable keys is an error).
pub fn parse_jwks(document: &Value) -> Result<Vec<Jwk>> {
    let raw: RawJwks = serde_json::from_value(document.clone())
        .map_err(|error| {
            anyhow!(crate::i18n::t_args(
                "oauth.errors.jwksInvalid",
                &[("error", &error.to_string())],
            ))
        })?;
    let keys: Vec<Jwk> = raw
        .keys
        .into_iter()
        .filter(|key| key.kty.eq_ignore_ascii_case("RSA"))
        .filter(|key| !key.n.is_empty() && !key.e.is_empty())
        .map(|key| Jwk {
            kid: key.kid,
            n: key.n,
            e: key.e,
        })
        .collect();
    if keys.is_empty() {
        return Err(anyhow!(crate::i18n::t("oauth.errors.jwtJwksNoRsa")));
    }
    Ok(keys)
}

/// Claims used by the app (all optional here; `validate_claims` enforces the
/// required ones).
#[derive(Debug, Clone, Default, Deserialize)]
pub struct Claims {
    #[serde(default)]
    pub sub: Option<String>,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub nonce: Option<String>,
    #[serde(default)]
    pub iss: Option<String>,
    #[serde(default)]
    pub aud: Option<Value>,
    #[serde(default)]
    pub exp: Option<i64>,
}

impl Claims {
    pub fn audience_contains(&self, client_id: &str) -> bool {
        match self.aud.as_ref() {
            Some(Value::String(value)) => value == client_id,
            Some(Value::Array(values)) => values.iter().any(|value| value.as_str() == Some(client_id)),
            _ => false,
        }
    }

    pub fn subject(&self) -> Result<&str> {
        self.sub
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| anyhow!("ID token sem `sub`"))
    }

    pub fn email(&self) -> Option<&str> {
        self.email
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
    }
}

/// Validates the claims the app depends on. Signature/exp validation is done by
/// `verify`, but repeating issuer/audience/expiry checks here keeps the rules
/// explicit and independently testable.
pub fn validate_claims(
    claims: &Claims,
    issuer: &str,
    client_id: &str,
    expected_nonce: &str,
    now_secs: i64,
) -> Result<()> {
    if claims.iss.as_deref() != Some(issuer.trim_end_matches('/')) {
        return Err(anyhow!(
            "ID token com issuer inesperado: {:?}",
            claims.iss.as_deref()
        ));
    }
    if !claims.audience_contains(client_id) {
        return Err(anyhow!(crate::i18n::t("oauth.errors.jwtWrongAudience")));
    }
    match claims.exp {
        Some(exp) if exp + 60 >= now_secs => {}
        Some(_) => return Err(anyhow!("ID token expirado")),
        None => return Err(anyhow!("ID token sem `exp`")),
    }
    if claims.nonce.as_deref() != Some(expected_nonce) {
        return Err(anyhow!(crate::i18n::t("oauth.errors.jwtNonce")));
    }
    claims.subject()?;
    Ok(())
}

/// Verifies the JWT signature against the JWKS and then validates its claims.
pub fn verify(
    id_token: &str,
    jwks: &[Jwk],
    issuer: &str,
    client_id: &str,
    expected_nonce: &str,
) -> Result<Claims> {
    let header = decode_header(id_token).map_err(|error| {
        anyhow!(crate::i18n::t_args(
            "oauth.errors.jwtMalformed",
            &[("error", &error.to_string())],
        ))
    })?;
    let candidate = if header.kid.as_deref().is_some_and(|kid| !kid.is_empty()) {
        jwks.iter()
            .find(|key| Some(key.kid.as_str()) == header.kid.as_deref())
            .ok_or_else(|| anyhow!(crate::i18n::t("oauth.errors.jwtKidNotFound")))?
    } else if jwks.len() == 1 {
        &jwks[0]
    } else {
        return Err(anyhow!(crate::i18n::t("oauth.errors.jwtMissingKid")));
    };

    let key = DecodingKey::from_rsa_components(&candidate.n, &candidate.e)
        .map_err(|error| {
            anyhow!(crate::i18n::t_args(
                "oauth.errors.jwtKeyInvalid",
                &[("error", &error.to_string())],
            ))
        })?;
    let mut validation = Validation::new(Algorithm::RS256);
    validation.leeway = 60;
    validation.set_audience(&[client_id]);
    validation.set_issuer(&[issuer.trim_end_matches('/')]);
    let decoded = decode::<Claims>(id_token, &key, &validation)
        .map_err(|error| {
            anyhow!(crate::i18n::t_args(
                "oauth.errors.jwtRejected",
                &[("error", &error.to_string())],
            ))
        })?;

    let now = chrono::Utc::now().timestamp();
    validate_claims(&decoded.claims, issuer, client_id, expected_nonce, now)?;
    Ok(decoded.claims)
}

#[cfg(test)]
mod tests {
    use super::*;
    use jsonwebtoken::{encode, EncodingKey, Header};
    use serde::Serialize;

    // Test-only RSA key pair (never used outside tests).
    const TEST_BEARER_MODULUS: &str = "mTmnUE1cdSV_5TM6MU6DBjsVHeLMaHhrSDV3N2qE3VNJESWmlXRHyQBXD9Wr6nVyr-1H0vFWKrhySrv6297MlOfEbww7nXoFW1uRfUV2v0ztP18H--gnQHhIvh-Z1A41qVn2zjjulgGl8UXwFHB2hmV2vuGADn1BaspDQasRex5kjTJP1AI49HVwRoe3WohM14nu7GCEBBAWO3PDc3umcN_o-IhSM5NFQ75lCB0gVLLib8I0r9GASuNnZGMtd3b5BBTOLM2n-rYn6QFUDGT83MhVjDv0slIiD0a5hSJ6bRzACug8xEZ2crA5x3WDX542cqp9guEmxH8T_8qdQ8TQyQ";
    const TEST_PUBLIC_EXPONENT: &str = "AQAB";
    const TEST_PRIVATE_PEM: &str = "-----BEGIN RSA PRIVATE KEY-----\n\
MIIEowIBAAKCAQEAmTmnUE1cdSV/5TM6MU6DBjsVHeLMaHhrSDV3N2qE3VNJESWmlXRHyQBXD9Wr\n\
6nVyr+1H0vFWKrhySrv6297MlOfEbww7nXoFW1uRfUV2v0ztP18H++gnQHhIvh+Z1A41qVn2zjju\n\
lgGl8UXwFHB2hmV2vuGADn1BaspDQasRex5kjTJP1AI49HVwRoe3WohM14nu7GCEBBAWO3PDc3um\n\
cN/o+IhSM5NFQ75lCB0gVLLib8I0r9GASuNnZGMtd3b5BBTOLM2n+rYn6QFUDGT83MhVjDv0slIi\n\
D0a5hSJ6bRzACug8xEZ2crA5x3WDX542cqp9guEmxH8T/8qdQ8TQyQIDAQABAoIBADBG+xGRHmWG\n\
qDJmHpq0exH2gaPF9tOfxWWd+u8J78zwVeBCNad3WLrbEZNapm0cDkOiBnRPN/AD53bmnZazL1Bn\n\
afv3Jb1rWc68Hi4TOePyb/n8jj5vmhZ1D65ftI8c3wl54Ap/46R95nQLriYyfRXBWFWyJS/rhTYJ\n\
foFtTfe1Ue6B2YjcuvXdm4Z6f65pRFbdg5TpeMhmyeFUblrBKHO9rY63XC3EzZPv4k1mzpk/C8hI\n\
u3d7zRw56zw9pvRlpJnsyskKrxwJLEWWSJHvj0dkLx2EGmPh+hLd3r4CYLAr4soT2ALvlyhnZwrH\n\
k8g95uzmggfUtLKzMCYdVjJbqzUCgYEAwQ6j22HVeNbYup9VTJToipjaK0gO1a5Frh5MD/sYQCCf\n\
pI9/WhvY8mgBoPR4mRXbeDazVtyeDXIn8/PjfU1zpjHQ16i3w0Vk9XCOncjQ/zJ0aA1TAozgq4Qm\n\
efTLgJwy2gTdHPj+ONUwZ960t+nR35fYGTvmSS5aDugeAqQfG+8CgYEAyy54VjyDqRX0qpfir35W\n\
hCsAOD/Sm8Cm1Y8sPhYq2ekszJTpWAlu+oP+P2FzAwxWcPzpFNfiTGBQJKZuHkFJ13UOAwPQKri1\n\
7LMCBwHn6IDKMgiuzUaT5FoOfLxM7NEEpA5RODuPhrl5VJdOEmoWF1GsVOZhYCQ/lwv6KP15hscC\n\
gYAHwNbD0MIKAFbj59I9KR3NsyXP5yzxV/Zkb8MOQT9QE/9VVI4AyG2GDrdCB49wVnhh85BwRJv0\n\
XklMetcACURDwGxqvNPke7z6PnL70zzRgu054I8c4xuCx+PjsfkaSSuhpeBbcYSEM8ul4EPRvwo2\n\
uJptKQKunbXwM1JBOOYm8QKBgQCTpx+YO73KQMRevKXltsAUqFMujWL2ARi8laEnNWDKnyMJQSYZ\n\
7jESKJ25XY4BJxQiZAjWNtSjgFJ9b90Sa4vH4a7fDgRXJ4g9jRDqGr53PjCyD5FIaAPNrIxepVCZ\n\
wIPI3Qa1AMOaumqryJDZ3PJU2+uKfylAftcfY3rWEu4fvQKBgComOTc8mpLK1Tuds8g7vlBiYSF9\n\
Q9qYwKAJtJmIgr13cRrpqUIaqfiQdR2tcboV51fzAraHtoJo0Icp0KDVJEuEtx4W1/IqXHRQge47\n\
vQbqUy68i/58V8ANUDMQEBwdlrhHPMzfrwkIQZMozlZrm44+b7Idv0c/+qpJt3Yqqm/5\n\
-----END RSA PRIVATE KEY-----";

    fn test_jwks() -> Vec<Jwk> {
        vec![Jwk {
            kid: "test-key".into(),
            n: TEST_BEARER_MODULUS.into(),
            e: TEST_PUBLIC_EXPONENT.into(),
        }]
    }

    #[derive(Serialize)]
    struct TestClaims<'a> {
        sub: &'a str,
        email: &'a str,
        iss: &'a str,
        aud: &'a str,
        exp: i64,
        nonce: &'a str,
    }

    fn token(exp_offset: i64, nonce: &str, audience: &str) -> String {
        let claims = TestClaims {
            sub: "user-sub-1",
            email: "user@example.com",
            iss: "https://auth.openai.com",
            aud: audience,
            exp: chrono::Utc::now().timestamp() + exp_offset,
            nonce,
        };
        let mut header = Header::new(Algorithm::RS256);
        header.kid = Some("test-key".into());
        encode(
            &header,
            &claims,
            &EncodingKey::from_rsa_pem(TEST_PRIVATE_PEM.as_bytes()).expect("test key"),
        )
        .expect("encode")
    }

    #[test]
    fn parses_rsa_keys_and_ignores_other_kinds() {
        let document = serde_json::json!({
            "keys": [
                {"kty": "RSA", "kid": "a", "n": "abc", "e": "AQAB"},
                {"kty": "EC", "kid": "b", "x": "y"},
                {"kty": "RSA", "kid": "c", "n": "", "e": ""}
            ]
        });
        let keys = parse_jwks(&document).expect("keys");
        assert_eq!(keys.len(), 1);
        assert_eq!(keys[0].kid, "a");
        assert!(parse_jwks(&serde_json::json!({"keys": []})).is_err());
    }

    #[test]
    fn verifies_a_valid_id_token_and_exposes_identity() {
        let token = token(3600, "nonce-1", "oaiapp_client");
        let claims = verify(
            &token,
            &test_jwks(),
            "https://auth.openai.com",
            "oaiapp_client",
            "nonce-1",
        )
        .expect("valid token");
        assert_eq!(claims.subject().expect("sub"), "user-sub-1");
        assert_eq!(claims.email(), Some("user@example.com"));
    }

    #[test]
    fn rejects_expired_tokens_wrong_nonce_wrong_audience_and_bad_signature() {
        let expired = token(-3600, "n", "oaiapp_client");
        assert!(verify(
            &expired,
            &test_jwks(),
            "https://auth.openai.com",
            "oaiapp_client",
            "n"
        )
        .is_err());

        let wrong_nonce = token(3600, "other", "oaiapp_client");
        assert!(verify(
            &wrong_nonce,
            &test_jwks(),
            "https://auth.openai.com",
            "oaiapp_client",
            "n"
        )
        .is_err());

        let wrong_audience = token(3600, "n", "other-client");
        assert!(verify(
            &wrong_audience,
            &test_jwks(),
            "https://auth.openai.com",
            "oaiapp_client",
            "n"
        )
        .is_err());

        let valid = token(3600, "n", "oaiapp_client");
        let mut tampered = valid.clone();
        let last = tampered.pop().expect("token char");
        tampered.push(if last == 'A' { 'B' } else { 'A' });
        assert!(verify(
            &tampered,
            &test_jwks(),
            "https://auth.openai.com",
            "oaiapp_client",
            "n"
        )
        .is_err());
    }

    #[test]
    fn validate_claims_is_testable_in_isolation() {
        let claims = Claims {
            sub: Some("user".into()),
            email: Some("user@example.com".into()),
            nonce: Some("n".into()),
            iss: Some("https://auth.openai.com".into()),
            aud: Some(Value::Array(vec![Value::String("oaiapp_x".into())])),
            exp: Some(1_000),
        };
        validate_claims(&claims, "https://auth.openai.com", "oaiapp_x", "n", 900).expect("válido");
        assert!(validate_claims(&claims, "https://auth.openai.com", "oaiapp_x", "n", 2_000).is_err());
        assert!(validate_claims(&claims, "https://evil", "oaiapp_x", "n", 900).is_err());
        assert!(validate_claims(&claims, "https://auth.openai.com", "oaiapp_y", "n", 900).is_err());
        assert!(validate_claims(&claims, "https://auth.openai.com", "oaiapp_x", "z", 900).is_err());

        let no_sub = Claims {
            sub: Some("   ".into()),
            ..claims.clone()
        };
        assert!(validate_claims(&no_sub, "https://auth.openai.com", "oaiapp_x", "n", 900).is_err());
    }
}
