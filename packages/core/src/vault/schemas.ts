import { z } from 'zod';

export const urlRuleSchema = z.object({
  url: z.string(),
  /** domain = same registrable domain (PSL), host = exact host, regex = pattern, never = never fill. */
  match: z.enum(['domain', 'host', 'regex', 'never']).default('domain'),
});

export const totpSchema = z.object({
  kind: z.enum(['totp', 'hotp']).default('totp'),
  secret: z.string().min(1),
  algorithm: z.enum(['SHA1', 'SHA256', 'SHA512']).default('SHA1'),
  digits: z.union([z.literal(6), z.literal(7), z.literal(8)]).default(6),
  period: z.union([z.literal(15), z.literal(30), z.literal(60)]).default(30),
  counter: z.number().int().nonnegative().default(0),
  issuer: z.string().default(''),
  account: z.string().default(''),
});
export type Totp = z.infer<typeof totpSchema>;

export const customFieldSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), name: z.string(), value: z.string() }),
  z.object({ type: z.literal('hidden'), name: z.string(), value: z.string() }),
  z.object({ type: z.literal('totp'), name: z.string(), value: totpSchema }),
]);

export const passkeySchema = z.object({
  credentialId: z.string(),
  rpId: z.string(),
  rpName: z.string().default(''),
  userHandle: z.string(),
  userName: z.string().default(''),
  /** ES256 (P-256) private key: raw 32-byte scalar, base64url. */
  privateKey: z.string(),
  signCount: z.number().int().nonnegative(),
  createdAt: z.number().int(),
});
export type Passkey = z.infer<typeof passkeySchema>;

export const passwordVersionSchema = z.object({
  password: z.string(),
  changedAt: z.number().int(),
});
export const PASSWORD_HISTORY_LIMIT = 10;

const base = {
  title: z.string(),
  notes: z.string().default(''),
  favorite: z.boolean().default(false),
  pinned: z.boolean().default(false),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
};

export const loginSchema = z.object({
  ...base,
  type: z.literal('login'),
  username: z.string().default(''),
  email: z.string().default(''),
  password: z.string().default(''),
  urls: z.array(urlRuleSchema).default([]),
  totp: totpSchema.optional(),
  customFields: z.array(customFieldSchema).default([]),
  passkeys: z.array(passkeySchema).default([]),
  passwordHistory: z.array(passwordVersionSchema).default([]),
});

export const noteSchema = z.object({ ...base, type: z.literal('note') });

export const cardSchema = z.object({
  ...base,
  type: z.literal('card'),
  holder: z.string().default(''),
  number: z.string().default(''),
  expiry: z.string().default(''),
  cvv: z.string().default(''),
  pin: z.string().default(''),
});

export const identitySchema = z.object({
  ...base,
  type: z.literal('identity'),
  fullName: z.string().default(''),
  email: z.string().default(''),
  phone: z.string().default(''),
  address: z.string().default(''),
  birthday: z.string().default(''),
  customFields: z.array(customFieldSchema).default([]),
});

/** Standalone 2FA entry. */
export const totpItemSchema = z.object({
  ...base,
  type: z.literal('totp'),
  totp: totpSchema,
});

export const itemSchema = z.discriminatedUnion('type', [
  loginSchema,
  noteSchema,
  cardSchema,
  identitySchema,
  totpItemSchema,
]);
export type Item = z.infer<typeof itemSchema>;
export type LoginItem = z.infer<typeof loginSchema>;
export type ItemType = Item['type'];

export const vaultMetaSchema = z.object({
  name: z.string(),
  colour: z.string().default('#4f46e5'),
  icon: z.string().default('lock'),
});
export type VaultMeta = z.infer<typeof vaultMetaSchema>;
