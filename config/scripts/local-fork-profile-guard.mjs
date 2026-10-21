import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

export function assertPreservedProfile(profile, manifestPath) {
  if (!existsSync(manifestPath)) {
    return
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (path.resolve(manifest.profilePath) !== path.resolve(profile)) {
    return
  }

  const required = [...manifest.requiredFiles]
  const indexPath = path.join(profile, 'orca-profile-index.json')
  if (existsSync(indexPath)) {
    const index = JSON.parse(readFileSync(indexPath, 'utf8'))
    const active = index.activeProfileId
    if (typeof active !== 'string' || active.includes('/') || active.includes('\\')) {
      throw new Error('The saved Orca profile index has an invalid active profile.')
    }
    required.push(path.join('profiles', active, 'profile-state.db'))
  }

  const missing = required.filter((relative) => {
    const file = path.join(profile, relative)
    return !existsSync(file) || !statSync(file).isFile() || statSync(file).size === 0
  })
  if (missing.length) {
    throw new Error(
      `Saved Orca data is missing: ${missing.join(', ')}. ` +
        `Launch stopped before creating an empty profile. Recovery backup: ${manifest.backupPath}`
    )
  }
}
