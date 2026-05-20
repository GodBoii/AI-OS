#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const PptxGenJS = require('pptxgenjs');

const EMU_PER_INCH = 914400;
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
let currentPptx = null;

const BUILT_IN_TEMPLATES = {
  aetheria_modern: {
    name: 'Aetheria Modern',
    description: 'Clean editorial deck for AI strategy and product narratives.',
    background: 'F5F6F0',
    surface: 'FFFFFF',
    ink: '17202A',
    muted: '5A6474',
    accent: '1B5299',
    accent2: 'E8553D',
    accent3: '1A936F',
    fontFace: 'Aptos',
    headingFace: 'Aptos Display',
  },
  executive: {
    name: 'Executive Boardroom',
    description: 'Refined boardroom aesthetic with crisp data hierarchy.',
    background: 'FAF9F5',
    surface: 'FFFFFF',
    ink: '111827',
    muted: '5F6672',
    accent: '0D6B5E',
    accent2: 'C2590A',
    accent3: '1D5BBF',
    fontFace: 'Aptos',
    headingFace: 'Georgia',
  },
  startup_pitch: {
    name: 'Startup Pitch',
    description: 'High-contrast dark deck with bold metrics for investors.',
    background: '0C1524',
    surface: '162036',
    ink: 'F4F5F7',
    muted: 'B0BCCD',
    accent: '60C3F7',
    accent2: 'F48FB1',
    accent3: '81E6A9',
    fontFace: 'Aptos',
    headingFace: 'Aptos Display',
  },
  academic: {
    name: 'Academic Research',
    description: 'Formal scholarly layout with readable evidence and citations.',
    background: 'FFFFFF',
    surface: 'F0F4FA',
    ink: '1E293B',
    muted: '5C6B7F',
    accent: '1749B8',
    accent2: '6D28D9',
    accent3: '047857',
    fontFace: 'Aptos',
    headingFace: 'Cambria',
  },
  creative_portfolio: {
    name: 'Creative Portfolio',
    description: 'Bold expressive deck with vibrant gradients and asymmetric layouts.',
    background: '1A1025',
    surface: '261438',
    ink: 'F8F0FF',
    muted: 'C4A8E0',
    accent: 'FF6B6B',
    accent2: 'C084FC',
    accent3: '4ADE80',
    fontFace: 'Aptos',
    headingFace: 'Aptos Display',
  },
  minimal_zen: {
    name: 'Minimal Zen',
    description: 'Ultra-clean whitespace design with restrained single-accent palette.',
    background: 'FAFAFA',
    surface: 'F4F4F5',
    ink: '18181B',
    muted: '71717A',
    accent: '6366F1',
    accent2: 'A1A1AA',
    accent3: '6366F1',
    fontFace: 'Aptos',
    headingFace: 'Aptos Display',
  },
  tech_dark: {
    name: 'Tech Neon',
    description: 'Dark engineering theme with electric neon accents and sharp edges.',
    background: '0A0E17',
    surface: '121A28',
    ink: 'E8ECF2',
    muted: '8899AA',
    accent: '00E5FF',
    accent2: 'FF3D71',
    accent3: '00E096',
    fontFace: 'Aptos',
    headingFace: 'Aptos Display',
  },
  corporate_gradient: {
    name: 'Corporate Horizon',
    description: 'Professional gradient-rich deck with structured visual hierarchy.',
    background: 'F8FAFC',
    surface: 'FFFFFF',
    ink: '0F172A',
    muted: '5B6578',
    accent: '0F4C81',
    accent2: 'E07A2F',
    accent3: '2E8B57',
    fontFace: 'Aptos',
    headingFace: 'Georgia',
  },
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function writeJson(value) {
  process.stdout.write(JSON.stringify(value));
}

function normalizeText(value, fallback = '') {
  if (value == null) return fallback;
  if (Array.isArray(value)) return value.map((item) => normalizeText(item)).filter(Boolean).join('\n');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function cleanBullets(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeText(item).replace(/^[\s•*-]+/, '').trim()).filter(Boolean);
  }
  return normalizeText(value)
    .split(/\r?\n|;/)
    .map((line) => line.replace(/^[\s•*-]+/, '').trim())
    .filter(Boolean);
}

