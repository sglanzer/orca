import type {
  ExternalAutomationManager,
  ExternalAutomationProvider
} from '../../../shared/automations/external/external-automation'

export function listLocalManager(
  _provider: ExternalAutomationProvider
): Promise<ExternalAutomationManager | null> {
  return Promise.resolve(null)
}
