import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { expect, it } from 'vitest'
import { scanAiVaultSessions } from './session-scanner'
import { isolatedScanRoots } from './scanner-fixtures/session-scanner-test-fixtures'
import { runExternalAutomationAction } from '../automations/external-managers/external-manager-mutations'
import { pickTuiAgent } from '../../shared/agent-launch/catalog/tui-agent-selection'

it('skips local, legacy and WSL integration histories while still discovering Pi sessions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'orca-local-discovery-'))
  try {
    const roots = isolatedScanRoots(root)
    const wslHome = join(root, 'wsl-home')
    const transcript = [
      { type: 'session', id: 'local-fixture', cwd: '/repo', timestamp: '2026-11-19T10:00:00Z' },
      {
        type: 'message',
        message: { role: 'user', content: 'saved conversation' },
        timestamp: '2026-11-19T10:00:01Z'
      }
    ]
      .map((line) => JSON.stringify(line))
      .join('\n')
    const files = [
      join(roots.openclawStateDir, 'agents', 'main', 'sessions', 'local.jsonl'),
      join(roots.openclawLegacyStateDir, 'agents', 'main', 'sessions', 'legacy.jsonl'),
      join(wslHome, '.openclaw', 'agents', 'main', 'sessions', 'wsl.jsonl'),
      join(wslHome, '.clawdbot', 'agents', 'main', 'sessions', 'wsl-legacy.jsonl'),
      join(roots.piSessionsDir, 'pi.jsonl')
    ]
    for (const file of files) {
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, `${transcript}\n`)
    }
    const result = await scanAiVaultSessions({
      ...roots,
      antigravityAppHome: join(root, 'antigravity-app'),
      wslHomeDirs: [wslHome]
    })
    expect(result.sessions.map((session) => session.agent)).toEqual(['pi'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('rejects saved external automation actions', async () => {
  await expect(
    runExternalAutomationAction({
      managerId: 'openclaw:local',
      provider: 'openclaw',
      target: { type: 'local' },
      action: 'run',
      jobId: 'saved-job'
    })
  ).rejects.toMatchObject({ code: 'external_automation_provider_not_allowed' })
})

it('falls back from a saved integration preference even when it is reported usable', () => {
  expect(pickTuiAgent('openclaw', ['openclaw', 'cursor'], [], () => true)).toBe('cursor')
})
