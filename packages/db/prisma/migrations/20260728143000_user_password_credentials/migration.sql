CREATE TABLE "user_credentials" (
    "user_id" TEXT NOT NULL,
    "password_digest" TEXT NOT NULL,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "last_authenticated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_credentials_pkey" PRIMARY KEY ("user_id"),
    CONSTRAINT "user_credentials_failed_attempts_check" CHECK ("failed_attempts" >= 0 AND "failed_attempts" <= 5),
    CONSTRAINT "user_credentials_password_digest_check" CHECK ("password_digest" LIKE '$scrypt$v1$%')
);

ALTER TABLE "user_credentials"
  ADD CONSTRAINT "user_credentials_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

REVOKE ALL ON TABLE "user_credentials" FROM PUBLIC;
