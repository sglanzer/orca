import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileDigest, snapshotFile } from './without-openclaw-recovery-files.mjs'

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'orca-backup-link-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = path.join(root, 'live.json')
  const previous = path.join(root, 'previous.json')
  const target = path.join(root, 'next', 'copy.json')
  await writeFile(source, '{"saved":"conversation"}\n')
  await writeFile(previous, await readFile(source))
  return { source, previous, target }
}

for (const code of ['EPERM', 'EACCES', 'EXDEV', 'ENOTSUP', 'EOPNOTSUPP', 'EMLINK', 'ENOSYS']) {
  test(`a ${code} hard-link failure still produces an independent verified backup`, async (t) => {
    const f = await fixture(t)
    const sha256 = await fileDigest(f.source)
    const result = await snapshotFile(
      f.source,
      f.target,
      { file: f.previous, sha256 },
      async () => {
        throw Object.assign(new Error('hard links unavailable'), { code })
      }
    )
    assert.equal(result.sha256, sha256)
    assert.deepEqual(await readFile(f.target), await readFile(f.source))
    assert.notEqual((await stat(f.target)).ino, (await stat(f.previous)).ino)
    if (process.platform !== 'win32') {
      assert.equal((await stat(f.target)).mode & 0o777, 0o600)
    }
    await writeFile(f.source, 'changed live profile')
    assert.equal(await fileDigest(f.target), sha256)
  })
}

test('unexpected link errors remain visible instead of publishing a backup', async (t) => {
  const f = await fixture(t)
  await assert.rejects(
    snapshotFile(
      f.source,
      f.target,
      { file: f.previous, sha256: await fileDigest(f.source) },
      async () => {
        throw Object.assign(new Error('disk failure'), { code: 'EIO' })
      }
    ),
    { code: 'EIO' }
  )
})

test('changed content copies the current file instead of reusing the previous backup', async (t) => {
  const f = await fixture(t)
  const oldDigest = await fileDigest(f.previous)
  await writeFile(f.source, 'new conversation content')
  await snapshotFile(f.source, f.target, { file: f.previous, sha256: oldDigest }, async () =>
    assert.fail('changed files must be copied')
  )
  assert.equal(await readFile(f.target, 'utf8'), 'new conversation content')
  assert.equal(await fileDigest(f.previous), oldDigest)
})
