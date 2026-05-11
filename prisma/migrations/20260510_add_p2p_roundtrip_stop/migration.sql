-- P2P_ROUNDTRIP — same counterparty appears on both sides of the ledger
-- (inflows from person X AND outflows to person X). Pre-fix, the agent
-- classified each side independently (inflow → NEEDS_CONTEXT $0,
-- outflow → Contract Labor 100% deduct) creating an asymmetric "best of
-- both worlds" pattern. Atif had ~$3.3K of Pocketsflow-payouts to Kirsten
-- Hatch / Shawna LeCompte coded as Contract Labor while the inflows from
-- those same people were hidden. This category materializes one STOP per
-- counterparty so the CPA can resolve the relationship in one decision.

ALTER TYPE "StopCategory" ADD VALUE 'P2P_ROUNDTRIP';
