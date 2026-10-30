import { describe, expect, it } from 'vitest';
import { baseDomain, hostnameOf, isFillableUrl, matchLogin, ruleMatches } from './url';

const rule = (url: string, match: 'domain' | 'host' | 'regex' | 'never' = 'domain') => ({
  url,
  match,
});

describe('baseDomain (PSL)', () => {
  it('uses the registrable domain', () => {
    expect(baseDomain('login.github.com')).toBe('github.com');
    expect(baseDomain('www.example.co.uk')).toBe('example.co.uk');
    expect(baseDomain('user.github.io')).toBe('user.github.io'); // private suffix
    expect(baseDomain('co.uk')).toBe('co.uk');
  });
  it('keeps IPs and localhost exact', () => {
    expect(baseDomain('127.0.0.1')).toBe('127.0.0.1');
    expect(baseDomain('localhost')).toBe('localhost');
  });
});

describe('ruleMatches', () => {
  it('domain: subdomains match, lookalikes do not', () => {
    expect(ruleMatches(rule('github.com'), 'https://gist.github.com/x')).toBe(true);
    expect(ruleMatches(rule('https://www.github.com'), 'https://github.com')).toBe(true);
    expect(ruleMatches(rule('github.com'), 'https://github.com.evil.com')).toBe(false);
    expect(ruleMatches(rule('github.com'), 'https://evilgithub.com')).toBe(false);
    expect(ruleMatches(rule('a.github.io'), 'https://b.github.io')).toBe(false);
  });
  it('host: exact host (and port)', () => {
    expect(
      ruleMatches(rule('https://app.example.com', 'host'), 'https://app.example.com/login'),
    ).toBe(true);
    expect(ruleMatches(rule('https://app.example.com', 'host'), 'https://other.example.com')).toBe(
      false,
    );
    expect(ruleMatches(rule('http://localhost:3000', 'host'), 'http://localhost:4000')).toBe(false);
  });
  it('regex: tests the full URL and tolerates bad patterns', () => {
    expect(
      ruleMatches(rule('^https://sso\\.example\\.com/.*', 'regex'), 'https://sso.example.com/a'),
    ).toBe(true);
    expect(
      ruleMatches(
        rule('^https://sso\\.example\\.com/.*', 'regex'),
        'https://x.com/sso.example.com/',
      ),
    ).toBe(false);
    expect(ruleMatches(rule('(', 'regex'), 'https://a.com')).toBe(false);
  });
  it('handles unparsable URLs', () => {
    expect(ruleMatches(rule('github.com'), 'not a url ::')).toBe(false);
    expect(ruleMatches(rule('http://', 'host'), 'https://a.com')).toBe(false);
    expect(hostnameOf('Example.COM/path')).toBe('example.com');
    expect(hostnameOf('http://')).toBeNull();
  });
});

describe('matchLogin', () => {
  it('requires a matching rule and honours never rules', () => {
    const login = { urls: [rule('github.com')] };
    expect(matchLogin(login, 'https://github.com/login')).toBe(true);
    expect(matchLogin({ urls: [] }, 'https://github.com')).toBe(false);
    expect(matchLogin({ urls: [rule('  ')] }, 'https://github.com')).toBe(false);
    expect(
      matchLogin(
        { urls: [rule('github.com'), rule('gist.github.com', 'never')] },
        'https://gist.github.com',
      ),
    ).toBe(false);
    expect(
      matchLogin(
        { urls: [rule('github.com'), rule('gist.github.com', 'never')] },
        'https://github.com',
      ),
    ).toBe(true);
    expect(matchLogin({ urls: [rule('github.com', 'never')] }, 'https://github.com')).toBe(false);
  });
  it('never fills on plain http except loopback', () => {
    expect(isFillableUrl('http://example.com')).toBe(false);
    expect(isFillableUrl('http://localhost:8080/x')).toBe(true);
    expect(isFillableUrl('http://127.0.0.1')).toBe(true);
    expect(isFillableUrl('ftp://example.com')).toBe(false);
    expect(isFillableUrl('garbage')).toBe(true); // bare hosts parse as https
    expect(matchLogin({ urls: [rule('example.com')] }, 'http://example.com')).toBe(false);
  });
});
