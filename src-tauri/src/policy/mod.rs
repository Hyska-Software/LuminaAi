//! Política de permissões do harness de código.
//!
//! Regras (docs/goals/code-harness/HARNESS.md §6):
//! 1. modo Plano ativo + mutação → nega;
//! 2. comando destrutivo → pergunta **sempre** (mesmo no modo Autônomo);
//! 3. arquivo de segredo → pergunta;
//! 4. alvo fora do workspace → pergunta (nega no modo Leitura);
//! 5. regras persistidas (`approval_rules`) decidem antes do padrão do modo;
//! 6. padrão do modo;
//! 7. fallback: pergunta para qualquer mutação.
//!
//! A decisão é **pura** e determinística — a UI e os testes dependem disso. Quem
//! executa a conversa com o usuário é o [`approval::ApprovalRegistry`].

pub mod approval;

use crate::domain::{ApprovalDecision, ApprovalRule, PermissionMode, RiskClass};

/// Decisão de política para uma chamada de tool.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PolicyDecision {
    /// Executa sem interação.
    Allow,
    /// Pausa o turno e pede decisão ao usuário.
    Ask { risk: RiskClass, reason: String },
    /// Recusa imediatamente (o modelo recebe `Error: …`).
    Deny { code: &'static str, reason: String },
}

impl PolicyDecision {
    pub fn is_allow(&self) -> bool {
        matches!(self, Self::Allow)
    }
}

/// Contexto da sessão usado na decisão.
pub struct PolicyContext<'a> {
    pub mode: PermissionMode,
    pub plan_mode: bool,
    pub trusted: bool,
    pub session_id: &'a str,
    pub workspace_id: Option<&'a str>,
    pub rules: &'a [ApprovalRule],
}

/// Fatos concretos de uma chamada de tool.
pub struct CallFacts<'a> {
    pub tool: &'a str,
    pub risk: RiskClass,
    /// A tool altera o mundo (write/edit/shell/ask).
    pub mutating: bool,
    /// Texto usado nas regras (comando ou path relativo).
    pub target: Option<&'a str>,
    /// O alvo está dentro do workspace (true quando não se aplica).
    pub inside_workspace: bool,
    /// O alvo casa com um padrão de arquivo de segredo.
    pub secret: bool,
    /// Motivo curto quando o comando é destrutivo.
    pub destructive_reason: Option<&'a str>,
}

/// Aplica a matriz de decisão. Ver `HARNESS.md` §6.2.
pub fn decide(ctx: &PolicyContext<'_>, facts: &CallFacts<'_>) -> PolicyDecision {
    // 1. Modo Plano nunca muta: é o gate de segurança do planejamento.
    if ctx.plan_mode && facts.mutating {
        return PolicyDecision::Deny {
            code: "PLAN_MODE_ACTIVE",
            reason: "o modo Plano é somente leitura; aprove o plano antes de executar"
                .to_string(),
        };
    }

    // 2. Destrutivo pede aprovação em QUALQUER modo.
    if let Some(reason) = facts.destructive_reason {
        return PolicyDecision::Ask {
            risk: RiskClass::Destroy,
            reason: format!("comando destrutivo ({reason})"),
        };
    }

    // 3. Arquivos de segredo exigem consentimento explícito.
    if facts.secret {
        return PolicyDecision::Ask {
            risk: RiskClass::Secret,
            reason: "o arquivo casa com um padrão de segredo (chaves/tokens)".to_string(),
        };
    }

    // 4. Fora do workspace: leitura livre? não — sempre pergunta; Leitura nega.
    if !facts.inside_workspace {
        return match ctx.mode {
            PermissionMode::ReadOnly => PolicyDecision::Deny {
                code: "FS_OUTSIDE_WORKSPACE",
                reason: "o modo Leitura só acessa arquivos dentro do workspace".to_string(),
            },
            _ => PolicyDecision::Ask {
                risk: RiskClass::Outside,
                reason: "o alvo está fora do workspace".to_string(),
            },
        };
    }

    // 5. Regras persistidas (sessão > workspace > global) vencem o padrão.
    if let Some(decision) = match_rule(ctx, facts) {
        return decision;
    }

    // 6. Padrão do modo.
    match ctx.mode {
        PermissionMode::ReadOnly => {
            if facts.mutating {
                PolicyDecision::Deny {
                    code: "POLICY_DENIED",
                    reason: "o modo Leitura não permite alterações; mude para Editar".to_string(),
                }
            } else {
                PolicyDecision::Allow
            }
        }
        PermissionMode::Edit => match facts.risk {
            RiskClass::Read | RiskClass::Network => PolicyDecision::Allow,
            RiskClass::Write => PolicyDecision::Allow,
            RiskClass::Shell | RiskClass::Ask => PolicyDecision::Ask {
                risk: facts.risk,
                reason: "o modo Editar pede aprovação para executar comandos".to_string(),
            },
            _ => PolicyDecision::Ask {
                risk: facts.risk,
                reason: "ação sensível".to_string(),
            },
        },
        PermissionMode::Autonomous => match facts.risk {
            RiskClass::Ask => PolicyDecision::Ask {
                risk: facts.risk,
                reason: "o agente precisa de uma decisão sua".to_string(),
            },
            _ => PolicyDecision::Allow,
        },
    }
    .normalize(ctx.trusted)
}

