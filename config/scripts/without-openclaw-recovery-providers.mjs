import path from 'node:path'
import { homedir } from 'node:os'
import { access } from 'node:fs/promises'
import { queryDatabase, walkFiles } from './without-openclaw-recovery-files.mjs'

export function defaultRecoveryRoot(profile) {
  const name = path.basename(profile)
  return path.join(homedir(), 'Documents', 'Codex', 'Orca Recovery', name)
}

export async function providerFiles(profile, home = homedir()) {
  const records = queryDatabase(path.join(profile, 'agent-session-journal.db'), (db) =>
    db
      .prepare('SELECT record_json FROM agent_session_records')
      .all()
      .map((r) => JSON.parse(r.record_json))
  )
  const threadIds = new Set()
  const homes = new Set([path.join(home, '.codex')])
  for (const record of records) {
    if (record.location?.executionHostId && record.location.executionHostId !== 'local') {
      continue
    }
    if (record.provider !== 'codex') {
      continue
    }
    if (record.accountHome?.variable === 'CODEX_HOME') {
      homes.add(record.accountHome.path)
    }
    for (const link of record.providerHandleChain ?? []) {
      if (link.handle?.threadId) {
        threadIds.add(link.handle.threadId)
      }
    }
  }
  const files = []
  let homeIndex = 0
  for (const root of homes) {
    const label = `codex-${homeIndex++}`
    for (const folder of ['sessions', 'archived_sessions']) {
      for await (const relative of walkFiles(path.join(root, folder))) {
        if (!relative.endsWith('.jsonl')) {
          continue
        }
        const id = path
          .basename(relative)
          .match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0]
        if (id && threadIds.has(id)) {
          files.push({
            source: path.join(root, folder, relative),
            relative: path.join('providers', label, folder, relative),
            restoreRoot: root
          })
        }
      }
    }
  }
  const data = process.env.XDG_DATA_HOME || path.join(home, '.local', 'share')
  const opencode = path.join(data, 'opencode', 'opencode.db')
  if (
    await access(opencode).then(
      () => true,
      () => false
    )
  ) {
    files.push({
      source: opencode,
      relative: path.join('providers', 'opencode', 'opencode.db'),
      restoreRoot: path.dirname(opencode)
    })
  }
  return files
}
