CREATE TABLE "account_invitation_tokens" (
  "user_id" UUID NOT NULL,
  "token_digest" VARCHAR(43) NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "account_invitation_tokens_pkey" PRIMARY KEY ("user_id")
);

CREATE UNIQUE INDEX "account_invitation_tokens_token_digest_key"
  ON "account_invitation_tokens"("token_digest");

ALTER TABLE "account_invitation_tokens"
  ADD CONSTRAINT "account_invitation_tokens_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
