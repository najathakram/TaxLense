-- Adds OWNER_EQUITY to the TransactionCode enum. Sole Prop / SMLLC owner
-- contributions (inflow) and owner draws (outflow). Direction inferred from
-- amountNormalized sign. NOT income, NOT deductible — lands in Balance Sheet
-- Owner's Equity, never on Schedule C.
--
-- Plan: plans/during-the-process-of-radiant-hanrahan.md Part 4.1.

ALTER TYPE "TransactionCode" ADD VALUE 'OWNER_EQUITY';
