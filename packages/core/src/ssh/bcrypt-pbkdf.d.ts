declare module 'bcrypt-pbkdf' {
  const lib: {
    BLOCKS: number;
    HASHSIZE: number;
    /** Fills `key` and returns 0, or -1 on bad arguments. */
    pbkdf(
      pass: Uint8Array,
      passlen: number,
      salt: Uint8Array,
      saltlen: number,
      key: Uint8Array,
      keylen: number,
      rounds: number,
    ): number;
  };
  export = lib;
}
