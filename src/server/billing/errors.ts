export type BillingProblem =
  /** Lines of the invoice can no longer change. */
  | 'invoice_not_editable'
  | 'invoice_has_payments'
  /** The invoice cannot be paid: it is a draft or closed. */
  | 'invoice_not_payable'
  | 'payment_exceeds_due'
  | 'refund_exceeds_payment'
  | 'amount_not_positive'
  | 'nothing_to_bill'
  | 'client_archived'
  /** The invoice is closed: reopen it first. */
  | 'invoice_closed'
  /** The lines add up to less than was paid, or below 0. */
  | 'total_too_low'

/** A billing rule forbids the action. Nothing was changed. */
export class BillingError extends Error {
  override name = 'BillingError'
  constructor(
    readonly problem: BillingProblem,
    message: string,
  ) {
    super(message)
  }
}

export type ClaimProblemReason =
  | 'not_found'
  | 'duplicate'
  /** Changed since the caller read it. */
  | 'stale'
  | 'already_invoiced'
  | 'not_billable'
  | 'running'
  | 'billed_outside'
  | 'other_client'
  | 'other_currency'
  /** The project bills by the hour, but no rate applies. */
  | 'missing_rate'

export interface ClaimProblem {
  kind: 'time' | 'expense'
  id: number
  reason: ClaimProblemReason
}

/** Entries that cannot be billed. Nothing was billed. */
export class ClaimError extends Error {
  override name = 'ClaimError'
  constructor(readonly problems: ClaimProblem[]) {
    super(`Cannot bill ${problems.map(({ kind, id, reason }) => `${kind} ${id} (${reason})`).join(', ')}.`)
  }
}