function safeColor(value, fallback) {
  const text = String(value || '').replace('#', '').trim();
  return /^[0-9a-f]{6}$/i.test(text) ? text.toUpperCase() : fallback;
}

function pickTemplate(name) {
  return BUILT_IN_TEMPLATES[name] || BUILT_IN_TEMPLATES.aetheria_modern;
}

function addBg(slide, template) {
  slide.background = { color: template.background };
}

function addFooter(slide, template, slideNumber, totalSlides, topic) {
  slide.addShape(currentPptx.ShapeType.line, {
    x: 0.48, y: 5.06, w: 9.04, h: 0,
    line: { color: template.ink, transparency: 82, width: 0.6 },
  });
  slide.addText(normalizeText(topic).slice(0, 64), {
    x: 0.52, y: 5.12, w: 6.8, h: 0.18,
    fontFace: template.fontFace, fontSize: 6.6, color: template.muted,
    margin: 0,
  });
  slide.addText(`${slideNumber}/${totalSlides}`, {
    x: 8.82, y: 5.12, w: 0.7, h: 0.18,
    fontFace: template.fontFace, fontSize: 6.6, color: template.muted,
    align: 'right', margin: 0,
  });
}

function addKicker(slide, text, template) {
  if (!text) return;
  slide.addShape(currentPptx.ShapeType.rect, {
    x: 0.52, y: 0.36, w: 0.16, h: 0.16,
    fill: { color: template.accent },
    line: { color: template.accent },
  });
  slide.addText(String(text).toUpperCase(), {
    x: 0.76, y: 0.32, w: 3.8, h: 0.25,
    fontFace: template.fontFace, fontSize: 7.4, bold: true,
    color: template.muted, charSpace: 0.6, margin: 0,
  });
}

function addTitle(slide, title, template, opts = {}) {
  slide.addText(normalizeText(title, 'Untitled slide'), {
    x: opts.x ?? 0.52, y: opts.y ?? 0.66, w: opts.w ?? 8.7, h: opts.h ?? 0.82,
    fontFace: template.headingFace, fontSize: opts.size ?? 25,
    bold: true, color: template.ink, margin: 0.02,
    breakLine: false, fit: 'shrink',
  });
}

function addSubtitle(slide, text, template, opts = {}) {
  if (!text) return;
  slide.addText(normalizeText(text), {
    x: opts.x ?? 0.54, y: opts.y ?? 1.54, w: opts.w ?? 8.2, h: opts.h ?? 0.42,
    fontFace: template.fontFace, fontSize: opts.size ?? 10.5,
    color: template.muted, margin: 0.02, breakLine: false, fit: 'shrink',
  });
}

function addBullets(slide, bullets, template, opts = {}) {
  const items = cleanBullets(bullets).slice(0, opts.maxItems || 7);
  if (!items.length) return;
  const rich = [];
  items.forEach((item, index) => {
    rich.push({
      text: item,
      options: {
        bullet: { indent: 12 },
        breakLine: index < items.length - 1,
      },
    });
  });
  slide.addText(rich, {
    x: opts.x ?? 0.74, y: opts.y ?? 1.52, w: opts.w ?? 8.2, h: opts.h ?? 3.2,
    fontFace: template.fontFace, fontSize: opts.size ?? 14,
    color: template.ink, fit: 'shrink',
    paraSpaceAfterPt: 8,
    margin: 0.04,
    breakLine: false,
  });
}

