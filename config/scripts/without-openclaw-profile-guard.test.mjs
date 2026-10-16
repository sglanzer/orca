import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { assertPreservedProfile } from './without-openclaw-profile-guard.mjs'

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'orca-profile-guard-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const profile = path.join(root, 'profile')
  const manifest = path.join(root, 'manifest.json')
  writeFileSync(
    manifest,
    JSON.stringify({
      profilePath: profile,
      requiredFiles: ['orca-profile-index.json', 'agent-session-journal.db'],
      backupPath: path.join(root, 'backup.tar.gz')
    })
  )
  return { root, profile, manifest }
}

test('a missing restored profile cannot be silently recreated', (t) => {
  const { profile, manifest } = fixture(t)
  assert.throws(() => assertPreservedProfile(profile, manifest), /Launch stopped/)
  assert.equal(existsSync(profile), false)
})

test('an empty replacement cannot hide a missing conversation journal', (t) => {
  const { profile, manifest } = fixture(t)
  mkdirSync(path.join(profile, 'profiles', 'local-default'), { recursive: true })
  writeFileSync(
    path.join(profile, 'orca-profile-index.json'),
    JSON.stringify({
      activeProfileId: 'local-default'
    })
  )
  writeFileSync(path.join(profile, 'profiles', 'local-default', 'profile-state.db'), 'saved')
  assert.throws(() => assertPreservedProfile(profile, manifest), /agent-session-journal.db/)
  writeFileSync(path.join(profile, 'agent-session-journal.db'), 'journal')
  assert.doesNotThrow(() => assertPreservedProfile(profile, manifest))
})

test('an explicit isolated profile override remains available', (t) => {
  const { root, manifest } = fixture(t)
  assert.doesNotThrow(() => assertPreservedProfile(path.join(root, 'isolated'), manifest))
})
