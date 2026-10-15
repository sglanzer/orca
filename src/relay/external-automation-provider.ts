export type ExternalAutomationProvider = 'hermes' | 'openclaw'

export type ExternalAutomationAction = 'pause' | 'resume' | 'run' | 'delete'

export const EXTERNAL_AUTOMATION_JOB_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/

export function externalAutomationProvider(value: unknown): ExternalAutomationProvider {
  if (value === 'openclaw') {
    throw new Error('OpenClaw integration is not included in this build.')
  }
  return 'hermes'
}

export function isExternalAutomationAction(value: unknown): value is ExternalAutomationAction {
  return value === 'pause' || value === 'resume' || value === 'run' || value === 'delete'
}
