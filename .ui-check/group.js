// Checks the cookie-to-site grouping, which is the one piece of real logic in the
// cookie feature: it has to collapse the several hosts one login writes to,
// without a public suffix list.
const assert = require('assert');
const { groupCookiesBySite } = require('../js/browser-handler.js');

const cookie = (domain) => ({ domain, name: 'x', path: '/' });

// One Google login scatters cookies over several hosts. All of it is one site.
assert.deepStrictEqual(
    groupCookiesBySite([
        cookie('.google.com'), cookie('.google.com'),
        cookie('accounts.google.com'),
        cookie('mail.google.com'),
        cookie('www.google.com'),
    ]),
    [{ domain: 'google.com', cookies: 5 }]
);

// Unrelated sites stay separate, and the result is alphabetical.
assert.deepStrictEqual(
    groupCookiesBySite([cookie('github.com'), cookie('.google.com'), cookie('api.github.com')]),
    [{ domain: 'github.com', cookies: 2 }, { domain: 'google.com', cookies: 1 }]
);

// A near-miss suffix is a different site: notgithub.com is not under github.com.
assert.deepStrictEqual(
    groupCookiesBySite([cookie('github.com'), cookie('notgithub.com')]),
    [{ domain: 'github.com', cookies: 1 }, { domain: 'notgithub.com', cookies: 1 }]
);

// Without a parent cookie present, the shortest host seen becomes the group. This
// is why a public suffix list is not needed: browsers reject a cookie on .co.uk,
// so a bare public suffix never shows up as a group key.
assert.deepStrictEqual(
    groupCookiesBySite([cookie('shop.example.co.uk'), cookie('.example.co.uk')]),
    [{ domain: 'example.co.uk', cookies: 2 }]
);

// Two sites under the same public suffix must not merge into it.
assert.deepStrictEqual(
    groupCookiesBySite([cookie('.bbc.co.uk'), cookie('.gov.co.uk')]),
    [{ domain: 'bbc.co.uk', cookies: 1 }, { domain: 'gov.co.uk', cookies: 1 }]
);

// Junk in, nothing out.
assert.deepStrictEqual(groupCookiesBySite([]), []);
assert.deepStrictEqual(groupCookiesBySite([cookie(''), cookie('.')]), []);

console.log('cookie grouping: all assertions passed');
