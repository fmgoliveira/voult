export type PromptRequest =
  | {
      kind: 'create';
      host: string;
      rpId: string;
      rpName: string;
      userName: string;
      candidates: { id: string; title: string; username: string }[];
    }
  | {
      kind: 'get';
      host: string;
      rpId: string;
      options: {
        itemId: string;
        credentialId: string;
        title: string;
        userName: string;
        createdAt: number;
      }[];
    };

export type PromptDecision =
  | { action: 'create-new' }
  | { action: 'attach'; itemId: string }
  | { action: 'use'; itemId: string; credentialId: string }
  | { action: 'fallback' }
  | { action: 'cancel' };

/** From the in-page unlock frame (an extension page). */
export type UnlockMessage =
  | { type: 'unlock:close' }
  /** Does a PIN exist? */
  | { type: 'unlock:status' }
  | { type: 'unlock:pin'; pin: string }
  | { type: 'unlock:password'; password: string };

export type UnlockResult =
  { ok: true } | { ok: false; attemptsLeft: number } | { ok: false; error: string };

export type PromptMessage =
  | { type: 'prompt:get'; id: string }
  | { type: 'prompt:decide'; id: string; decision: PromptDecision }
  /** From the page's backdrop (content script): the user clicked outside the prompt. */
  | { type: 'prompt:dismiss'; id: string };
