/**
 * Thin HTTP client for the Onfido REST API (v3.6).
 *
 * - Auth header:  `Authorization: Token token=${apiKey}`
 * - Base URL resolved by region via OnfidoConfig.apiBaseUrl
 * - Dev-mode fallback: when the config is not fully set (`!isConfigured`),
 *   every method logs the call and returns deterministic stubs WITHOUT
 *   touching the network.
 */

import { IdentityError, IdentityErrorCode } from './identity-errors.js';
import type { OnfidoConfig } from './onfido-config.js';

export interface OnfidoApplicant     { id: string }
export interface OnfidoSdkToken      { token: string }
export interface OnfidoWorkflowRun   { id: string; status: string; output?: Record<string, unknown> }
export interface OnfidoCheck         { id: string; status: string; result: 'clear' | 'consider' | null }

type FetchFn = typeof globalThis.fetch;

export class OnfidoClient {
  constructor(
    private readonly config: OnfidoConfig,
    private readonly fetchFn: FetchFn = globalThis.fetch,
  ) {}

  // -----------------------------------------------------------------------
  // Internal HTTP helper
  // -----------------------------------------------------------------------
  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const url = `${this.config.apiBaseUrl}${path}`;
    const res = await this.fetchFn(url, {
      method,
      headers: {
        Authorization: `Token token=${this.config.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new IdentityError(
        IdentityErrorCode.ONFIDO_API_ERROR,
        `Onfido ${method} ${path} failed: HTTP ${res.status} ${text}`,
      );
    }
    return (await res.json()) as T;
  }

  // -----------------------------------------------------------------------
  // createApplicant
  // -----------------------------------------------------------------------
  async createApplicant(input: {
    firstName: string;
    lastName: string;
    email?: string;
  }): Promise<OnfidoApplicant> {
    if (!this.config.isConfigured) {
      // eslint-disable-next-line no-console
      console.info('[onfido-client:dev] createApplicant', input);
      return { id: `dev-applicant-${Date.now()}` };
    }
    return this.request<OnfidoApplicant>('POST', '/applicants', {
      first_name: input.firstName,
      last_name:  input.lastName,
      email:      input.email,
    });
  }

  // -----------------------------------------------------------------------
  // createSdkToken — referrer-bound token for browser SDK
  // -----------------------------------------------------------------------
  async createSdkToken(applicantId: string, referrer: string): Promise<OnfidoSdkToken> {
    if (!this.config.isConfigured) {
      // eslint-disable-next-line no-console
      console.info('[onfido-client:dev] createSdkToken', { applicantId, referrer });
      return { token: 'dev-sdk-token' };
    }
    return this.request<OnfidoSdkToken>('POST', '/sdk_token', {
      applicant_id: applicantId,
      referrer,
    });
  }

  // -----------------------------------------------------------------------
  // createWorkflowRun — kick off the pre-configured verification workflow
  // -----------------------------------------------------------------------
  async createWorkflowRun(applicantId: string): Promise<OnfidoWorkflowRun> {
    if (!this.config.isConfigured) {
      // eslint-disable-next-line no-console
      console.info('[onfido-client:dev] createWorkflowRun', { applicantId });
      return { id: `dev-workflow-run-${Date.now()}`, status: 'awaiting_input' };
    }
    return this.request<OnfidoWorkflowRun>('POST', '/workflow_runs', {
      applicant_id: applicantId,
      workflow_id:  this.config.workflowId,
    });
  }

  // -----------------------------------------------------------------------
  // getWorkflowRun — poll for status & output
  // -----------------------------------------------------------------------
  async getWorkflowRun(workflowRunId: string): Promise<OnfidoWorkflowRun> {
    if (!this.config.isConfigured) {
      // eslint-disable-next-line no-console
      console.info('[onfido-client:dev] getWorkflowRun', { workflowRunId });
      return { id: workflowRunId, status: 'approved', output: { dev: true } };
    }
    return this.request<OnfidoWorkflowRun>('GET', `/workflow_runs/${workflowRunId}`);
  }

  // -----------------------------------------------------------------------
  // getCheck
  // -----------------------------------------------------------------------
  async getCheck(checkId: string): Promise<OnfidoCheck> {
    if (!this.config.isConfigured) {
      // eslint-disable-next-line no-console
      console.info('[onfido-client:dev] getCheck', { checkId });
      return { id: checkId, status: 'complete', result: 'clear' };
    }
    return this.request<OnfidoCheck>('GET', `/checks/${checkId}`);
  }
}
