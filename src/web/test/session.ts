import type { SessionInfo, SessionPerson } from '../../shared/api'

export const person: SessionPerson = {
  id: 7, name: 'Casey Example', email: 'casey@jet.example', status: 'active', role: { key: 'member', name: 'Member' },
  administrator: false, timeZone: 'America/Chicago', photoId: null,
}

export const administrator: SessionPerson = {
  ...person, id: 1, name: 'Avery Example', email: 'avery@jet.example', role: { key: 'administrator', name: 'Administrator' },
  administrator: true,
}

/** What the server says about the session: signed out, unless told otherwise. */
export function sessionInfo(more: Partial<SessionInfo> = {}): SessionInfo {
  return {
    company: { name: 'JET Engineering', timeZone: 'America/Chicago' },
    person: null, csrfToken: more.person ? `token of ${more.person.id}` : null, signUpOpen: !more.person, emailDelivers: false,
    demoAccounts: [], ...more,
  }
}
