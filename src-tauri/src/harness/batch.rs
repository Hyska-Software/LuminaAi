//! Chamadas "batch" (não-streaming para o usuário) do harness.
//!
//! Usadas para tarefas auxiliares que não fazem parte do turno visível: resumo
//! de compactação de contexto e sugestão de mensagem de commit. Reaproveitam a
//! mesma resolução de credencial/protocolo e o mesmo transporte do turno, mas
//! descartam os eventos (o texto é coletado em memória).

use std::sync::Arc;

use parking_lot::Mutex;
use tokio_util::sync::CancellationToken;

use crate::providers::{self, CompletionRequest, HistoryMessage, ProviderEvent};

use super::{
    provider_config, resolve_credential, resolve_model, resolve_protocols, HarnessDeps,
};

/// Requisição de texto único (sem tools).
pub struct BatchRequest<'a> {
    pub provider_id: &'a str,
    pub model_id: &'a str,
    pub system_prompt: &'a str,
    pub user_text: &'a str,
    pub max_output_tokens: u32,
    pub temperature: Option<f32>,
}

/// Executa uma completion não-streaming e devolve o texto final.
///
/// Falhas de provedor são devolvidas com contexto; o chamador decide se é
/// crítico (compactação) ou opcional (sugestão de commit).
pub async fn complete_text(deps: &HarnessDeps, request: BatchRequest<'_>) -> anyhow::Result<String> {
    let provider = deps
        .catalog
        .provider(request.provider_id)
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("provedor desconhecido: {}", request.provider_id))?;
    let model = resolve_model(deps, &provider, request.model_id).ok_or_else(|| {
        anyhow::anyhow!(
            "modelo `{}` indisponível no provedor `{}`",
            request.model_id,
            provider.id
        )
    })?;
    let credential = resolve_credential(deps, &provider)
        .await
        .map_err(|error| anyhow::anyhow!("credencial indisponível: {error}"))?;
    let protocols = resolve_protocols(&provider, &model)?;
    let cancel = CancellationToken::new();
    let completion = CompletionRequest {
        config: provider_config(&provider, &model, &credential, "batch"),
        protocols,
        history: vec![HistoryMessage::user(request.user_text.to_string())],
        system_prompt: request.system_prompt.to_string(),
        tools: Vec::new(),
        reasoning: crate::providers::ReasoningRequest::Auto,
        max_output_tokens: Some(request.max_output_tokens.clamp(256, 4_096)),
        temperature: request.temperature,
        cancel: cancel.clone(),
    };

    let text = Arc::new(Mutex::new(String::new()));
    let (sink, mut events) = tokio::sync::mpsc::unbounded_channel::<ProviderEvent>();
    let reader = {
        let text = text.clone();
        tokio::spawn(async move {
            while let Some(event) = events.recv().await {
                if let ProviderEvent::TextDelta(delta) = event {
                    text.lock().push_str(&delta);
                }
            }
        })
    };

    let result = match &deps.streamer {
        Some(streamer) => streamer(completion, sink).await,
        None => providers::stream_completion(&deps.http, completion, sink).await,
    };
    // Fecha o canal para o leitor terminar mesmo em erro (o stream pode ter
    // enviado deltas parciais antes de falhar).
    if let Err(error) = result {
        reader.abort();
        return Err(error);
    }
    reader
        .await
        .map_err(|error| anyhow::anyhow!("leitor do batch falhou: {error}"))?;
    let text = text.lock().clone();
    let trimmed = text.trim().to_string();
    if trimmed.is_empty() {
        anyhow::bail!("o modelo não devolveu texto");
    }
    Ok(trimmed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::Settings;

    fn deps_with_streamer(streamer: super::super::ProviderStreamer) -> HarnessDeps {
        let db = Arc::new(crate::db::Db::open_in_memory().expect("db"));
        HarnessDeps {
            app: None,
            db,
            http: reqwest::Client::new(),
            search_http: reqwest::Client::new(),
            catalog: crate::catalog::CatalogFile::load().expect("catalog"),
            streamer: Some(streamer),
            credential_override: Some(super::super::CredentialOverride::ApiKey("k".into())),
            refresh_override: None,
            model_source: None,
            api_key_override: None,
            data_dir: Some(std::env::temp_dir()),
            skills_roots: Some(Vec::new()),
            approvals: None,
            observed: None,
            jobs: None,
            questions: None,
        mcp: None,
        }
    }

    #[tokio::test]
    async fn collects_streamed_text_and_rejects_empty_answers() {
        let streamer: super::super::ProviderStreamer = Arc::new(|_request, sink| {
            Box::pin(async move {
                let _ = sink.send(ProviderEvent::TextDelta("primeira ".to_string()));
                let _ = sink.send(ProviderEvent::TextDelta("segunda".to_string()));
                Ok(())
            })
        });
        let deps = deps_with_streamer(streamer);
        let text = complete_text(
            &deps,
            BatchRequest {
                provider_id: "opencode-go",
                model_id: "deepseek-v4.1-flash",
                system_prompt: "Resuma.",
                user_text: "conteúdo",
                max_output_tokens: 256,
                temperature: None,
            },
        )
        .await
        .expect("texto coletado");
        assert_eq!(text, "primeira segunda");
        let _ = Settings::default();
    }

    #[tokio::test]
    async fn empty_answer_is_an_error() {
        let streamer: super::super::ProviderStreamer =
            Arc::new(|_request, _sink| Box::pin(async move { Ok(()) }));
        let deps = deps_with_streamer(streamer);
        let error = complete_text(
            &deps,
            BatchRequest {
                provider_id: "opencode-go",
                model_id: "deepseek-v4.1-flash",
                system_prompt: "Resuma.",
                user_text: "conteúdo",
                max_output_tokens: 256,
                temperature: None,
            },
        )
        .await
        .expect_err("vazio é erro");
        assert!(format!("{error}").contains("não devolveu texto"));
    }
}
