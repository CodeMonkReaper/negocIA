/*
  Warnings:

  - You are about to drop the column `access_token` on the `whatsapp_accounts` table. All the data in the column will be lost.
  - Added the required column `access_token_encrypted` to the `whatsapp_accounts` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "whatsapp_accounts" DROP COLUMN "access_token",
ADD COLUMN     "access_token_encrypted" JSONB NOT NULL;
