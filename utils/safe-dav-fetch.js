'use strict';

// iCloud DAV discovery can move between Apple's service and numbered shard
// hosts. Never forward credentials to any other destination, including through
// redirects or URLs returned by a server or supplied to an MCP tool.
function validateDavUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Invalid iCloud DAV URL');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !/^(?:p\d+-)?(?:caldav|contacts)\.icloud\.com$/.test(url.hostname)) {
    throw new Error('Untrusted iCloud DAV destination');
  }
  return url;
}

function createSafeDavFetch(fetchImpl = globalThis.fetch) {
  return async (input, options = {}) => {
    let url = validateDavUrl(typeof input === 'string' || input instanceof URL ? input : input.url);
    for (let redirects = 0; redirects <= 5; redirects++) {
      const response = await fetchImpl(url.href, { ...options, redirect: 'manual' });
      // tsdav uses manual redirects during service discovery to learn its
      // root URL. Return the response unchanged; any subsequent request goes
      // through this guard again before credentials are sent.
      if (options.redirect === 'manual') return response;
      if (![301, 302, 303, 307, 308].includes(response.status)) return response;
      const location = response.headers.get('location');
      if (!location || redirects === 5) throw new Error('Invalid or excessive iCloud DAV redirects');
      // DAV methods and authentication must not silently change on a redirect.
      url = validateDavUrl(new URL(location, url));
    }
  };
}

module.exports = { validateDavUrl, createSafeDavFetch };
