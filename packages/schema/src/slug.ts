import { z } from "zod";

/** Section 6. Single-character slugs are allowed. Max length is 32. */
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

/** Built-in tools use this slug. Users cannot create a connector with it. */
export const RESERVED_SLUG = "solemcp";

export const slugSchema = z
  .string()
  .regex(SLUG_PATTERN, "invalid slug")
  .refine((slug) => slug !== RESERVED_SLUG, "slug solemcp is reserved");
