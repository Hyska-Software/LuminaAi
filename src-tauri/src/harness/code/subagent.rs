//! Subagentes (`task`): delegação para um agente filho **somente leitura**.
//!
//! O filho roda o mesmo loop/perfil Code numa conversa efêmera (workspace da
//! sessão, permissão `read_only`, tools de leitura) e devolve o texto final ao
//! pai; a conversa do filho é apagada depois (o resultado fica no card da tool).
//! Profundidade máxima 1: o catálogo do filho não inclui `task` e o runner
//! recusa aninhamento.
//!
//! Contrato: `docs/goals/code-harness/PLAN.md` F8 e `TOOLS.md` §2.6.

use std::sync::Arc;

use futures_util::future::BoxFuture;
use tokio_util::sync::CancellationToken;

use crate::db::Db;
use crate::domain::{
    Conversation, PermissionMode, Settings, TurnOptions, TurnPayload, TurnProfile,
    CONVERSATION_MODE_CODE,
};
use crate::events::TurnEvent;
use crate::harness::{self, EventEmitter, HarnessDeps};

/// Tipo de delegação (define o prompt do filho).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SubagentKind {
    /// Explorar o repositório e responder (sem editar).
    Explore,
    /// Revisar o diff/alterações e apontar problemas.
    Review,
    /// Trabalho geral de leitura/investigação.
    General,
}

impl SubagentKind {
    pub fn from_str(value: &str) -> Self {
        match value.trim().to_ascii_lowercase().as_str() {
            "review" | "revisor" | "revisão" => Self::Review,
            "general" | "geral" => Self::General,
            _ => Self::Explore,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Explore => "explore",
            Self::Review => "review",
            Self::General => "general",
        }
    }

    fn instructions(self) -> &'static str {
        match self {
            Self::Explore => {
                "You are an exploration subagent. Read the relevant files, answer the \
                 question with concrete paths and line numbers, and return an objective summary. You \
                 CANNOT edit files or run commands — the parent will make the changes."
            }
            Self::Review => {
                "You are a reviewer subagent. Examine the repository changes (git diff/status) \
                 and the parent's request, point out bugs, risks, missing tests and concrete \
                 suggestions. You CANNOT edit files or run commands."
            }
            Self::General => {
                "You are a support subagent. Investigate the workspace and answer with a summary \
                 useful to another agent. You CANNOT edit files or run commands."
            }
        }
    }
}

/// Pedido de delegação vindo da tool `task`.
#[derive(Debug, Clone)]
pub struct SubagentRequest {
    /// Conversa pai que originou a delegação (usado pelo runner/task tool).
    #[allow(dead_code)]
    pub parent_conversation_id: String,
    pub workspace_id: Option<String>,
    pub provider_id: String,
    pub model_id: String,
    pub description: String,
    pub prompt: String,
    pub kind: SubagentKind,
    pub depth: u32,
}

/// Runner injetado no `ToolCtx` (a implementação vive no harness, que tem o loop).
pub trait SubagentRunner: Send + Sync {
    fn run(&self, request: SubagentRequest) -> BoxFuture<'static, anyhow::Result<String>>;
}

struct RunnerImpl {
    deps: HarnessDeps,
    settings: Settings,
    parent: Conversation,
    depth: u32,
}

impl SubagentRunner for RunnerImpl {
    fn run(&self, request: SubagentRequest) -> BoxFuture<'static, anyhow::Result<String>> {
        if !can_delegate(self.depth) {
            return Box::pin(async move {
                anyhow::bail!("DELEGATION_DEPTH: subagentes não podem delegar de novo")
            });
        }
        let deps = self.deps.clone();
        let settings = self.settings.clone();
        let parent = self.parent.clone();
        Box::pin(async move { run_child(deps, settings, parent, request).await })
    }
}

/// Constrói o runner para o turno Code atual.
pub fn runner(
    deps: &HarnessDeps,
    settings: &Settings,
    parent: &Conversation,
    depth: u32,
) -> Arc<dyn SubagentRunner> {
    Arc::new(RunnerImpl {
        deps: deps.clone(),
        settings: settings.clone(),
        parent: parent.clone(),
        depth,
    })
}

struct DiscardEmitter;

impl EventEmitter for DiscardEmitter {
    fn emit(&self, _event: TurnEvent) {}
}

fn truncate(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    let mut out: String = text.chars().take(max.saturating_sub(1)).collect();
    out.push('…');
    out
}