function addMetricRail(slide, metrics, template, opts = {}) {
  const items = Array.isArray(metrics) ? metrics.slice(0, opts.maxItems || 3) : [];
  if (!items.length) return;
  const x0 = opts.x ?? 0.58;
  const y = opts.y ?? 4.1;
  const gap = 0.14;
  const w = ((opts.w ?? 8.84) - gap * (items.length - 1)) / items.length;
  items.forEach((metric, idx) => {
    const x = x0 + idx * (w + gap);
    slide.addShape(currentPptx.ShapeType.roundRect, {
      x, y, w, h: opts.h ?? 0.72,
      rectRadius: 0.05,
      fill: { color: template.surface, transparency: template.background === '101828' ? 88 : 0 },
      line: { color: template.accent, transparency: 62, width: 0.8 },
    });
    slide.addText(normalizeText(metric.value || metric.metric || ''), {
      x: x + 0.14, y: y + 0.12, w: w - 0.28, h: 0.24,
      fontFace: template.headingFace, fontSize: 14, bold: true,
      color: template.accent, margin: 0, fit: 'shrink',
    });
    slide.addText(normalizeText(metric.label || metric.name || ''), {
      x: x + 0.14, y: y + 0.39, w: w - 0.28, h: 0.2,
      fontFace: template.fontFace, fontSize: 6.8, bold: true,
      color: template.muted, margin: 0, fit: 'shrink',
    });
  });
}

function addSimpleBarChart(slide, chart, template, opts = {}) {
  const data = Array.isArray(chart?.data) ? chart.data.slice(0, 6) : [];
  if (!data.length) return false;
  const x = opts.x ?? 0.72;
  const y = opts.y ?? 1.82;
  const w = opts.w ?? 8.35;
  const rowH = opts.rowH ?? 0.42;
  const maxValue = Math.max(...data.map((d) => Number(d.value) || 0), 1);
  slide.addText(chart.title || 'Evidence', {
    x, y: y - 0.35, w, h: 0.22,
    fontFace: template.fontFace, fontSize: 8.5, bold: true,
    color: template.muted, margin: 0,
  });
  data.forEach((point, i) => {
    const value = Number(point.value) || 0;
    const barW = Math.max(0.1, (w - 2.15) * value / maxValue);
    const rowY = y + i * rowH;
    slide.addText(normalizeText(point.label || point.name || `Item ${i + 1}`), {
      x, y: rowY + 0.03, w: 1.75, h: 0.18,
      fontFace: template.fontFace, fontSize: 7.3, color: template.ink,
      margin: 0, fit: 'shrink',
    });
    slide.addShape(currentPptx.ShapeType.rect, {
      x: x + 1.95, y: rowY + 0.05, w: barW, h: 0.16,
      fill: { color: i % 3 === 0 ? template.accent : (i % 3 === 1 ? template.accent2 : template.accent3) },
      line: { color: i % 3 === 0 ? template.accent : (i % 3 === 1 ? template.accent2 : template.accent3) },
    });
    slide.addText(normalizeText(point.display || value), {
      x: x + 2.05 + barW, y: rowY + 0.03, w: 0.72, h: 0.18,
      fontFace: template.fontFace, fontSize: 7.3, bold: true,
      color: template.ink, margin: 0,
    });
  });
  return true;
}

function addDiagram(slide, nodes, template, opts = {}) {
  const items = Array.isArray(nodes) ? nodes.slice(0, 5) : [];
  if (!items.length) return false;
  const x = opts.x ?? 0.68;
  const y = opts.y ?? 2.05;
  const totalW = opts.w ?? 8.56;
  const gap = 0.16;
  const boxW = (totalW - gap * (items.length - 1)) / items.length;
  items.forEach((node, i) => {
    const boxX = x + i * (boxW + gap);
    slide.addShape(currentPptx.ShapeType.roundRect, {
      x: boxX, y, w: boxW, h: 1.12,
      rectRadius: 0.06,
      fill: { color: template.surface, transparency: template.background === '101828' ? 88 : 0 },
      line: { color: i % 2 ? template.accent2 : template.accent, transparency: 28, width: 1.0 },
    });
    slide.addText(normalizeText(node.title || node.name || node), {
      x: boxX + 0.12, y: y + 0.16, w: boxW - 0.24, h: 0.28,
      fontFace: template.fontFace, fontSize: 9.2, bold: true,
      color: template.ink, margin: 0.02, fit: 'shrink',
    });
    slide.addText(normalizeText(node.detail || node.description || ''), {
      x: boxX + 0.12, y: y + 0.52, w: boxW - 0.24, h: 0.42,
      fontFace: template.fontFace, fontSize: 6.8,
      color: template.muted, margin: 0.02, fit: 'shrink',
    });
    if (i < items.length - 1) {
      slide.addShape(currentPptx.ShapeType.chevron, {
        x: boxX + boxW + 0.035, y: y + 0.42, w: 0.09, h: 0.22,
        fill: { color: template.muted, transparency: 35 },
        line: { color: template.muted, transparency: 100 },
      });
    }
  });
  return true;
}

