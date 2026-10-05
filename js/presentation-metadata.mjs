// Tool results contain compact metadata; socket events contain rendered previews.
export function mergePresentationMetadata(previous, incoming) {
    if (!previous) return incoming;
    const previousSlides = new Map((previous.inline?.slides || []).map(slide => [slide.index, slide]));
    const slides = incoming.inline?.slides || previous.inline?.slides || [];
    return {
        ...previous,
        ...incoming,
        inline: {
            ...previous.inline,
            ...incoming.inline,
            slides: slides.map(slide => ({ ...previousSlides.get(slide.index), ...slide }))
        }
    };
}
