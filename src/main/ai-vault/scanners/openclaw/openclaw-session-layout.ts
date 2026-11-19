import type { AiVaultAgentSource } from '../../discovery/session-scanner-agent-sources'

// Persisted agent identities remain readable without discovering this integration's files.
export const OPENCLAW_AGENT_SOURCE: AiVaultAgentSource = {
  rootDirs: () => [],
  extensions: []
}
