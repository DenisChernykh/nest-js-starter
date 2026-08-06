-- Add verification state without changing the administrative account status.
ALTER TABLE "users"
ADD COLUMN "email_verified_at" TIMESTAMP(3);

UPDATE "users"
SET "email_verified_at" = "created_at"
WHERE "email_verified_at" IS NULL;

CREATE TABLE "email_verification_tokens" (
    "user_id" UUID NOT NULL,
    "token_digest" VARCHAR(43) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("user_id")
);

CREATE TABLE "password_reset_tokens" (
    "user_id" UUID NOT NULL,
    "token_digest" VARCHAR(43) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("user_id")
);

CREATE UNIQUE INDEX "email_verification_tokens_token_digest_key"
ON "email_verification_tokens"("token_digest");

CREATE UNIQUE INDEX "password_reset_tokens_token_digest_key"
ON "password_reset_tokens"("token_digest");

ALTER TABLE "email_verification_tokens"
ADD CONSTRAINT "email_verification_tokens_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "password_reset_tokens"
ADD CONSTRAINT "password_reset_tokens_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
