import test from 'node:test';
import assert from 'node:assert/strict';
import { mergePresentationMetadata } from '../presentation-metadata.mjs';

const compact = { output_id: 'deck-1', inline: { slide_count: 1, slides: [{ index: 1, title: 'Decision' }] } };
const rendered = { ...compact, download_url: 'https://example.test/deck.pptx', inline: { ...compact.inline,
    slides: [{ index: 1, title: 'Decision', preview_data_uri: 'data:image/jpeg;base64,example' }] } };

test('previews survive either socket/tool arrival order without changing the artifact id', () => {
    for (const [first, second] of [[compact, rendered], [rendered, compact]]) {
        const result = mergePresentationMetadata(first, second);
        assert.equal(result.output_id, 'deck-1');
        assert.equal(result.inline.slides[0].preview_data_uri, rendered.inline.slides[0].preview_data_uri);
        assert.equal(result.download_url, rendered.download_url);
        assert.equal(result.inline.slide_count, 1);
    }
});

test('new slide order and content remain authoritative', () => {
    const result = mergePresentationMetadata(rendered, { inline: { slides: [{ index: 2, title: 'Next step' }] } });
    assert.deepEqual(result.inline.slides, [{ index: 2, title: 'Next step' }]);
    assert.equal(rendered.inline.slides[0].title, 'Decision');
});
