-- CreateEnum
CREATE TYPE "ApprovalRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" VARCHAR(120) NOT NULL,
    "description" VARCHAR(2000) NOT NULL,
    "status" "ApprovalRequestStatus" NOT NULL DEFAULT 'PENDING',
    "created_by_user_id" UUID NOT NULL,
    "decided_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),
    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "approval_requests_decision_state_check" CHECK (
      (
        "status" = 'PENDING'
        AND "decided_by_user_id" IS NULL
        AND "decided_at" IS NULL
      )
      OR
      (
        "status" IN ('APPROVED', 'REJECTED')
        AND "decided_by_user_id" IS NOT NULL
        AND "decided_at" IS NOT NULL
      )
    )
);

-- CreateIndex
CREATE INDEX "approval_requests_created_by_user_id_idx"
ON "approval_requests"("created_by_user_id");

-- AddForeignKey
ALTER TABLE "approval_requests"
ADD CONSTRAINT "approval_requests_created_by_user_id_fkey"
FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests"
ADD CONSTRAINT "approval_requests_decided_by_user_id_fkey"
FOREIGN KEY ("decided_by_user_id") REFERENCES "users"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
