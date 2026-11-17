# SSH keys and hosts

Voult can keep your SSH keys and hosts next to your passwords:

- **Windows**: a small companion (`voult.exe`) serves your keys to `ssh` through an SSH agent, so
  **no private key file is ever written to disk**, and logs in to password hosts without you typing
  the password.
- **Android**: keys, passwords and connection details can be shared or copied into
  [Termius](https://termius.com). Termius has no import API, so this is a hand-off, not a sync.

Two item types hold the data. An **SSH key** is a private key (OpenSSH format, stored unencrypted
_inside_ the encrypted item) and its public half. An **SSH host** is an alias, a host name, a port,
a user, and how you sign in: with a **key**, a **password**, or **both**. A host points at a key item,
so one key serves many hosts.

## Add a key and a host (extension or Android)

1. **Add item → SSH key.** Choose **Generate ed25519 key** (recommended), or paste or pick an existing
   private key. OpenSSH keys (even with a passphrase), and PEM RSA/ECDSA/ed25519 keys are accepted.
   Voult supports ed25519, RSA (2048 bits or more) and ECDSA P-256/P-384. A passphrase is removed on
   import so the agent can sign without asking; it is remembered in the item so you can export an
   encrypted copy again.
2. Copy the **public key** (the item's _Public key_ line) into `~/.ssh/authorized_keys` on your
   server.
3. **Add item → SSH host.** Give it an alias (what you will type after `ssh`: letters, digits, `.`,
   `_`, `-`), the host name, port and user, and pick the key (or enter a password).

Settings on a key: _Serve from the Voult SSH agent_ (on by default) and _Ask before every signature_.

## Windows

### 1. Get the companion

Download `voult-windows.exe` from the [latest release](https://github.com/fmgoliveira/voult/releases/latest),
rename it `voult.exe` and put it somewhere on your `PATH` (for example `%LOCALAPPDATA%\Voult\bin`).
It is a single file; Node.js is not needed.

### 2. Let Voult be your SSH agent

Windows ships its own `ssh-agent` service, and it owns the pipe Voult needs. Turn it off once, in an
**Administrator** PowerShell:

```powershell
Stop-Service ssh-agent; Set-Service ssh-agent -StartupType Disabled
```

Then, in a normal terminal:

```powershell
voult login https://vault.example.com you@example.com   # asks for your master password
voult agent install                                     # start the agent (hidden) at every logon
voult agent                                             # ...or start it right now in this window
voult agent doctor                                      # checks everything below
```

Check it works:

```powershell
ssh-add -L          # lists the keys Voult serves
```

### 3. Use your hosts

```powershell
voult ssh config    # writes ~/.ssh/voult/config (also done automatically after every sync)
ssh myhost          # connects through the agent; only .pub files are in ~/.ssh/voult
```

`voult ssh config` adds one block per host to `~\.ssh\voult\config`, writes each key's **public**
key as `~\.ssh\voult\<fingerprint>.pub`, and puts `Include voult/config` as the first line of
`~\.ssh\config` (an Include only works above the first `Host` block). It changes nothing else in your
config, and it can be turned off with `voult config sshConfigOnSync off`. Each key host gets
`IdentityFile ~/.ssh/voult/<fingerprint>.pub` and `IdentitiesOnly yes`: ssh uses the `.pub` file to
choose the matching key in the agent, which avoids _Too many authentication failures_.

Run `ssh` from PowerShell or cmd. The `ssh` bundled with **Git for Windows** (Git Bash) does not talk
to the Windows agent pipe.

### Password hosts

Plain `ssh` has no hook for passwords, so use the wrapper:

```powershell
voult ssh pwhost                      # logs in with the stored password
voult ssh pwhost -- -p 2222 uptime    # anything after -- goes to ssh
voult ssh --list                      # your aliases
```

It needs **OpenSSH 8.4 or newer** (Windows 10's built-in ssh is 8.1). If yours is older, install the
current one with `winget install Microsoft.OpenSSH.Preview` or from
<https://github.com/PowerShell/Win32-OpenSSH/releases>. The wrapper hands ssh a one-time token (valid
for 60 seconds), not the password: ssh asks `voult.exe` for the password through `SSH_ASKPASS`, and
only a plain `password:` prompt for _that_ host is answered. Host-key questions are never answered:
the first time you connect to a host, run `ssh <alias>` once in a normal terminal to check and accept
its fingerprint.

For a host that uses **key and password**, the key comes from the agent and the password from the
wrapper.

### Locking

The vault locks after 15 idle minutes, when Windows locks or sleeps, and on `voult lock`; locking
overwrites the keys in memory. While locked the agent lists no keys and shows a "Voult is locked"
notification; run `voult unlock`.

```powershell
voult status
voult config                       # show settings
voult config idleLockMinutes 30    # 0 turns idle locking off
voult config lockOnSessionLock off
```

Turn on _Ask before every signature_ on a key to get a Windows dialog each time something uses it
(no answer within 30 seconds counts as "no"). Every signature is also written (time and key
fingerprint, no secrets) to `%APPDATA%\Voult\agent-usage.log`.

### Extra ssh options

The _Extra ssh options_ box on a host takes `Key value` lines that are copied into its config block.
Options that run a program (`ProxyCommand`, `LocalCommand`, `KnownHostsCommand`, `PKCS11Provider`…)
are ignored unless you run `voult config allowCommandOptions on`, so a change made from another
device cannot make your PC run something. `Host`, `Match`, `Include` and unknown keywords are always
ignored; `voult ssh config` prints a warning for each.

### Troubleshooting

| Symptom                                           | Check                                                                                                                             |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `voult agent` says another program uses the pipe  | The Windows ssh-agent service: run the Administrator command in step 2. `voult agent doctor` explains what it found.             |
| `ssh-add -L` says _The agent has no identities_   | The vault is locked (`voult status`), or no key has _Serve from the Voult SSH agent_ on.                                          |
| `Too many authentication failures`                | The host is not using its key file: run `voult ssh config` and check `ssh -G myhost`.                                             |
| ssh ignores the agent                             | `SSH_AUTH_SOCK` is set to something else (`echo $env:SSH_AUTH_SOCK`), or you are using Git's ssh.                                 |
| `voult ssh` says OpenSSH is too old               | Install a newer Win32-OpenSSH (see above).                                                                                        |
| `Host key verification failed` from `voult ssh`   | Connect once with `ssh <alias>` in a normal terminal and accept the fingerprint.                                                  |
| Need to see what ssh is doing                     | `ssh -v myhost`, and `voult agent doctor`.                                                                                        |
| Sign out of this computer                         | `voult logout` (removes the local copy and the saved sign-in).                                                                    |

Where things live: `%APPDATA%\Voult\store.json` (the encrypted vault copy, the same ciphertext the
server holds), `session.json` (your sign-in, protected with Windows DPAPI), `config.json`.

## Android and Termius

On a key's screen, under _Use in another app_:

- **Share private key** writes the key to a temporary file in the app's cache, opens Android's share
  sheet (pick Termius), and deletes the file as soon as the sheet closes, or after 60 seconds.
  In Termius: _Keychain → + → Key → import_, then use that key on a host.
- **Share encrypted copy** does the same with a passphrase of your choice (Termius asks for it).
- **Copy public key** for `authorized_keys`.
- **Copy private key** is there as a last resort and asks first: the clipboard can be read by other
  apps until it clears (it is cleared after the time set in Settings).

On a host's screen, **Copy host name / port / username / password / ssh command** put each value on
the clipboard (flagged as sensitive, and cleared automatically) so you can paste it into Termius'
host form.

After you rotate a key or password, change it in Termius too: its copy is outside Voult.
