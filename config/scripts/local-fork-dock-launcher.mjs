import path from 'node:path'

function quoteShell(value) {
  return `'${value.replaceAll("'", "'" + '\\' + "''")}'`
}

export function createDockLaunchPlan({ repoRoot, nodeExecutable, profile, recovery }) {
  const launcher = path.join(repoRoot, 'config', 'scripts', 'launch-without-openclaw.mjs')
  const logPath = path.join(profile, 'logs', 'source-launcher.log')
  const args = [
    '/usr/bin/nohup',
    '/usr/bin/env',
    '-u',
    'ELECTRON_RUN_AS_NODE',
    `ORCA_DEV_USER_DATA_PATH=${profile}`,
    `ORCA_FORK_RECOVERY_ROOT=${recovery}`,
    nodeExecutable,
    launcher
  ]
  // The Node supervisor must outlive the one-shot Dock app and remain Electron's parent.
  const command = `mkdir -p ${quoteShell(path.dirname(logPath))} && ${args.map(quoteShell).join(' ')} >> ${quoteShell(logPath)} 2>&1 < /dev/null &`
  const appleScript = `do shell script ${JSON.stringify(command)}\n`
  return { command, appleScript, logPath }
}