function addTable(slide, rows, template, opts = {}) {
  const tableRows = Array.isArray(rows) ? rows.slice(0, 7) : [];
  if (!tableRows.length) return false;
  const normalized = tableRows.map((row) => Array.isArray(row) ? row : Object.values(row || {}));
  const colCount = Math.max(...normalized.map((row) => row.length), 1);
  const x = opts.x ?? 0.68;
  const y = opts.y ?? 1.8;
  const w = opts.w ?? 8.6;
  const rowH = opts.rowH ?? 0.34;
  const colW = w / colCount;
  normalized.forEach((row, r) => {
    for (let c = 0; c < colCount; c += 1) {
      const isHeader = r === 0;
      slide.addShape(currentPptx.ShapeType.rect, {
        x: x + c * colW, y: y + r * rowH, w: colW, h: rowH,
        fill: { color: isHeader ? template.accent : template.surface, transparency: isHeader ? 0 : (template.background === '101828' ? 88 : 0) },
        line: { color: template.ink, transparency: 82, width: 0.4 },
      });
      slide.addText(normalizeText(row[c] ?? ''), {
        x: x + c * colW + 0.06, y: y + r * rowH + 0.06, w: colW - 0.12, h: rowH - 0.1,
        fontFace: template.fontFace, fontSize: isHeader ? 6.8 : 6.6,
        bold: isHeader, color: isHeader ? 'FFFFFF' : template.ink,
        margin: 0, fit: 'shrink',
      });
    }
  });
  return true;
}

function buildTitleSlide(pptx, slideData, ctx) {
  const slide = pptx.addSlide();
  const { template } = ctx;
  addBg(slide, template);
  slide.addShape(currentPptx.ShapeType.rect, {
    x: 0, y: 0, w: 10, h: 5.625,
    fill: { color: template.background },
    line: { color: template.background },
  });
  slide.addShape(currentPptx.ShapeType.arc, {
    x: 7.75, y: -0.65, w: 2.8, h: 2.8,
    adjustPoint: 0.65,
    line: { color: template.accent, transparency: 38, width: 2.2 },
  });
  addKicker(slide, slideData.kicker || 'Presentation', template);
  addTitle(slide, slideData.title || ctx.topic, template, { x: 0.58, y: 1.34, w: 7.6, h: 1.45, size: 34 });
  addSubtitle(slide, slideData.subtitle || slideData.content, template, { x: 0.62, y: 3.02, w: 7.3, h: 0.52, size: 12 });
  addMetricRail(slide, slideData.metrics, template, { x: 0.62, y: 4.18, w: 8.2, maxItems: 3 });
  return slide;
}