impl PolicyDecision {
    /// Workspace não confiável nunca executa mutações: vira `Ask` explícito
    /// ("confie na pasta"), nunca erro silencioso.
    fn normalize(self, trusted: bool) -> Self {
        match self {
            PolicyDecision::Allow if !trusted => PolicyDecision::Ask {
                risk: RiskClass::Write,
                reason: "o workspace não foi confirmado como confiável; confie na pasta para liberar"
                    .to_string(),
            },
            other => other,
        }
    }
}

/// Procura a primeira regra aplicável (sessão > workspace > global) para a tool
/// e o alvo. `Denied` vence qualquer allow do modo.
fn match_rule(ctx: &PolicyContext<'_>, facts: &CallFacts<'_>) -> Option<PolicyDecision> {
    let mut candidates: Vec<&ApprovalRule> = ctx
        .rules
        .iter()
        .filter(|rule| rule.tool == facts.tool || rule.tool == "*")
        .filter(|rule| rule.scope_id_applies(ctx))
        .filter(|rule| rule.matches(facts.target))
        .collect();
    // Escopo mais específico primeiro; dentro do mesmo escopo, negar vence.
    candidates.sort_by_key(|rule| match rule.scope {
        crate::domain::ApprovalScope::Session => 0u8,
        crate::domain::ApprovalScope::Workspace => 1,
        crate::domain::ApprovalScope::Global => 2,
    });
    let denied = candidates
        .iter()
        .find(|rule| rule.decision == ApprovalDecision::Denied);
    if let Some(rule) = denied {
        return Some(PolicyDecision::Deny {
            code: "POLICY_DENIED",
            reason: format!("regra \"{}\" nega esta ação", rule.pattern),
        });
    }
    candidates
        .iter()
        .find(|rule| rule.decision == ApprovalDecision::Approved)
        .map(|_| PolicyDecision::Allow)
}

impl ApprovalRule {
    fn scope_id_applies(&self, ctx: &PolicyContext<'_>) -> bool {
        match self.scope {
            crate::domain::ApprovalScope::Session => self.scope_id.as_deref() == Some(ctx.session_id),
            crate::domain::ApprovalScope::Workspace => match (self.scope_id.as_deref(), ctx.workspace_id) {
                (Some(rule_ws), Some(ws)) => rule_ws == ws,
                _ => false,
            },
            crate::domain::ApprovalScope::Global => true,
        }
    }

