import type { SessionInfo, SessionPerson } from '../../shared/api'
import type { Formats } from '../../shared/work'
import { everything } from '../../shared/permissions'

export const person: SessionPerson = {
  id: 7, name: 'Casey Example', email: 'casey@jet.example', status: 'active', role: { key: 'member', name: 'Member' },
  administrator: false, permissions: {}, access: 'member', timeZone: 'America/Chicago', photoId: null,
}

export const administrator: SessionPerson = {
  ...person, id: 1, name: 'Avery Example', email: 'avery@jet.example', role: { key: 'administrator', name: 'Administrator' },
  administrator: true, permissions: everything(), access: 'administrator',
}

export const formats: Formats = {
  currency: 'USD', weekStartsOn: 6, dateFormat: 'mdy', numberFormat: '1,234.56', currencyPlacement: 'symbol_before', hourFormat: 'decimal', timeMode: 'duration',
  modules: { expenses: true, invoices: true, estimates: true, timeOff: true, scheduling: true, approval: true },
}

/** What the server says about the session: signed out, unless told otherwise. */
export function sessionInfo(more: Partial<SessionInfo> = {}): SessionInfo {
  return {
    company: { name: 'JET Engineering', timeZone: 'America/Chicago', weekStartsOn: 6, formats },
    person: null, csrfToken: more.person ? `token of ${more.person.id}` : null, signUpOpen: !more.person, emailDelivers: false,
    demoAccounts: [], ...more,
  }
}
