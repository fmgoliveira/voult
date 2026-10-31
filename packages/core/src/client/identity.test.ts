import { describe, expect, it } from 'vitest';
import { blankItem } from './blank-item';
import { faviconUrl, identifierSuggestions, inferIdentifier, identifierOf } from './identity';
import { siteNameFromUrl } from '../matching/url';

const login = (username: string, email: string) => ({
  ...blankItem('login'),
  username,
  email,
});

describe('inferIdentifier', () => {
  it('detects emails and usernames', () => {
    expect(inferIdentifier(' me@example.com ')).toEqual({ username: '', email: 'me@example.com' });
    expect(inferIdentifier('francisco')).toEqual({ username: 'francisco', email: '' });
    expect(inferIdentifier('not@complete')).toEqual({ username: 'not@complete', email: '' });
  });
  it('shows the username first, else the email', () => {
    expect(identifierOf({ username: 'u', email: 'e@x.io' })).toBe('u');
    expect(identifierOf({ username: '', email: 'e@x.io' })).toBe('e@x.io');
  });
});

describe('identifierSuggestions', () => {
  const items = [
    login('', 'a@x.io'),
    login('', 'a@x.io'),
    login('bob', 'b@x.io'),
    login('', 'A@X.io'),
    blankItem('note'),
  ];
  it('ranks by number of logins using it, merging case', () => {
    expect(identifierSuggestions(items)).toEqual([
      { value: 'a@x.io', count: 3 },
      { value: 'b@x.io', count: 1 },
      { value: 'bob', count: 1 },
    ]);
  });
  it('filters by what is typed and hides an exact match', () => {
    expect(identifierSuggestions(items, 'b').map((s) => s.value)).toEqual(['b@x.io', 'bob']);
    expect(identifierSuggestions(items, 'bob')).toEqual([]);
  });
});

describe('faviconUrl', () => {
  it('uses the site itself over https', () => {
    expect(faviconUrl([{ url: 'https://github.com/login' }])).toBe(
      'https://github.com/favicon.ico',
    );
    expect(faviconUrl([{ url: 'example.com' }])).toBe('https://example.com/favicon.ico');
  });
  it('skips non-web and plain-http hosts and falls through to the next URL', () => {
    expect(faviconUrl([{ url: 'http://evil.test' }, { url: 'https://ok.dev' }])).toBe(
      'https://ok.dev/favicon.ico',
    );
    expect(faviconUrl([{ url: 'androidapp://x' }, { url: '' }])).toBeNull();
    expect(faviconUrl([{ url: 'http://localhost:3000/x' }])).toBe(
      'http://localhost:3000/favicon.ico',
    );
  });
});

describe('siteNameFromUrl', () => {
  it('derives a title from the registrable domain', () => {
    expect(siteNameFromUrl('https://www.github.com/login')).toBe('Github');
    expect(siteNameFromUrl('https://accounts.example.co.uk/x')).toBe('Example');
    expect(siteNameFromUrl('http://localhost:3000')).toBe('Localhost');
    expect(siteNameFromUrl('chrome://extensions')).toBe('Extensions');
    expect(siteNameFromUrl('')).toBe('');
  });
});