function buildContentSlide(pptx, slideData, ctx) {
  const slide = pptx.addSlide();
  const { template, index, totalSlides, topic } = ctx;
  addBg(slide, template);
  addKicker(slide, slideData.kicker || slideData.section || 'Insight', template);
  addTitle(slide, slideData.title, template);

  const chartDone = addSimpleBarChart(slide, slideData.chart, template);
  const tableDone = !chartDone && addTable(slide, slideData.table, template);
  const diagramDone = !chartDone && !tableDone && addDiagram(slide, slideData.nodes || slideData.steps, template);

  if (!chartDone && !tableDone && !diagramDone) {
    addBullets(slide, slideData.bullets || slideData.content || slideData.points, template, {
      x: 0.74, y: 1.72, w: 6.0, h: 2.9, size: 13,
    });
    if (slideData.callout || slideData.summary) {
      slide.addShape(currentPptx.ShapeType.roundRect, {
        x: 7.05, y: 1.72, w: 2.05, h: 2.35,
        rectRadius: 0.06,
        fill: { color: template.surface, transparency: template.background === '101828' ? 88 : 0 },
        line: { color: template.accent, transparency: 50, width: 1 },
      });
      slide.addText(normalizeText(slideData.callout || slideData.summary), {
        x: 7.22, y: 1.94, w: 1.72, h: 1.75,
        fontFace: template.headingFace, fontSize: 15,
        color: template.accent, bold: true,
        margin: 0.02, fit: 'shrink',
      });
    }
  }
  addMetricRail(slide, slideData.metrics, template, { x: 0.66, y: 4.34, w: 8.65, maxItems: 4, h: 0.56 });
  addFooter(slide, template, index, totalSlides, topic);
  return slide;
}

function buildTwoColumnSlide(pptx, slideData, ctx) {
  const slide = pptx.addSlide();
  const { template, index, totalSlides, topic } = ctx;
  addBg(slide, template);
  addKicker(slide, slideData.kicker || 'Comparison', template);
  addTitle(slide, slideData.title, template);

  const leftTitle = slideData.left_title || slideData.left?.title || 'Current state';
  const rightTitle = slideData.right_title || slideData.right?.title || 'Target state';
  const leftContent = slideData.left_content || slideData.left?.content || slideData.left?.bullets || [];
  const rightContent = slideData.right_content || slideData.right?.content || slideData.right?.bullets || [];
  [
    { x: 0.66, title: leftTitle, content: leftContent, color: template.accent },
    { x: 5.08, title: rightTitle, content: rightContent, color: template.accent2 },
  ].forEach((col) => {
    slide.addShape(currentPptx.ShapeType.roundRect, {
      x: col.x, y: 1.64, w: 4.08, h: 2.94,
      rectRadius: 0.06,
      fill: { color: template.surface, transparency: template.background === '101828' ? 88 : 0 },
      line: { color: col.color, transparency: 45, width: 1 },
    });
    slide.addText(col.title, {
      x: col.x + 0.22, y: 1.88, w: 3.62, h: 0.28,
      fontFace: template.fontFace, fontSize: 10, bold: true,
      color: col.color, margin: 0, fit: 'shrink',
    });
    addBullets(slide, col.content, template, {
      x: col.x + 0.26, y: 2.3, w: 3.48, h: 1.78, size: 9.4, maxItems: 5,
    });
  });
  addFooter(slide, template, index, totalSlides, topic);
  return slide;
}

function buildImageSlide(pptx, slideData, ctx) {
  const slide = pptx.addSlide();
  const { template, index, totalSlides, topic } = ctx;
  addBg(slide, template);
  addKicker(slide, slideData.kicker || 'Visual', template);
  addTitle(slide, slideData.title, template);
  addSubtitle(slide, slideData.caption || slideData.content, template, { y: 4.44, w: 8.5, size: 8.8 });
  const imagePath = slideData.image_path || slideData.imagePath;
  if (imagePath && fs.existsSync(imagePath)) {
    slide.addImage({ path: imagePath, x: 0.78, y: 1.62, w: 8.42, h: 2.62, sizingCrop: true });
  } else {
    slide.addShape(currentPptx.ShapeType.roundRect, {
      x: 0.78, y: 1.62, w: 8.42, h: 2.62,
      rectRadius: 0.05,
      fill: { color: template.surface, transparency: template.background === '101828' ? 88 : 0 },
      line: { color: template.accent, transparency: 45, width: 1 },
    });
    slide.addText(normalizeText(slideData.visual_summary || slideData.summary || 'Visual placeholder'), {
      x: 1.1, y: 2.36, w: 7.72, h: 0.8,
      fontFace: template.headingFace, fontSize: 20,
      color: template.accent, bold: true, align: 'center',
      margin: 0.02, fit: 'shrink',
    });
  }
  addFooter(slide, template, index, totalSlides, topic);
  return slide;
}

