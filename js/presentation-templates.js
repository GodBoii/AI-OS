export const PRESENTATION_TEMPLATES = [
    {
        id: 'aetheria_modern',
        name: 'Aetheria Modern',
        shortName: 'Modern',
        description: 'Clean editorial deck for AI strategy and product narratives.',
        bestFor: 'AI strategy, product plans, operational reviews',
        colors: ['#F5F6F0', '#1B5299', '#E8553D', '#1A936F'],
        slides: [
            { type: 'title', label: 'Cover', description: 'Bold editorial opener with accent arc', previewLayout: 'title' },
            { type: 'content', label: 'Content', description: 'Bullet points with side callout', previewLayout: 'bullets' },
            { type: 'two_column', label: 'Comparison', description: 'Side-by-side framed columns', previewLayout: 'two-col' },
            { type: 'chart', label: 'Evidence', description: 'Horizontal bar chart with labels', previewLayout: 'chart' },
            { type: 'table', label: 'Data Table', description: 'Colored header with clean rows', previewLayout: 'table' },
            { type: 'diagram', label: 'Process Flow', description: 'Connected workflow boxes', previewLayout: 'flow' },
            { type: 'image', label: 'Visual', description: 'Full-width image with caption', previewLayout: 'visual' }
        ]
    },
    {
        id: 'executive',
        name: 'Executive Boardroom',
        shortName: 'Executive',
        description: 'Refined boardroom aesthetic with crisp data hierarchy.',
        bestFor: 'Leadership updates, board reviews, investor summaries',
        colors: ['#FAF9F5', '#0D6B5E', '#C2590A', '#1D5BBF'],
        slides: [
            { type: 'title', label: 'Cover', description: 'Serif-accented title with metrics rail', previewLayout: 'title' },
            { type: 'content', label: 'Talking Points', description: 'Clean bullets with evidence callout', previewLayout: 'bullets' },
            { type: 'two_column', label: 'Before & After', description: 'Dual panel comparison', previewLayout: 'two-col' },
            { type: 'chart', label: 'KPI Chart', description: 'Branded horizontal bar evidence', previewLayout: 'chart' },
            { type: 'table', label: 'Financial Table', description: 'Structured data grid', previewLayout: 'table' },
            { type: 'diagram', label: 'Roadmap', description: 'Phased process blocks', previewLayout: 'flow' },
            { type: 'image', label: 'Visual', description: 'Image placeholder with overlay', previewLayout: 'visual' }
        ]
    },
    {
        id: 'startup_pitch',
        name: 'Startup Pitch',
        shortName: 'Pitch',
        description: 'High-contrast dark deck with bold metrics for investors.',
        bestFor: 'Pitch decks, launch stories, product narratives',
        colors: ['#0C1524', '#60C3F7', '#F48FB1', '#81E6A9'],
        slides: [
            { type: 'title', label: 'Hero', description: 'Dark cinematic opener with neon accents', previewLayout: 'title' },
            { type: 'content', label: 'Value Prop', description: 'Bullet evidence with highlight box', previewLayout: 'bullets' },
            { type: 'two_column', label: 'Problem / Solution', description: 'Dual-tone comparison panels', previewLayout: 'two-col' },
            { type: 'chart', label: 'Traction', description: 'Glowing metric bars', previewLayout: 'chart' },
            { type: 'table', label: 'Competitive Grid', description: 'Dark table with accent header', previewLayout: 'table' },
            { type: 'diagram', label: 'Go-to-Market', description: 'Step flow with chevrons', previewLayout: 'flow' },
            { type: 'image', label: 'Product Shot', description: 'Centered visual showcase', previewLayout: 'visual' }
        ]
    },
    {
        id: 'academic',
        name: 'Academic Research',
        shortName: 'Research',
        description: 'Formal scholarly layout with readable evidence and citations.',
        bestFor: 'Research talks, lectures, literature reviews',
        colors: ['#FFFFFF', '#1749B8', '#6D28D9', '#047857'],
        slides: [
            { type: 'title', label: 'Title Slide', description: 'Serif-headed formal opener', previewLayout: 'title' },
            { type: 'content', label: 'Findings', description: 'Structured bullet evidence', previewLayout: 'bullets' },
            { type: 'two_column', label: 'Literature Review', description: 'Dual-source comparison', previewLayout: 'two-col' },
            { type: 'chart', label: 'Results Chart', description: 'Data visualization bars', previewLayout: 'chart' },
            { type: 'table', label: 'Results Table', description: 'Publication-ready data grid', previewLayout: 'table' },
            { type: 'diagram', label: 'Methodology', description: 'Research process pipeline', previewLayout: 'flow' },
            { type: 'image', label: 'Figure', description: 'Captioned research visual', previewLayout: 'visual' }
        ]
    },
    {
        id: 'creative_portfolio',
        name: 'Creative Portfolio',
        shortName: 'Creative',
        description: 'Bold expressive deck with vibrant gradients and asymmetric layouts.',
        bestFor: 'Design portfolios, creative briefs, brand pitches',
        colors: ['#1A1025', '#FF6B6B', '#C084FC', '#4ADE80'],
        slides: [
            { type: 'title', label: 'Splash', description: 'Full-bleed gradient hero', previewLayout: 'title' },
            { type: 'content', label: 'Story', description: 'Expressive bullets with accent strip', previewLayout: 'bullets' },
            { type: 'two_column', label: 'Showcase', description: 'Asymmetric dual panels', previewLayout: 'two-col' },
            { type: 'chart', label: 'Impact', description: 'Vivid color-coded bars', previewLayout: 'chart' },
            { type: 'diagram', label: 'Creative Process', description: 'Bold connected phases', previewLayout: 'flow' },
            { type: 'image', label: 'Gallery', description: 'Edge-to-edge visual frame', previewLayout: 'visual' }
        ]
    },
    {
        id: 'minimal_zen',
        name: 'Minimal Zen',
        shortName: 'Minimal',
        description: 'Ultra-clean whitespace design with restrained single-accent palette.',
        bestFor: 'Thought leadership, keynotes, minimalist reports',
        colors: ['#FAFAFA', '#18181B', '#A1A1AA', '#6366F1'],
        slides: [
            { type: 'title', label: 'Opening', description: 'Centered monochrome title', previewLayout: 'title' },
            { type: 'content', label: 'Points', description: 'Spacious clean bullets', previewLayout: 'bullets' },
            { type: 'two_column', label: 'Contrast', description: 'Balanced dual columns', previewLayout: 'two-col' },
            { type: 'chart', label: 'Data', description: 'Monochrome bar chart', previewLayout: 'chart' },
            { type: 'table', label: 'Grid', description: 'Hairline-bordered data table', previewLayout: 'table' },
            { type: 'image', label: 'Photograph', description: 'Minimal framed visual', previewLayout: 'visual' }
        ]
    },
    {
        id: 'tech_dark',
        name: 'Tech Neon',
        shortName: 'Tech',
        description: 'Dark engineering theme with electric neon accents and sharp edges.',
        bestFor: 'Technical demos, developer talks, product launches',
        colors: ['#0A0E17', '#00E5FF', '#FF3D71', '#00E096'],
        slides: [
            { type: 'title', label: 'Launch', description: 'Dark grid hero with neon glow', previewLayout: 'title' },
            { type: 'content', label: 'Specs', description: 'Technical bullet list with terminal feel', previewLayout: 'bullets' },
            { type: 'two_column', label: 'Architecture', description: 'Split system comparison', previewLayout: 'two-col' },
            { type: 'chart', label: 'Benchmarks', description: 'Performance metric bars', previewLayout: 'chart' },
            { type: 'table', label: 'Specs Table', description: 'Matrix data grid', previewLayout: 'table' },
            { type: 'diagram', label: 'Pipeline', description: 'Tech stack flow diagram', previewLayout: 'flow' },
            { type: 'image', label: 'Screenshot', description: 'Product screenshot frame', previewLayout: 'visual' }
        ]
    },
    {
        id: 'corporate_gradient',
        name: 'Corporate Horizon',
        shortName: 'Corporate',
        description: 'Professional gradient-rich deck with structured visual hierarchy.',
        bestFor: 'Quarterly reports, all-hands meetings, client proposals',
        colors: ['#F8FAFC', '#0F4C81', '#E07A2F', '#2E8B57'],
        slides: [
            { type: 'title', label: 'Cover', description: 'Gradient banner with corporate branding', previewLayout: 'title' },
            { type: 'content', label: 'Agenda', description: 'Organized bullet content', previewLayout: 'bullets' },
            { type: 'two_column', label: 'Comparison', description: 'Professional dual-panel layout', previewLayout: 'two-col' },
            { type: 'chart', label: 'Metrics', description: 'Business performance bars', previewLayout: 'chart' },
            { type: 'table', label: 'Data Overview', description: 'Executive data summary', previewLayout: 'table' },
            { type: 'diagram', label: 'Workflow', description: 'Structured process steps', previewLayout: 'flow' },
            { type: 'image', label: 'Visual', description: 'Professional image placement', previewLayout: 'visual' }
        ]
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
