import crypto from 'crypto';
import type {
  ZapierAction,
  ActionInput,
  ServiceDeps,
} from '../types/zapier.types.js';
import { ZapierError } from '../types/zapier.types.js';

function generateId(): string {
  return crypto.randomUUID();
}

export async function createAction(
  input: ActionInput,
  deps: ServiceDeps,
): Promise<ZapierAction> {
  const id = generateId();
  const now = new Date();

  await deps.db.execute(
    `INSERT INTO zapier_actions (id, organizer_id, action_type, config, is_active, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, input.organizerId, input.actionType, JSON.stringify(input.config), true, now],
  );

  return {
    id,
    organizerId: input.organizerId,
    actionType: input.actionType,
    config: input.config,
    isActive: true,
    createdAt: now,
  };
}

export async function getAction(
  actionId: string,
  deps: ServiceDeps,
): Promise<ZapierAction> {
  const rows = await deps.db.query<ZapierAction>(
    `SELECT * FROM zapier_actions WHERE id = $1`,
    [actionId],
  );

  if (rows.length === 0) {
    throw new ZapierError('ACTION_NOT_FOUND', `Action ${actionId} not found`);
  }

  return rows[0] as ZapierAction;
}

export async function executeAction(
  actionId: string,
  triggerData: Record<string, unknown>,
  deps: ServiceDeps,
): Promise<{ success: boolean; message: string }> {
  const action = await getAction(actionId, deps);

  switch (action.actionType) {
    case 'createContact': {
      if (!action.config['listId']) {
        throw new ZapierError('INVALID_ACTION_CONFIG', 'createContact action requires listId in config');
      }
      console.log(`[createContact] listId=${String(action.config['listId'])}, data=`, triggerData);
      return { success: true, message: `Contact creation queued for list ${String(action.config['listId'])}` };
    }

    case 'sendSlackNotification': {
      if (!action.config['webhookUrl']) {
        throw new ZapierError('INVALID_ACTION_CONFIG', 'sendSlackNotification action requires webhookUrl in config');
      }
      console.log(`[sendSlackNotification] webhookUrl=${String(action.config['webhookUrl'])}, data=`, triggerData);
      return { success: true, message: 'Slack notification queued' };
    }

    case 'addToGoogleSheets': {
      if (!action.config['spreadsheetId'] || !action.config['sheetName']) {
        throw new ZapierError(
          'INVALID_ACTION_CONFIG',
          'addToGoogleSheets action requires spreadsheetId and sheetName in config',
        );
      }
      console.log(
        `[addToGoogleSheets] spreadsheetId=${String(action.config['spreadsheetId'])}, sheetName=${String(action.config['sheetName'])}, data=`,
        triggerData,
      );
      return {
        success: true,
        message: `Row queued for sheet ${String(action.config['sheetName'])} in ${String(action.config['spreadsheetId'])}`,
      };
    }

    default: {
      const _exhaustive: never = action.actionType;
      throw new ZapierError('INVALID_ACTION_CONFIG', `Unknown action type: ${String(_exhaustive)}`);
    }
  }
}

export function validateZapierRequest(
  payload: string,
  signature: string,
  secret: string,
): void {
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  const actualBuf = Buffer.from(signature, 'hex');

  if (expectedBuf.length !== actualBuf.length || !crypto.timingSafeEqual(expectedBuf, actualBuf)) {
    throw new ZapierError('INVALID_SIGNATURE', 'Request signature does not match');
  }
}