async fn run_child(
    deps: HarnessDeps,
    settings: Settings,
    parent: Conversation,
    request: SubagentRequest,
) -> anyhow::Result<String> {
    let db: Arc<Db> = deps.db.clone();
    let provider_id = if request.provider_id.trim().is_empty() {
        parent.provider_id.clone()
    } else {
        request.provider_id.clone()
    };
    let model_id = if request.model_id.trim().is_empty() {
        parent.model_id.clone()
    } else {
        request.model_id.clone()
    };
    let workspace_id = request.workspace_id.clone().or(parent.workspace_id.clone());
    let title = format!("Subagente: {}", truncate(request.description.trim(), 48));
    let child =
        db.create_conversation_with_mode(&title, &provider_id, &model_id, CONVERSATION_MODE_CODE)?;
    db.set_conversation_workspace(&child.id, workspace_id.as_deref())?;
    // Filho é somente leitura: a política nega escrita/shell; o catálogo também
    // é reduzido a leitura (defesa em profundidade).
    db.set_conversation_permission_mode(&child.id, PermissionMode::ReadOnly)?;

    let instructions = format!(
        "# Subagent instructions\n\n{}\n\nParent agent request: {}",
        request.kind.instructions(),
        request.prompt.trim()
    );
    let payload = TurnPayload {
        conversation_id: child.id.clone(),
        content: request.prompt.clone(),
        attachment_ids: Vec::new(),
        provider_id,
        model_id,
        reasoning: None,
        options: TurnOptions {
            max_steps: 24,
            delegation_depth: request.depth.saturating_add(1),
            web_search: false,
            create_files: false,
            run_code: false,
            system_prompt_override: Some(instructions),
            ..Default::default()
        },
        profile: TurnProfile::Code,
        turn_id: None,
    };
    let emitter: Arc<dyn EventEmitter> = Arc::new(DiscardEmitter);
    let cancel = CancellationToken::new();
    let result = harness::run_turn(deps.clone(), payload, settings, emitter, cancel).await;
    // A conversa do subagente é efêmera: o resultado fica no card da tool.
    let _ = db.delete_conversation(&child.id);
    let result = result?;
    let text = result.assistant_message.content.trim().to_string();
    if text.is_empty() {
        anyhow::bail!("o subagente terminou sem resposta útil");
    }
    Ok(text)
}

/// Só a sessão de topo pode delegar (máximo 1 nível de subagente).
pub fn can_delegate(depth: u32) -> bool {
    depth == 0
}

/// Nomes de tools visíveis para um subagente (somente leitura).
pub fn readonly_tools() -> &'static [&'static str] {
    &[
        "read_file",
        "list_dir",
        "search_files",
        "search_text",
        "read_tool_output",
        "git_status",
        "git_diff",
        "git_log",
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn runner_executes_a_child_turn_and_deletes_the_ephemeral_conversation() {
        use crate::domain::{Settings, CONVERSATION_MODE_CODE};
        use crate::harness::CredentialOverride;
        use crate::providers::ProviderEvent;

        let db = std::sync::Arc::new(crate::db::Db::open_in_memory().expect("db"));
        let parent = db
            .create_conversation_with_mode(
                "Pai",
                "opencode-go",
                "deepseek-v4.1-flash",
                CONVERSATION_MODE_CODE,
            )
            .expect("conversa pai");
        let streamer: crate::harness::ProviderStreamer = std::sync::Arc::new(|_request, sink| {
            Box::pin(async move {
                let _ = sink.send(ProviderEvent::TextDelta(
                    "achei src/app.ts com duas constantes".to_string(),
                ));
                let _ = sink.send(ProviderEvent::Done);
                Ok(())
            })
        });
        let data_dir =
            std::env::temp_dir().join(format!("lumina-subagent-{}", uuid::Uuid::new_v4()));
        let deps = HarnessDeps {
            app: None,
            db: db.clone(),
            http: reqwest::Client::new(),
            search_http: reqwest::Client::new(),
            catalog: crate::catalog::CatalogFile::load().expect("catalog"),
            streamer: Some(streamer),
            credential_override: Some(CredentialOverride::ApiKey("k".into())),
            refresh_override: None,
            model_source: None,
            api_key_override: None,
            data_dir: Some(data_dir),
            skills_roots: Some(Vec::new()),
            approvals: None,
            observed: None,
            jobs: None,
            questions: None,
            mcp: None,
        };
        let settings = Settings::default();
        let runner = runner(&deps, &settings, &parent, 0);
        let text = runner
            .run(SubagentRequest {
                parent_conversation_id: parent.id.clone(),
                workspace_id: None,
                provider_id: String::new(),
                model_id: String::new(),
                description: "Explorar src".to_string(),
                prompt: "O que há em src/app.ts?".to_string(),
                kind: SubagentKind::Explore,
                depth: 0,
            })
            .await
            .expect("resumo do filho");
        assert!(text.contains("achei src/app.ts"));
        // Conversa efêmera do subagente foi removida; só o pai continua.
        assert_eq!(db.list_conversations().expect("conversas").len(), 1);
    }

    #[test]
    fn depth_guard_allows_only_the_top_level() {
        assert!(can_delegate(0));
        assert!(!can_delegate(1));
        assert!(!can_delegate(3));
    }
    #[test]
    fn kinds_parse_and_describe() {
        assert_eq!(SubagentKind::from_str("review"), SubagentKind::Review);
        assert_eq!(SubagentKind::from_str("explore"), SubagentKind::Explore);
        assert_eq!(SubagentKind::from_str("x"), SubagentKind::Explore);
        assert!(SubagentKind::Review.instructions().contains("reviewer"));
    }

    #[test]
    fn readonly_tools_contain_no_mutating_tool() {
        let tools = readonly_tools();
        assert!(tools.contains(&"read_file"));
        assert!(!tools.contains(&"write_file"));
        assert!(!tools.contains(&"run_command"));
        assert!(!tools.contains(&"task"));
    }

    #[test]
    fn truncate_keeps_it_short() {
        assert_eq!(truncate("abc", 10), "abc");
        assert_eq!(truncate("abcdef", 4).chars().count(), 4);
    }
}