    fn matches(&self, target: Option<&str>) -> bool {
        let Some(target) = target else {
            return false;
        };
        match self.matcher.as_str() {
            "exact" => target == self.pattern,
            "prefix" => target.starts_with(&self.pattern),
            "glob" => glob_match(&self.pattern, target),
            _ => false,
        }
    }
}

/// Casamento de glob simples (`*` casa qualquer sequência, inclusive vazia).
/// Implementação própria para manter a política sem dependência externa.
pub fn glob_match(pattern: &str, value: &str) -> bool {
    let pattern: Vec<char> = pattern.chars().collect();
    let value: Vec<char> = value.chars().collect();
    let (mut p, mut v) = (0usize, 0usize);
    let (mut star, mut star_v) = (None::<usize>, 0usize);
    while v < value.len() {
        if p < pattern.len() && (pattern[p] == '?' || pattern[p] == value[v]) {
            p += 1;
            v += 1;
        } else if p < pattern.len() && pattern[p] == '*' {
            star = Some(p);
            star_v = v;
            p += 1;
        } else if let Some(star_pos) = star {
            p = star_pos + 1;
            star_v += 1;
            v = star_v;
        } else {
            return false;
        }
    }
    while p < pattern.len() && pattern[p] == '*' {
        p += 1;
    }
    p == pattern.len()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{ApprovalScope, FileChangeKind};

    fn ctx(mode: PermissionMode) -> PolicyContext<'static> {
        // Referências 'static de teste: usa vazias estáveis.
        PolicyContext {
            mode,
            plan_mode: false,
            trusted: true,
            session_id: "sess-1",
            workspace_id: Some("ws-1"),
            rules: &[],
        }
    }

    fn read() -> CallFacts<'static> {
        CallFacts {
            tool: "read_file",
            risk: RiskClass::Read,
            mutating: false,
            target: Some("src/app.ts"),
            inside_workspace: true,
            secret: false,
            destructive_reason: None,
        }
    }

    fn write() -> CallFacts<'static> {
        CallFacts {
            tool: "write_file",
            risk: RiskClass::Write,
            mutating: true,
            target: Some("src/app.ts"),
            inside_workspace: true,
            secret: false,
            destructive_reason: None,
        }
    }

    fn shell(command: &'static str, destructive: Option<&'static str>) -> CallFacts<'static> {
        CallFacts {
            tool: "run_command",
            risk: RiskClass::Shell,
            mutating: true,
            target: Some(command),
            inside_workspace: true,
            secret: false,
            destructive_reason: destructive,
        }
    }

    #[test]
    fn read_only_allows_reads_and_denies_writes() {
        let c = ctx(PermissionMode::ReadOnly);
        assert_eq!(decide(&c, &read()), PolicyDecision::Allow);
        assert!(matches!(decide(&c, &write()), PolicyDecision::Deny { code: "POLICY_DENIED", .. }));
    }

    #[test]
    fn edit_mode_allows_workspace_writes_and_asks_for_shell() {
        let c = ctx(PermissionMode::Edit);
        assert_eq!(decide(&c, &write()), PolicyDecision::Allow);
        assert!(matches!(decide(&c, &shell("npm test", None)), PolicyDecision::Ask { risk: RiskClass::Shell, .. }));
    }

    #[test]
    fn autonomous_allows_shell_but_still_asks_for_destructive() {
        let c = ctx(PermissionMode::Autonomous);
        assert_eq!(decide(&c, &shell("npm test", None)), PolicyDecision::Allow);
        assert!(matches!(
            decide(&c, &shell("rm -rf build", Some("rm -rf"))),
            PolicyDecision::Ask { risk: RiskClass::Destroy, .. }
        ));
    }

    #[test]
    fn plan_mode_denies_every_mutation_even_in_autonomous() {
        let mut c = ctx(PermissionMode::Autonomous);
        c.plan_mode = true;
        assert!(matches!(
            decide(&c, &write()),
            PolicyDecision::Deny { code: "PLAN_MODE_ACTIVE", .. }
        ));
        // leitura continua liberada no modo Plano
        assert_eq!(decide(&c, &read()), PolicyDecision::Allow);
    }

    #[test]
    fn secret_files_always_ask() {
        let c = ctx(PermissionMode::Autonomous);
        let mut facts = read();
        facts.secret = true;
        assert!(matches!(decide(&c, &facts), PolicyDecision::Ask { risk: RiskClass::Secret, .. }));
    }

    #[test]
    fn outside_workspace_asks_in_edit_and_denies_in_read_only() {
        let mut facts = read();
        facts.inside_workspace = false;
        facts.target = Some("C:/Users/u/.ssh/id_rsa");
        assert!(matches!(
            decide(&ctx(PermissionMode::Edit), &facts),
            PolicyDecision::Ask { risk: RiskClass::Outside, .. }
        ));
        assert!(matches!(
            decide(&ctx(PermissionMode::ReadOnly), &facts),
            PolicyDecision::Deny { code: "FS_OUTSIDE_WORKSPACE", .. }
        ));
    }

    #[test]
    fn untrusted_workspace_turns_allow_into_ask() {
        let mut c = ctx(PermissionMode::Edit);
        c.trusted = false;
        assert!(matches!(decide(&c, &write()), PolicyDecision::Ask { .. }));
    }

    #[test]
    fn persisted_rules_override_mode_and_deny_wins() {
        let allow = ApprovalRule {
            id: "r1".into(),
            scope: ApprovalScope::Workspace,
            scope_id: Some("ws-1".into()),
            tool: "run_command".into(),
            matcher: "prefix".into(),
            pattern: "npm test".into(),
            decision: ApprovalDecision::Approved,
            created_at: 0,
        };
        let deny = ApprovalRule {
            id: "r2".into(),
            scope: ApprovalScope::Session,
            scope_id: Some("sess-1".into()),
            tool: "run_command".into(),
            matcher: "glob".into(),
            pattern: "npm test*".into(),
            decision: ApprovalDecision::Denied,
            created_at: 0,
        };
        let rules = vec![allow, deny];
        let c = PolicyContext {
            mode: PermissionMode::Edit,
            plan_mode: false,
            trusted: true,
            session_id: "sess-1",
            workspace_id: Some("ws-1"),
            rules: &rules,
        };
        // sessão (deny) vence workspace (allow)
        assert!(matches!(decide(&c, &shell("npm test", None)), PolicyDecision::Deny { .. }));
    }

    #[test]
    fn scoped_allow_rule_matches_only_its_target() {
        let allow = ApprovalRule {
            id: "r1".into(),
            scope: ApprovalScope::Global,
            scope_id: None,
            tool: "run_command".into(),
            matcher: "prefix".into(),
            pattern: "git status".into(),
            decision: ApprovalDecision::Approved,
            created_at: 0,
        };
        let rules = vec![allow];
        let c = PolicyContext {
            mode: PermissionMode::Edit,
            plan_mode: false,
            trusted: true,
            session_id: "sess-1",
            workspace_id: Some("ws-1"),
            rules: &rules,
        };
        assert_eq!(decide(&c, &shell("git status --short", None)), PolicyDecision::Allow);
        assert!(matches!(decide(&c, &shell("npm install", None)), PolicyDecision::Ask { .. }));
    }

    #[test]
    fn glob_matching() {
        assert!(glob_match("src/*.ts", "src/app.ts"));
        assert!(glob_match("*", "qualquer"));
        assert!(glob_match("a*b*c", "axxbyyc"));
        assert!(!glob_match("src/*.ts", "src/app.tsx"));
        assert!(!glob_match("foo", "bar"));
    }

    #[test]
    fn file_change_kind_serde_is_lowercase() {
        let json = serde_json::to_string(&FileChangeKind::Modified).unwrap();
        assert_eq!(json, "\"modified\"");
    }
}
