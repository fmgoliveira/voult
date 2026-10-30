import {
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
} from '@simplewebauthn/server';
import { randomBytes } from 'node:crypto';
import http from 'node:http';

/** Tiny relying party + login pages used to exercise autofill and passkeys end to end. */
const PAGES: Record<string, string> = {
  '/login': `
    <h1>Login</h1>
    <form id="f"><input name="email" type="email" placeholder="Email"><input name="pw" type="password" placeholder="Password"><button type="submit">Sign in</button></form>
    <p id="out"></p>
    <script>
      f.addEventListener('submit', (e) => { e.preventDefault(); out.textContent = 'submitted:' + f.email.value + ':' + f.pw.value; });
    </script>`,
  '/otp': `<h1>Verify</h1><input name="otp" autocomplete="one-time-code" maxlength="6" placeholder="Code">`,
  '/register': `
    <h1>Register</h1>
    <form><input name="email" type="email" placeholder="Email"><input name="pw" type="password" autocomplete="new-password" placeholder="Password"><input name="pw2" type="password" placeholder="Confirm"></form>`,
  '/multistep': `
    <h1>Multi-step</h1>
    <form id="f"><div id="s1"><input name="identifier" type="email" autocomplete="username" placeholder="Email"><button type="button" id="next">Next</button></div>
    <div id="s2" hidden><input name="pw" type="password" placeholder="Password"></div></form>
    <script>next.onclick = () => { s1.hidden = true; s2.hidden = false; };</script>`,
  '/frame': `<h1>Framed</h1><iframe src="/login" width="400" height="260" title="login frame"></iframe>`,
  '/passkey': `
    <h1>Passkeys</h1>
    <button id="register">Register</button><button id="signin">Sign in</button><p id="out"></p>
    <script>
      const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');
      const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')), (c) => c.charCodeAt(0));
      async function post(path, body) { return (await fetch(path, { method: 'POST', body: JSON.stringify(body) })).json(); }
      register.onclick = async () => {
        try {
          const { challenge } = await (await fetch('/webauthn/reg-options')).json();
          const cred = await navigator.credentials.create({ publicKey: {
            challenge: unb64(challenge), rp: { name: 'Fixture', id: 'localhost' },
            user: { id: new TextEncoder().encode('user-1'), name: 'alice@fixture', displayName: 'Alice' },
            pubKeyCredParams: [{ type: 'public-key', alg: -7 }], timeout: 60000, attestation: 'none',
          }});
          const r = await post('/webauthn/reg-verify', { id: cred.id, rawId: b64(cred.rawId), type: cred.type,
            response: { clientDataJSON: b64(cred.response.clientDataJSON), attestationObject: b64(cred.response.attestationObject) },
            clientExtensionResults: {} });
          out.textContent = r.verified ? 'registered' : 'rejected:' + r.error;
        } catch (e) { out.textContent = 'error:' + e.name; }
      };
      signin.onclick = async () => {
        try {
          const { challenge } = await (await fetch('/webauthn/auth-options')).json();
          const cred = await navigator.credentials.get({ publicKey: { challenge: unb64(challenge), rpId: 'localhost', timeout: 60000 } });
          const r = await post('/webauthn/auth-verify', { id: cred.id, rawId: b64(cred.rawId), type: cred.type,
            response: { clientDataJSON: b64(cred.response.clientDataJSON), authenticatorData: b64(cred.response.authenticatorData),
              signature: b64(cred.response.signature), userHandle: cred.response.userHandle ? b64(cred.response.userHandle) : undefined },
            clientExtensionResults: {} });
          out.textContent = r.verified ? 'signed-in:counter=' + r.counter : 'rejected:' + r.error;
        } catch (e) { out.textContent = 'error:' + e.name; }
      };
    </script>`,
};

export function startFixtureServer(port: number): Promise<http.Server> {
  const origin = `http://localhost:${port}`;
  let challenge = '';
  let credential: { id: string; publicKey: Uint8Array<ArrayBuffer>; counter: number } | null = null;
  const newChallenge = () => (challenge = randomBytes(32).toString('base64url'));

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', origin);
    const json = (body: unknown) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(body));
    };
    const readBody = async () => {
      let data = '';
      for await (const chunk of req) data += chunk;
      return JSON.parse(data);
    };

    try {
      if (url.pathname === '/webauthn/reg-options') return json({ challenge: newChallenge() });
      if (url.pathname === '/webauthn/auth-options') return json({ challenge: newChallenge() });
      if (url.pathname === '/webauthn/reg-verify') {
        const body = (await readBody()) as RegistrationResponseJSON;
        const v = await verifyRegistrationResponse({
          response: body,
          expectedChallenge: challenge,
          expectedOrigin: origin,
          expectedRPID: 'localhost',
          requireUserVerification: true,
        });
        if (v.verified) {
          const c = v.registrationInfo!.credential;
          credential = {
            id: c.id,
            publicKey: c.publicKey as Uint8Array<ArrayBuffer>,
            counter: c.counter,
          };
        }
        return json({ verified: v.verified });
      }
      if (url.pathname === '/webauthn/auth-verify') {
        const body = (await readBody()) as AuthenticationResponseJSON;
        if (!credential) return json({ verified: false, error: 'no credential' });
        const v = await verifyAuthenticationResponse({
          response: body,
          expectedChallenge: challenge,
          expectedOrigin: origin,
          expectedRPID: 'localhost',
          credential,
          requireUserVerification: true,
        });
        if (v.verified) credential.counter = v.authenticationInfo.newCounter;
        return json({ verified: v.verified, counter: v.authenticationInfo.newCounter });
      }
      const page = PAGES[url.pathname];
      if (!page) {
        res.statusCode = 404;
        return res.end('not found');
      }
      res.setHeader('content-type', 'text/html');
      res.end(`<!doctype html><html><head><meta charset="utf-8"><title>${url.pathname}</title>
        <style>body{font-family:sans-serif;padding:24px}input{display:block;margin:8px 0;width:260px;height:30px}</style></head><body>${page}</body></html>`);
    } catch (e) {
      res.statusCode = 400;
      json({ verified: false, error: String(e) });
    }
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}
