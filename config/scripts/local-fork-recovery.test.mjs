import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { inspectProfile, readJson } from './local-fork-recovery-files.mjs'
import {
  createRecoverySnapshot,
  generations,
  recoverProfileIfNeeded,
  retainedGenerations,
  validateGeneration
} from './local-fork-recovery.mjs'
import { runRecoveryWatch } from './local-fork-recovery-watch.mjs'
import { startRecoveryWatcher } from './local-fork-recovery-launch.mjs'

const THREAD = '01a142dd-fbf4-7892-9c08-34585161e70c'

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'orca-durable-recovery-'))
  const profile = path.join(root, 'profile')
  const recovery = path.join(root, 'recovery')
  const home = path.join(root, 'home')
  const local = path.join(profile, 'profiles', 'local-default')
  await mkdir(local, { recursive: true })
  await writeFile(
    path.join(profile, 'orca-profile-index.json'),
    JSON.stringify({
      activeProfileId: 'local-default',
      profiles: [{ id: 'local-default' }]
    })
  )
  await writeFile(path.join(profile, 'agent-session-authority.key'), 'private-test-key')
  const settings = new DatabaseSync(path.join(local, 'profile-state.db'))
  settings.exec(`PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;
    CREATE TABLE profile_state_documents(domain TEXT PRIMARY KEY, payload TEXT);
    INSERT INTO profile_state_documents VALUES ('settings','{"theme":"system"}');
    INSERT INTO profile_state_documents VALUES ('workspaceSession','{"resume":"saved-session"}');`)
  const journal = new DatabaseSync(path.join(profile, 'agent-session-journal.db'))
  journal.exec(
    'PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE agent_session_records(session_id TEXT, record_json TEXT)'
  )
  journal.prepare('INSERT INTO agent_session_records VALUES (?, ?)').run(
    'chat-1',
    JSON.stringify({
      provider: 'codex',
      accountHome: { variable: 'CODEX_HOME', path: path.join(home, '.codex') },
      providerHandleChain: [{ handle: { threadId: THREAD } }]
    })
  )
  const orchestration = new DatabaseSync(path.join(profile, 'orchestration.db'))
  orchestration.exec('CREATE TABLE tasks(id TEXT)')
  const codex = path.join(home, '.codex', 'sessions', '2026', '10', '16', `rollout-${THREAD}.jsonl`)
  await mkdir(path.dirname(codex), { recursive: true })
  await writeFile(codex, '{"history":"complete"}\n')
  const opencodePath = path.join(home, '.local', 'share', 'opencode', 'opencode.db')
  await mkdir(path.dirname(opencodePath), { recursive: true })
  const opencode = new DatabaseSync(opencodePath)
  opencode.exec(
    "PRAGMA journal_mode=WAL; CREATE TABLE session_message(id TEXT); INSERT INTO session_message VALUES ('newest')"
  )
  let closed = false
  const close = () => {
    if (closed) {
      return
    }
    for (const db of [settings, journal, orchestration, opencode]) {
      db.close()
    }
    closed = true
  }
  t.after(async () => {
    close()
    await rm(root, { recursive: true, force: true })
  })
  return { root, profile, recovery, home, settings, journal, codex, opencodePath, close }
}

test('online copies include uncheckpointed history, settings, and provider transcripts', async (t) => {
  const f = await fixture(t)
  const snapshot = await createRecoverySnapshot(f)
  assert.equal(snapshot.manifest.summary.sessions, 1)
  assert.equal(snapshot.manifest.summary.documents['local-default'], 2)
  assert.equal(snapshot.manifest.providers.length, 2)
  await validateGeneration(snapshot, f.profile)
  assert.equal(f.journal.prepare('PRAGMA journal_mode').get().journal_mode, 'wal')
  f.journal.prepare('INSERT INTO agent_session_records VALUES (?, ?)').run('chat-2', '{}')
  assert.equal(inspectProfile(path.join(snapshot.directory, 'profile')).sessions, 1)
  assert.equal(inspectProfile(f.profile).sessions, 2)
})

test('a missing profile and missing provider files recover automatically', async (t) => {
  const f = await fixture(t)
  await createRecoverySnapshot(f)
  f.close()
  await rm(f.profile, { recursive: true })
  await rm(f.codex)
  await rm(f.opencodePath)
  const result = await recoverProfileIfNeeded(f)
  assert.equal(result.recovered, true)
  assert.equal(result.restoredProviderFiles, 2)
  assert.equal(inspectProfile(f.profile).sessions, 1)
  assert.match(await readFile(f.codex, 'utf8'), /complete/)
  assert.deepEqual(await recoverProfileIfNeeded(f), { recovered: false })
})

test('a corrupt newest backup falls back to an older verified generation', async (t) => {
  const f = await fixture(t)
  const old = await createRecoverySnapshot({ ...f, now: 1000 })
  f.journal.prepare('INSERT INTO agent_session_records VALUES (?, ?)').run('chat-2', '{}')
  const newest = await createRecoverySnapshot({ ...f, now: 2000 })
  await writeFile(path.join(newest.directory, 'profile', 'agent-session-journal.db'), 'damaged')
  f.close()
  await rm(f.profile, { recursive: true })
  const result = await recoverProfileIfNeeded(f)
  assert.equal(result.from, old.directory)
  assert.equal(inspectProfile(f.profile).sessions, 1)
  assert.equal((await generations(f.recovery)).length, 2)
})

