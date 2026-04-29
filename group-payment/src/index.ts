// Public API exports for group-payment module

export {
  createGroupPayment,
  addMember,
  inviteMember,
  acceptInvite,
  calculateSplits,
  recordMemberPayment,
  finalizeGroupPayment,
  getGroupPaymentStatus,
  settlementReport,
} from './services/group-payment.service';

export type {
  GroupPayment,
  GroupMember,
  GroupPaymentInvite,
  CreateGroupPaymentOptions,
  AddMemberOptions,
  InviteMemberOptions,
  AcceptInviteOptions,
  RecordMemberPaymentOptions,
  SettlementEntry,
  SettlementReport,
  GroupPaymentResponse,
  CalculateSplitsResult,
  DbAdapter,
  EmailServiceAdapter,
  GroupPaymentStatus,
  GroupMemberStatus,
  GroupPaymentStrategy,
} from './lib/types';

export {
  GroupPaymentNotFoundError,
  GroupPaymentInviteExpiredError,
  GroupPaymentInviteNotFoundError,
  InvalidGroupPaymentStrategyError,
  GroupPaymentStatusError,
  DuplicateGroupMemberError,
  UnauthorizedGroupPaymentError,
} from './lib/types';
