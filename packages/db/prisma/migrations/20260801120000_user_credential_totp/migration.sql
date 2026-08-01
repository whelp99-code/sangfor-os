-- Second-factor storage. Additive and nullable: existing credentials keep working
-- with no TOTP factor until their owner enrolls one.
ALTER TABLE "user_credentials"
ADD COLUMN "totp_secret" TEXT,
ADD COLUMN "totp_confirmed_at" TIMESTAMP(3),
ADD COLUMN "totp_last_counter" INTEGER;

-- A confirmed factor must have a secret behind it, and a replay ledger cannot
-- exist for a factor that was never confirmed. Enforced here rather than only in
-- application code so a partial write cannot leave a factor that verifies against
-- nothing.
ALTER TABLE "user_credentials"
ADD CONSTRAINT "user_credentials_totp_confirmed_requires_secret"
CHECK ("totp_confirmed_at" IS NULL OR "totp_secret" IS NOT NULL);

ALTER TABLE "user_credentials"
ADD CONSTRAINT "user_credentials_totp_counter_requires_confirmation"
CHECK ("totp_last_counter" IS NULL OR "totp_confirmed_at" IS NOT NULL);