test('an empty replacement never rotates away the saved conversations', async (t) => {
  const f = await fixture(t)
  await createRecoverySnapshot(f)
  f.journal.exec('DELETE FROM agent_session_records')
  await assert.rejects(createRecoverySnapshot(f), /empty profile/)
  assert.equal((await generations(f.recovery)).length, 1)
  f.close()
  const recovered = await recoverProfileIfNeeded(f)
  assert.equal(recovered.recovered, true)
  assert.ok(recovered.previousProfile)
  assert.equal(inspectProfile(recovered.previousProfile).sessions, 0)
})

test('a healthy live profile and newer provider history are preserved', async (t) => {
  const f = await fixture(t)
  await createRecoverySnapshot(f)
  assert.deepEqual(await recoverProfileIfNeeded(f), { recovered: false })
  f.close()
  await writeFile(f.codex, 'newer provider transcript')
  await rm(f.profile, { recursive: true })
  await recoverProfileIfNeeded(f)
  assert.equal(await readFile(f.codex, 'utf8'), 'newer provider transcript')
})

test('empty settings cannot replace a saved settings database', async (t) => {
  const f = await fixture(t)
  await createRecoverySnapshot(f)
  f.settings.exec('DELETE FROM profile_state_documents')
  await assert.rejects(createRecoverySnapshot(f), /Saved settings were replaced/)
  f.close()
  const restored = await recoverProfileIfNeeded(f)
  assert.equal(restored.summary.documents['local-default'], 2)
})

test('recovery refuses to replace state owned by a running process', async (t) => {
  const f = await fixture(t)
  await writeFile(path.join(f.profile, 'orca-runtime.json'), JSON.stringify({ pid: process.pid }))
  await createRecoverySnapshot(f)
  f.close()
  await rm(f.profile, { recursive: true })
  await assert.rejects(recoverProfileIfNeeded(f), /Quit the existing Orca process/)
  await assert.rejects(access(f.profile))
})

test('if no backup verifies, damaged live files remain untouched', async (t) => {
  const f = await fixture(t)
  const saved = await createRecoverySnapshot(f)
  f.close()
  await writeFile(path.join(saved.directory, 'profile', 'agent-session-journal.db'), 'bad backup')
  const live = path.join(f.profile, 'agent-session-journal.db')
  await writeFile(live, 'bad live data')
  await assert.rejects(recoverProfileIfNeeded(f), /No recovery copy passed/)
  assert.equal(await readFile(live, 'utf8'), 'bad live data')
})

test('generations cannot restore files outside their own directory', async (t) => {
  const f = await fixture(t)
  const saved = await createRecoverySnapshot(f)
  saved.manifest.files['../outside'] = { sha256: 'bad', size: 0 }
  await assert.rejects(validateGeneration(saved, f.profile), /Unsafe recovery path/)
})

test('retention keeps recent generations and seven daily recovery points', () => {
  const items = Array.from({ length: 20 }, (_, i) => ({
    directory: String(i),
    manifest: { createdAt: Date.UTC(2026, 9, 16) - i * 86400000 }
  }))
  const retained = retainedGenerations(items, 3, 7)
  assert.equal(retained.size, 7)
  assert.ok(retained.has('0') && retained.has('6') && !retained.has('7'))
})

test('watcher takes a final backup and releases its lock after Orca exits', async (t) => {
  const f = await fixture(t)
  let snapshots = 0
  await runRecoveryWatch({
    ...f,
    intervalMs: 10000,
    pollMs: 5,
    shutdownGraceMs: 15,
    snapshot: async () => {
      snapshots++
    }
  })
  assert.equal(snapshots, 2)
  await assert.rejects(access(path.join(f.recovery, '.watch-lock')))
})

test('watcher repeats snapshots on its configured interval', async (t) => {
  const f = await fixture(t)
  let snapshots = 0
  await runRecoveryWatch({
    ...f,
    intervalMs: 10,
    pollMs: 5,
    shutdownGraceMs: 25,
    snapshot: async () => {
      snapshots++
    }
  })
  assert.ok(snapshots >= 3)
})

test('the live profile cannot contain its own recovery copies', async (t) => {
  const f = await fixture(t)
  await assert.rejects(
    createRecoverySnapshot({ ...f, recovery: f.profile }),
    /outside the live profile/
  )
  await assert.rejects(
    createRecoverySnapshot({ ...f, recovery: path.join(f.profile, 'backups') }),
    /outside the live profile/
  )
})

test('a second watcher leaves the existing watcher in charge', async (t) => {
  const f = await fixture(t)
  const lock = path.join(f.recovery, '.watch-lock')
  await mkdir(lock, { recursive: true })
  await writeFile(
    path.join(lock, 'owner.json'),
    JSON.stringify({ pid: process.pid, token: 'owner' })
  )
  const result = await runRecoveryWatch(f)
  assert.equal(result.alreadyRunning, true)
  assert.equal((await readJson(path.join(lock, 'owner.json'))).token, 'owner')
})

test('the detached backup helper never starts an Electron instance', async (t) => {
  const f = await fixture(t)
  let spec
  let detached = false
  const pid = startRecoveryWatcher({
    ...f,
    repoRoot: f.root,
    spawnProcess: (input) => {
      spec = input
      return {
        pid: 123,
        on: () => {},
        unref: () => {
          detached = true
        }
      }
    }
  })
  assert.equal(pid, 123)
  assert.equal(spec.program, process.execPath)
  assert.equal(spec.detached, true)
  assert.ok(spec.args[0].endsWith('local-fork-recovery-watch.mjs'))
  assert.equal(detached, true)
})
