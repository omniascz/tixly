export interface AntiScalperCheck {
  passed: boolean;
  reason?: string;
}

const TEMP_MAIL_DOMAINS = [
  'mailinator.com',
  'guerrillamail.com',
  'throwaway.email',
  'tempmail.com',
  'yopmail.com',
];

export function checkAntiScalperRules(
  userId: string,
  email: string,
  existingRegistrations: number,
  options?: { ipAddress?: string; checkVpn?: (ip: string) => boolean },
): AntiScalperCheck {
  // Rule 1: max 1 registration per userId per event
  if (existingRegistrations > 0) {
    return { passed: false, reason: 'USER_ALREADY_REGISTERED' };
  }

  // Rule 2: email domain blacklist (temp mail providers)
  const emailDomain = email.split('@')[1]?.toLowerCase();
  if (emailDomain && TEMP_MAIL_DOMAINS.includes(emailDomain)) {
    return { passed: false, reason: 'TEMP_MAIL_DOMAIN' };
  }

  // Rule 3: VPN/datacenter IP check (injectable)
  if (options?.ipAddress && options?.checkVpn) {
    if (options.checkVpn(options.ipAddress)) {
      return { passed: false, reason: 'VPN_OR_DATACENTER_IP' };
    }
  }

  return { passed: true };
}
