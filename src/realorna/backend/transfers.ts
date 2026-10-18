import type { TransferDetails } from "../account-types";
import { ApiError } from "./http";
export function transferDetails(): TransferDetails {
  const bank = process.env.TRANSFER_BANK_NAME?.trim();
  const number = process.env.TRANSFER_ACCOUNT_NUMBER?.trim();
  const holder = process.env.TRANSFER_ACCOUNT_HOLDER?.trim();
  if (!bank || !number || !holder) throw new ApiError("transfer_unconfigured", 503);
  return { bank, number, holder, note: process.env.TRANSFER_NOTE?.trim() || "" };
}
