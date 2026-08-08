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
  "status" "OutboxMessageStatus" NOT NULL DEFAULT 'PENDING',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMP(3) NOT NULL,
  "claim_token" UUID,
  "claimed_by" VARCHAR(160),
  "claimed_until" TIMESTAMP(3),
  "published_at" TIMESTAMP(3),
  "blocked_at" TIMESTAMP(3),
  "last_error_code" VARCHAR(100),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "outbox_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "outbox_messages_destination_status_next_attempt_at_claimed_until_idx"
  ON "outbox_messages"("destination", "status", "next_attempt_at", "claimed_until");

CREATE INDEX "outbox_messages_status_published_at_idx"
  ON "outbox_messages"("status", "published_at");
