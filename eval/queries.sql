-- TaxLens Quality Index queries (Q01–Q06, Q15, Q20–Q31)
-- Run against the production Postgres for an Atif TY-2025-style baseline.
-- Substitute :atif_year_id with the TaxYear UUID from the bootstrap query
-- (or set via psql -v atif_year_id='<uuid>').
--
-- Convention: every metric query returns a single labelled row so the
-- pnpm eval:atif runner can splice them into the eval JSON without parsing.

-- 0. Bootstrap — fetch Atif's TaxYear ID + ledger size baseline
SELECT 'bootstrap' AS metric,
       ty.id AS atif_year_id,
       u.email,
       (SELECT COUNT(*) FROM "Transaction"
          WHERE "taxYearId"=ty.id AND "isSplit"=false AND "isStale"=false) AS txn_count,
       (SELECT COUNT(*) FROM "Classification" c
          JOIN "Transaction" t ON t.id=c."transactionId"
          WHERE t."taxYearId"=ty.id AND c."isCurrent"=true) AS classified_count
  FROM "TaxYear" ty
  JOIN "BusinessProfile" bp ON bp.id = ty."businessProfileId"
  JOIN "User" u ON u.id = bp."userId"
  WHERE u.email LIKE '%atif%' AND ty.year = 2025
  LIMIT 1;

-- Q01 — Auto-Decision Rate (decisive classifications, source ∈ AI/RULE/AI_AUTO_RESOLVE)
SELECT 'Q01' AS metric,
  100.0 *
  COUNT(c.id) FILTER (WHERE c."source" IN ('AI','RULE','AI_AUTO_RESOLVE')
                       AND c."code" NOT IN ('NEEDS_CONTEXT','PERSONAL'))
  / NULLIF(COUNT(t.id), 0) AS adr_pct
FROM "Transaction" t
LEFT JOIN "Classification" c ON c."transactionId"=t.id AND c."isCurrent"=true
WHERE t."taxYearId" = :'atif_year_id'
  AND t."isSplit"=false AND t."isStale"=false;

-- Q02 — STOP Density (per 1K txns)
SELECT 'Q02' AS metric,
  COUNT(s.id)::float * 1000 /
  (SELECT COUNT(*) FROM "Transaction"
     WHERE "taxYearId"=:'atif_year_id' AND "isSplit"=false AND "isStale"=false)
  AS stops_per_1k
FROM "StopItem" s
WHERE s."taxYearId"=:'atif_year_id' AND s."state"='PENDING';

-- Q03 — STOP-Category Concentration (max share of any single category)
SELECT 'Q03' AS metric,
  COALESCE(MAX(pct), 0) AS max_concentration_pct
FROM (
  SELECT "category", COUNT(*) AS n,
         100.0 * COUNT(*) / NULLIF(SUM(COUNT(*)) OVER (), 0) AS pct
    FROM "StopItem"
    WHERE "taxYearId"=:'atif_year_id' AND "state"='PENDING'
    GROUP BY "category"
) sub;

-- Q04 — Threshold-Cliff STOPs (confidence in 0.60-0.70 — was 0.78 pre-fix)
SELECT 'Q04' AS metric, COUNT(*) AS cliff_stops
FROM "StopItem"
WHERE "taxYearId"=:'atif_year_id' AND "state"='PENDING'
  AND ("aiSuggestion"->>'confidence')::float BETWEEN 0.60 AND 0.70;

-- Q05 — Suggestion Coverage (% of PENDING stops with non-null aiSuggestion)
SELECT 'Q05' AS metric,
  100.0 * COUNT(*) FILTER (WHERE "aiSuggestion" IS NOT NULL) / NULLIF(COUNT(*), 0)
  AS suggestion_coverage_pct
FROM "StopItem"
WHERE "taxYearId"=:'atif_year_id' AND "state"='PENDING';

-- Q06 — Suggestion Confidence Distribution (median + p10)
SELECT 'Q06' AS metric,
  percentile_cont(0.50) WITHIN GROUP (ORDER BY ("aiSuggestion"->>'confidence')::float) AS p50,
  percentile_cont(0.10) WITHIN GROUP (ORDER BY ("aiSuggestion"->>'confidence')::float) AS p10
FROM "StopItem"
WHERE "taxYearId"=:'atif_year_id' AND "state"='PENDING' AND "aiSuggestion" IS NOT NULL;

-- Q15 — [VERIFY] Leak Rate
SELECT 'Q15' AS metric,
  100.0 * COUNT(*) FILTER (WHERE 'VERIFY' = ANY(c."ircCitations"))
  / NULLIF(COUNT(*), 0) AS verify_leak_pct
FROM "Classification" c
JOIN "Transaction" t ON t.id=c."transactionId"
WHERE t."taxYearId"=:'atif_year_id' AND c."isCurrent"=true;

-- Q20 — Append-Only Integrity (Classification must have no @updatedAt column)
SELECT 'Q20' AS metric, COUNT(*) AS forbidden_columns
FROM information_schema.columns
WHERE table_name='Classification' AND column_name IN ('updatedAt','updated_at');

