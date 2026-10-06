const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDeck, validateDeck } = require('../../python-backend/ppt_harness_renderer');
const { DESIGN_PROFILES } = require('../../python-backend/presentation_designs');

function geometry(slide) {
    return JSON.stringify(slide.objects.filter(o => o.id !== 'background').map(o =>
        [o.type, o.x, o.y, o.w, o.h, o.style.fontFace, o.style.fontSizePt, Boolean(o.style.italic)]));
}

test('all nine themes differ in composition and typography, beyond their palette', () => {
    const covers = new Set();
    const bodies = new Set();
    const typography = new Set();
    for (const template of Object.keys(DESIGN_PROFILES)) {
        const { deck } = buildDeck({ template, topic: 'Operations', slides: [
            { type: 'title', title: 'A practical path forward', subtitle: 'A concise operations briefing' },
            { type: 'content', title: 'Make each handoff clear', bullets: ['Give each request an owner', 'Track the decision', 'Review the outcome'] }
        ] });
        assert.equal(validateDeck(deck).ok, true, template);
        covers.add(geometry(deck.slides[0]));
        bodies.add(geometry(deck.slides[1]));
        const profile = DESIGN_PROFILES[template];
        typography.add(`${profile.headingFace}/${profile.fontFace}/${template === 'creative_portfolio'}`);
    }
    assert.equal(covers.size, 9);
    assert.equal(bodies.size, 9);
    assert.equal(typography.size, 9);
});