function normalizeSlide(slide, index, topic) {
  if (!slide || typeof slide !== 'object') {
    return { type: 'content', title: `Slide ${index + 1}`, bullets: [normalizeText(slide)] };
  }
  const normalized = { ...slide };
  normalized.type = String(slide.type || (index === 0 ? 'title' : 'content')).toLowerCase();
  normalized.title = normalizeText(slide.title || (index === 0 ? topic : `Slide ${index + 1}`));
  return normalized;
}

function buildPresentation(payload) {
  const pptx = new PptxGenJS();
  currentPptx = pptx;
  pptx.author = 'Aetheria AI';
  pptx.company = 'Aetheria AI';
  pptx.subject = normalizeText(payload.topic || 'AI generated presentation');
  pptx.title = normalizeText(payload.topic || 'Presentation');
  pptx.lang = 'en-US';
  pptx.layout = 'LAYOUT_WIDE';
  pptx.theme = {
    headFontFace: 'Aptos Display',
    bodyFontFace: 'Aptos',
    lang: 'en-US',
  };

  const template = pickTemplate(payload.template);
  const topic = normalizeText(payload.topic || 'Presentation');
  const rawSlides = Array.isArray(payload.slides) && payload.slides.length
    ? payload.slides
    : [{ type: 'title', title: topic }, { type: 'content', title: 'Key points', bullets: cleanBullets(payload.content || '') }];
  const slides = rawSlides.map((slide, index) => normalizeSlide(slide, index, topic));

  slides.forEach((slideData, idx) => {
    const ctx = { template, topic, index: idx + 1, totalSlides: slides.length };
    let slide;
    if (slideData.type === 'title' || slideData.type === 'cover') {
      slide = buildTitleSlide(pptx, slideData, ctx);
    } else if (slideData.type === 'two_column' || slideData.type === 'comparison') {
      slide = buildTwoColumnSlide(pptx, slideData, ctx);
    } else if (slideData.type === 'image' || slideData.type === 'visual') {
      slide = buildImageSlide(pptx, slideData, ctx);
    } else {
      slide = buildContentSlide(pptx, slideData, ctx);
    }
    if (slideData.notes) {
      slide.addNotes(normalizeText(slideData.notes));
    }
  });

  return { pptx, slides, template };
}

async function main() {
  const payloadPath = process.argv[2];
  if (!payloadPath) {
    throw new Error('Usage: node pptx-renderer.js <payload.json>');
  }
  const payload = readJson(payloadPath);
  if (!payload.output_path) {
    throw new Error('payload.output_path is required');
  }
  fs.mkdirSync(path.dirname(payload.output_path), { recursive: true });

  const { pptx, slides, template } = buildPresentation(payload);
  await pptx.writeFile({ fileName: payload.output_path });
  const stat = fs.statSync(payload.output_path);
  writeJson({
    ok: true,
    output_path: payload.output_path,
    mime_type: PPTX_MIME,
    size: stat.size,
    template: {
      id: payload.template || 'aetheria_modern',
      name: template.name,
      description: template.description,
    },
    slides: slides.map((slide, index) => ({
      index: index + 1,
      type: slide.type,
      title: slide.title,
      subtitle: normalizeText(slide.subtitle || slide.caption || '').slice(0, 180),
      bullets: cleanBullets(slide.bullets || slide.content || slide.points).slice(0, 4),
      has_chart: Boolean(slide.chart),
      has_table: Boolean(slide.table),
      has_diagram: Boolean(slide.nodes || slide.steps),
      metrics: Array.isArray(slide.metrics) ? slide.metrics.slice(0, 4) : [],
    })),
  });
}

main().catch((error) => {
  writeJson({ ok: false, error: error.message, stack: error.stack });
  process.exitCode = 1;
});
