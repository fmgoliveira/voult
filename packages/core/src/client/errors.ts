/** The server rejected our credentials for good (device revoked, refresh token reuse). */
export class SignedOutError extends Error {
  constructor() {
    super('signed_out');
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly body: unknown,
  ) {
    super(code);
  }
}

export class VaultLockedError extends Error {
  constructor() {
    super('vault_locked');
  }
}

export class WrongPasswordError extends Error {
  constructor() {
    super('wrong_password');
  }
}
