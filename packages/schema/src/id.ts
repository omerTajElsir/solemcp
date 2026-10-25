import { isValid, ulid } from "ulid";
import { z } from "zod";

/** ULID string. `newId` and this check both use the `ulid` package. */
export const ulidSchema = z.string().refine(isValid, "expected ULID");

export function newId(): string {
  return ulid();
}
