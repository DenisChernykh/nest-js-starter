CREATE TYPE "OutboxMessageStatus" AS ENUM ('PENDING', 'CLAIMED', 'PUBLISHED', 'BLOCKED');

CREATE TABLE "outbox_messages" (
  "id" UUID NOT NULL,
  "destination" VARCHAR(100) NOT NULL,
  "type" VARCHAR(120) NOT NULL,
  "version" INTEGER NOT NULL,
  "partition_key" VARCHAR(200),
  "correlation_id" VARCHAR(200),
  "occurred_at" TIMESTAMP(3) NOT NULL,
  "payload" JSONB NOT NULL,
  "payload_size_bytes" INTEGER NOT NULL,
  "status" "OutboxMessageStatus" NOT NULL DEFAULT 'PENDING',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claim_token" UUID,
  "claimed_by" VARCHAR(160),
  "claimed_until" TIMESTAMP(3),
  "published_at" TIMESTAMP(3),
  "blocked_at" TIMESTAMP(3),
  "last_error_code" VARCHAR(100),
  "redrive_published" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "outbox_messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "outbox_messages_version_positive" CHECK ("version" > 0),
  CONSTRAINT "outbox_messages_attempt_count_nonnegative" CHECK ("attempt_count" >= 0),
  CONSTRAINT "outbox_messages_payload_contract" CHECK (
    jsonb_typeof("payload") = 'object'
    AND "payload_size_bytes" BETWEEN 2 AND 65536
  ),
  CONSTRAINT "outbox_messages_safe_error_code" CHECK (
    "last_error_code" IS NULL
    OR "last_error_code" ~ '^[A-Z][A-Z0-9_]{0,99}$'
  ),
  CONSTRAINT "outbox_messages_redrive_state" CHECK (
    NOT "redrive_published" OR "status" IN ('PENDING', 'CLAIMED')
  ),
  CONSTRAINT "outbox_messages_state_consistency" CHECK (
    (
      "status" = 'PENDING'
      AND "claim_token" IS NULL
      AND "claimed_by" IS NULL
      AND "claimed_until" IS NULL
      AND "published_at" IS NULL
      AND "blocked_at" IS NULL
    ) OR (
      "status" = 'CLAIMED'
      AND "claim_token" IS NOT NULL
      AND "claimed_by" IS NOT NULL
      AND "claimed_until" IS NOT NULL
      AND "published_at" IS NULL
      AND "blocked_at" IS NULL
    ) OR (
      "status" = 'PUBLISHED'
      AND "claim_token" IS NULL
      AND "claimed_by" IS NULL
      AND "claimed_until" IS NULL
      AND "published_at" IS NOT NULL
      AND "blocked_at" IS NULL
      AND "last_error_code" IS NULL
      AND NOT "redrive_published"
    ) OR (
      "status" = 'BLOCKED'
      AND "claim_token" IS NULL
      AND "claimed_by" IS NULL
      AND "claimed_until" IS NULL
      AND "published_at" IS NULL
      AND "blocked_at" IS NOT NULL
      AND "last_error_code" IS NOT NULL
      AND NOT "redrive_published"
    )
  )
);

CREATE INDEX "outbox_messages_destination_status_next_attempt_at_claimed_until_idx"
  ON "outbox_messages"("destination", "status", "next_attempt_at", "claimed_until");

CREATE INDEX "outbox_messages_status_published_at_idx"
  ON "outbox_messages"("status", "published_at");
