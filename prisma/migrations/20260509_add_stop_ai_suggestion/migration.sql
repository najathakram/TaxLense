-- Add aiSuggestion field to StopItem so the AI's default radio choice is
-- persisted (rather than re-derived from the linked MerchantRule on every
-- render). Required for TRANSFER and DEPOSIT stops which don't carry a
-- MerchantRule and therefore had no derivation source.
ALTER TABLE "StopItem" ADD COLUMN "aiSuggestion" JSONB;
