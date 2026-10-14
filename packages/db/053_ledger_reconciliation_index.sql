-- Reconciliation holds the organization's billing lock. Read only its journal
-- history, not the entire fleet's ledger; financial facts and RLS are unchanged.
CREATE INDEX ledger_tenant_journal ON ledger(organization_id,journal_id)
  INCLUDE (account,amount_micro_usd);
