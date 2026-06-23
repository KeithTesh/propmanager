// web/src/lib/roles.ts
// Utility for displaying role labels based on account type.
// No DB changes — owner role displays differently based on company.accountType.

export function getRoleLabel(role: string, accountType?: string): string {
  // Agent account: owner displays as "Agent"
  if (role === 'owner' && accountType === 'agent') return 'Agent';

  const labels: Record<string, string> = {
    owner:          'Owner',
    manager:        'Manager',
    accountant:     'Accountant',
    caretaker:      'Caretaker',
    tenant:         'Tenant',
    landlord_client:'Landlord',
    super_admin:    'Super Admin',
  };

  return labels[role] ?? role.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function getAccountTypeLabel(accountType?: string): string {
  if (accountType === 'agent') return 'Agent Account';
  return 'Landlord Account';
}

export function getAccountTypeBadge(accountType?: string): { label: string; bg: string; text: string } {
  if (accountType === 'agent') {
    return { label: '🏢 Agent', bg: 'bg-purple-50', text: 'text-purple-700' };
  }
  return { label: '🏠 Landlord', bg: 'bg-teal-50', text: 'text-teal-700' };
}