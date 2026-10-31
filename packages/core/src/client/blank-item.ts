import type { Item, ItemType } from '../vault/schemas';

/** An empty item of the given type, ready to be edited in a form. */
export function blankItem(type: ItemType): Item {
  const now = Date.now();
  const base = {
    title: '',
    notes: '',
    favorite: false,
    pinned: false,
    createdAt: now,
    updatedAt: now,
  };
  switch (type) {
    case 'login':
      return {
        ...base,
        type,
        username: '',
        email: '',
        password: '',
        urls: [],
        customFields: [],
        passkeys: [],
        passwordHistory: [],
      };
    case 'note':
      return { ...base, type };
    case 'card':
      return { ...base, type, holder: '', number: '', expiry: '', cvv: '', pin: '' };
    case 'identity':
      return {
        ...base,
        type,
        fullName: '',
        email: '',
        phone: '',
        address: '',
        birthday: '',
        customFields: [],
      };
    case 'totp':
      return {
        ...base,
        type,
        totp: {
          kind: 'totp',
          secret: '',
          algorithm: 'SHA1',
          digits: 6,
          period: 30,
          counter: 0,
          issuer: '',
          account: '',
        },
      };
  }
}