-- Q22 — Transfer Pairing Rate
SELECT 'Q22' AS metric,
  100.0 *
  COUNT(*) FILTER (WHERE t."isTransferPairedWith" IS NOT NULL)
  / NULLIF(COUNT(*) FILTER (WHERE c."code"='TRANSFER'), 0) AS transfer_pairing_pct
FROM "Transaction" t
JOIN "Classification" c ON c."transactionId"=t.id AND c."isCurrent"=true
WHERE t."taxYearId"=:'atif_year_id';

-- Q23 — Card-Payment Pairing Rate
SELECT 'Q23' AS metric,
  100.0 *
  COUNT(*) FILTER (WHERE t."isPaymentPairedWith" IS NOT NULL)
  / NULLIF(COUNT(*) FILTER (WHERE c."code"='PAYMENT'), 0) AS payment_pairing_pct
FROM "Transaction" t
JOIN "Classification" c ON c."transactionId"=t.id AND c."isCurrent"=true
WHERE t."taxYearId"=:'atif_year_id';

-- Q24 — Split-Parent Leakage (children sum should equal parent amount)
SELECT 'Q24' AS metric, COUNT(*) AS leaked_splits
FROM (
  SELECT p.id
    FROM "Transaction" p
    JOIN "Transaction" c ON c."splitOfId"=p.id
    WHERE p."taxYearId"=:'atif_year_id' AND p."isSplit"=true
    GROUP BY p.id, p."amountNormalized"
    HAVING ABS(p."amountNormalized" - SUM(c."amountNormalized")) > 0.01
) leaks;

-- Q25 — Out-of-Year Leakage
SELECT 'Q25' AS metric, COUNT(*) AS oo_year_leaks
FROM "Transaction"
WHERE "taxYearId"=:'atif_year_id'
  AND ("postedDate" < '2025-01-01' OR "postedDate" > '2025-12-31')
  AND "isStale"=false;

-- Q26 — Idempotency Collisions
SELECT 'Q26' AS metric,
  COUNT(*) - COUNT(DISTINCT "idempotencyKey") AS collisions
FROM "Transaction" WHERE "taxYearId"=:'atif_year_id';

-- Q28 — Schedule C Tie-Out (per-line totals — manually compare to XLSX)
SELECT 'Q28' AS metric, c."scheduleCLine",
       SUM(t."amountNormalized" * CASE WHEN c."code"='MEALS_50' THEN 0.5 ELSE 1.0 END
                                  * c."businessPct" / 100.0) AS sql_total
  FROM "Transaction" t
  JOIN "Classification" c ON c."transactionId"=t.id AND c."isCurrent"=true
  WHERE t."taxYearId"=:'atif_year_id' AND t."isSplit"=false AND t."isStale"=false
    AND c."businessPct" > 0 AND c."scheduleCLine" IS NOT NULL
  GROUP BY c."scheduleCLine" ORDER BY c."scheduleCLine";

-- Q31 — Income-Reconciliation breakdown (aux: provides components, not the
-- variance — that requires the 1099 totals from outside the system)
SELECT 'Q31' AS metric,
  SUM(CASE WHEN c."code"='BIZ_INCOME' AND t."amountNormalized" < 0
           AND t."isTransferPairedWith" IS NULL
           THEN ABS(t."amountNormalized") ELSE 0 END) AS biz_income_total,
  SUM(CASE WHEN c."code"='TRANSFER' AND t."amountNormalized" < 0
           THEN ABS(t."amountNormalized") ELSE 0 END) AS inflow_transfers_total,
  SUM(CASE WHEN c."code"='NEEDS_CONTEXT' AND t."amountNormalized" < 0
           AND t."isTransferPairedWith" IS NULL
           THEN ABS(t."amountNormalized") ELSE 0 END) AS unclassified_inflow_total
  FROM "Transaction" t
  JOIN "Classification" c ON c."transactionId"=t.id AND c."isCurrent"=true
  WHERE t."taxYearId"=:'atif_year_id' AND t."isSplit"=false AND t."isStale"=false;

-- BONUS — STOP breakdown by category (for Q03 detail)
SELECT 'stop_breakdown' AS metric,
       "category", COUNT(*) AS n
  FROM "StopItem"
  WHERE "taxYearId"=:'atif_year_id' AND "state"='PENDING'
  GROUP BY "category" ORDER BY n DESC;

-- BONUS — Code distribution across LIVE classifications
SELECT 'code_distribution' AS metric,
       c."code", COUNT(*) AS n,
       100.0 * COUNT(*) / SUM(COUNT(*)) OVER () AS pct
  FROM "Classification" c
  JOIN "Transaction" t ON t.id=c."transactionId"
  WHERE t."taxYearId"=:'atif_year_id' AND c."isCurrent"=true
    AND t."isSplit"=false AND t."isStale"=false
  GROUP BY c."code" ORDER BY n DESC;
