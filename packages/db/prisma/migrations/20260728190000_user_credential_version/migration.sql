ALTER TABLE "user_credentials"
ADD COLUMN "credential_version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "user_credentials"
ADD CONSTRAINT "user_credentials_version_check" CHECK ("credential_version" > 0);
