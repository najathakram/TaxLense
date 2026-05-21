-- Add override columns to LedgerFinding so the CPA can pick an alternative
-- to the AI's proposed action (or supply a free-text instruction) without
-- losing the original proposal.
--
-- acceptedOption  : human label of the chosen alternative (or NULL = AI's default)
-- overrideAction  : modified ProposedAction JSON (NULL = use proposedAction as-is)
-- userInstruction : free text from the "Other..." dialog (NULL = no custom note)
--
-- All three default to NULL. Existing rows are unaffected; the apply path falls
-- back to proposedAction when overrideAction is null.

ALTER TABLE "LedgerFinding" ADD COLUMN "acceptedOption" TEXT;
ALTER TABLE "LedgerFinding" ADD COLUMN "overrideAction" JSONB;
ALTER TABLE "LedgerFinding" ADD COLUMN "userInstruction" TEXT;
