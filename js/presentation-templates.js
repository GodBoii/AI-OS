export const PRESENTATION_TEMPLATES = [
    {
        id: 'aetheria_modern',
        name: 'Aetheria Modern',
        shortName: 'Modern',
        description: 'Clean AI and product strategy deck with editorial title slides.',
        bestFor: 'AI strategy, product plans, operational reviews',
        colors: ['#F7F8F3', '#2364AA', '#F26B4F', '#2A9D8F']
    },
    {
        id: 'executive',
        name: 'Executive Boardroom',
        shortName: 'Executive',
        description: 'Quiet business review layout with metrics, tables, and crisp hierarchy.',
        bestFor: 'Leadership updates, board reviews, investor summaries',
        colors: ['#FBFAF7', '#0F766E', '#B45309', '#2563EB']
    },
    {
        id: 'startup_pitch',
        name: 'Startup Pitch',
        shortName: 'Pitch',
        description: 'High-contrast investor narrative with bold metrics and flow slides.',
        bestFor: 'Pitch decks, launch stories, product narratives',
        colors: ['#101828', '#7DD3FC', '#F9A8D4', '#A7F3D0']
    },
    {
        id: 'academic',
        name: 'Academic Research',
        shortName: 'Research',
        description: 'Formal research talk with readable evidence, diagrams, and citations.',
        bestFor: 'Research talks, lectures, literature reviews',
        colors: ['#FFFFFF', '#1D4ED8', '#7C3AED', '#059669']
    }
];

const STORAGE_KEY = 'aetheria:selected-presentation-template';

export function getPresentationTemplateById(templateId) {
    return PRESENTATION_TEMPLATES.find((template) => template.id === templateId) || null;
}

export function getSelectedPresentationTemplate() {
    const templateId = localStorage.getItem(STORAGE_KEY);
    return getPresentationTemplateById(templateId);
}

export function setSelectedPresentationTemplate(templateId) {
    const template = getPresentationTemplateById(templateId);
    if (!template) return null;
    localStorage.setItem(STORAGE_KEY, template.id);
    window.dispatchEvent(new CustomEvent('presentation-template:selected', { detail: { template } }));
    return template;
}

export function clearSelectedPresentationTemplate() {
    localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new CustomEvent('presentation-template:selected', { detail: { template: null } }));
}

export function isPresentationRequest(message = '') {
    const text = String(message).toLowerCase();
    return /\b(ppt|pptx|powerpoint|slide\s*deck|presentation\s+deck|create\s+(?:a\s+)?presentation|make\s+(?:a\s+)?presentation)\b/.test(text);
}

export function buildPresentationTemplateInstruction(template) {
    if (!template) return '';
    return [
        '',
        '',
        `In order to create ppt, the user has specifically asked you to create the ppt using this "${template.name}" template.`,
        `Use create_presentation with template="${template.id}". Do not choose a different presentation template unless the user explicitly changes it.`
    ].join('\n');
}

