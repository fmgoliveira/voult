// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { detect } from '../lib/autofill/detect';
import { fillOtp, setFieldValue } from '../lib/autofill/fill';

const visible = () => true;
const run = (html: string) => {
  document.body.innerHTML = html;
  return detect(document, visible);
};

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('detect', () => {
  it('finds a classic login form', () => {
    const d = run(
      `<form><input name="email" type="email"><input name="pw" type="password"><button>Go</button></form>`,
    );
    expect(d.forms).toHaveLength(1);
    expect(d.forms[0]).toMatchObject({ kind: 'login' });
    expect(d.forms[0]!.username?.name).toBe('email');
    expect(d.forms[0]!.password?.name).toBe('pw');
  });

  it('prefers autocomplete=username and ignores search boxes', () => {
    const d = run(
      `<input type="search" name="q"><form><input name="a" type="text"><input name="b" autocomplete="username"><input type="password"></form>`,
    );
    expect(d.forms[0]!.username?.name).toBe('b');
  });

  it('classifies registration (two passwords) and change-password (three)', () => {
    const reg = run(
      `<form><input name="user"><input type="password" name="p1"><input type="password" name="p2"></form>`,
    );
    expect(reg.forms[0]).toMatchObject({ kind: 'register' });
    expect(reg.forms[0]!.confirm.map((c) => c.name)).toEqual(['p2']);

    const chg = run(
      `<form><input type="password" name="old"><input type="password" name="new" autocomplete="new-password"><input type="password" name="again"></form>`,
    );
    expect(chg.forms[0]).toMatchObject({ kind: 'change' });
    expect(chg.forms[0]!.currentPassword?.name).toBe('old');
    expect(chg.forms[0]!.password?.name).toBe('new');
    expect(chg.forms[0]!.confirm.map((c) => c.name)).toEqual(['again']);
  });

  it('detects the username step of a multi-step login', () => {
    const d = run(
      `<form><input type="email" name="identifier" autocomplete="username"><button>Next</button></form>`,
    );
    expect(d.forms).toHaveLength(1);
    expect(d.forms[0]).toMatchObject({ kind: 'username-step', password: null });
  });

  it('does not treat unrelated inputs as a login', () => {
    const d = run(
      `<form><input name="first_name"><input name="zip"><input type="text" name="comment"></form>`,
    );
    expect(d.forms).toHaveLength(0);
  });

  it('keeps separate forms separate', () => {
    const d = run(`
      <form id="a"><input name="user"><input type="password" name="p"></form>
      <form id="b"><input name="email" type="email"><input type="password" name="q"></form>`);
    expect(d.forms.map((f) => f.username?.name)).toEqual(['user', 'email']);
  });

  it('skips hidden, disabled and readonly fields', () => {
    document.body.innerHTML = `<form><input name="user" disabled><input name="e" type="email" readonly><input type="password" hidden></form>`;
    const d = detect(document, (el) => !(el as HTMLElement).hidden);
    expect(d.forms).toHaveLength(0);
  });

  it('detects OTP fields: one-time-code, named, and split digits', () => {
    expect(run(`<input autocomplete="one-time-code">`).otp?.inputs).toHaveLength(1);
    expect(run(`<input name="verification_code" maxlength="6">`).otp?.inputs).toHaveLength(1);
    expect(run(`<input name="comment_code_of_conduct" maxlength="300">`).otp).toBeNull();
    const split = run(Array.from({ length: 6 }, () => `<input maxlength="1">`).join(''));
    expect(split.otp?.inputs).toHaveLength(6);
  });

  it('reaches into open shadow roots', () => {
    const host = document.createElement('div');
    document.body.append(host);
    host.attachShadow({ mode: 'open' }).innerHTML = `<input type="email"><input type="password">`;
    expect(detect(document, visible).forms).toHaveLength(1);
  });
});

describe('fill', () => {
  it('sets values and fires input/change events', () => {
    document.body.innerHTML = `<input id="a">`;
    const el = document.getElementById('a') as HTMLInputElement;
    const events: string[] = [];
    el.addEventListener('input', () => events.push('input'));
    el.addEventListener('change', () => events.push('change'));
    setFieldValue(el, 'hello');
    expect(el.value).toBe('hello');
    expect(events).toEqual(['input', 'change']);
  });
  it('spreads a code across split boxes', () => {
    document.body.innerHTML = `<input><input><input>`;
    const inputs = [...document.querySelectorAll('input')];
    fillOtp(inputs, '123');
    expect(inputs.map((i) => i.value)).toEqual(['1', '2', '3']);
    fillOtp([inputs[0]!], '999999');
    expect(inputs[0]!.value).toBe('999999');
  });
});
