//! Production hooks shared by chat/code tools that mutate agent collaboration
//! state. Keeping Tauri/AppState here (instead of in `tools`) lets the tool
//! modules stay unit-testable with `agent_hooks: None`.

use tauri::{AppHandle, Emitter, Manager};

use crate::commands::channels::AgentChannelUpdatedEvent;
use crate::commands::tasks::AgentTaskUpdatedEvent;
use crate::state::AppState;
use crate::tools::AgentHooks;

#[derive(Clone)]
pub struct AppAgentHooks {
    app: AppHandle,
}

impl AppAgentHooks {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl AgentHooks for AppAgentHooks {
    fn task_updated(&self, task: &crate::agents::AgentTask) {
        let _ = self.app.emit(
            "lumina:agent-task-updated",
            AgentTaskUpdatedEvent {
                task_id: task.id.clone(),
                owner_agent_id: task.owner_agent_id.clone(),
                status: task.status.clone(),
                title: task.title.clone(),
                origin_conversation_id: task.origin_conversation_id.clone(),
            },
        );
    }

    fn channel_updated(&self, channel_id: &str) {
        let _ = self.app.emit(
            "lumina:agent-channel-updated",
            AgentChannelUpdatedEvent {
                channel_id: channel_id.to_string(),
            },
        );
    }

    fn cancel_conversation(&self, conversation_id: &str) {
        let state = self.app.state::<AppState>();
        state.cancel_conversation(conversation_id);
        let _ = state.db.end_computer_session(
            conversation_id,
            "stopped",
            crate::domain::now_ms(),
        );
    }

    fn create_agent(
        &self,
        input: &crate::agents::AgentInput,
    ) -> Result<crate::agents::Agent, String> {
        let state = self.app.state::<AppState>();
        crate::commands::agents::create_agent_validated(&state, input.clone())
    }

    fn agent_created(&self, agent: &crate::agents::Agent) {
        let _ = self.app.emit(
            "lumina:agent-created",
            serde_json::json!({ "agentId": agent.id, "name": agent.name }),
        );
    }
}
