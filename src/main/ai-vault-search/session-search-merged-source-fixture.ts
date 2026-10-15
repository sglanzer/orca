import { join } from 'node:path'
import { afterEach, beforeEach } from 'vitest'
import { AI_VAULT_AGENT_SOURCES } from '../ai-vault/session-scanner-agent-sources'
import { pathSegments } from '../ai-vault/session-file-discovery'

// Keep generic merged-root coverage independent of the removed integration's discovery.
export function installMergedSessionSourceFixture(): void {
  const original = AI_VAULT_AGENT_SOURCES.openclaw
  beforeEach(() => {
    AI_VAULT_AGENT_SOURCES.openclaw = {
      rootDirs: (options) =>
        [options.openclawStateDir, options.openclawLegacyStateDir].flatMap((root) =>
          root ? [join(root, 'agents')] : []
        ),
      extensions: ['.jsonl'],
      filePredicate: (filePath) => pathSegments(filePath).includes('sessions'),
      mergeRootDiscoveries: true
    }
  })
  afterEach(() => {
    AI_VAULT_AGENT_SOURCES.openclaw = original
  })
}
