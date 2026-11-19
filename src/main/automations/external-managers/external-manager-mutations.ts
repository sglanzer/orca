import type { ExternalAutomationActionInput } from '../../../shared/automations/external/external-automation'
import {
  EXTERNAL_AUTOMATION_SCOPE_CODES,
  ExternalAutomationScopeError
} from '../../../shared/automations/external/external-automation-scope'
import { assertExternalAutomationJobId } from './external-manager-job-id'

export async function runExternalAutomationAction(
  input: ExternalAutomationActionInput
): Promise<void> {
  assertExternalAutomationJobId(input.jobId)
  throw new ExternalAutomationScopeError(EXTERNAL_AUTOMATION_SCOPE_CODES.providerNotAllowed)
}
