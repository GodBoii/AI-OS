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

function isDarkTemplate(template) {
  const color = safeColor(template.background, 'FFFFFF');
  const r = parseInt(color.slice(0, 2), 16);
  const g = parseInt(color.slice(2, 4), 16);
  const b = parseInt(color.slice(4, 6), 16);
  return ((r * 299 + g * 587 + b * 114) / 1000) < 128;
}

function hexToRgb(color) {
  const safe = safeColor(color, '000000');
  return {
    r: parseInt(safe.slice(0, 2), 16),
    g: parseInt(safe.slice(2, 4), 16),
    b: parseInt(safe.slice(4, 6), 16),
  };
}

function rgbToHex({ r, g, b }) {
  return [r, g, b].map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')).join('').toUpperCase();
}

function mixColor(color, target, amount = 0.5) {
  const a = hexToRgb(color);
  const b = hexToRgb(target);
  return rgbToHex({
    r: a.r + (b.r - a.r) * amount,
    g: a.g + (b.g - a.g) * amount,
    b: a.b + (b.b - a.b) * amount,
  });
}

function slideType(slideData) {
  const raw = String(slideData.type || '').toLowerCase();
  if (raw === 'cover') return 'title';
  if (raw === 'comparison') return 'two_column';
  if (raw === 'visual') return 'image';
  if (raw === 'chart' || raw === 'table' || raw === 'diagram' || raw === 'process') return 'content';
  return raw || 'content';
}

function addBg(slide, template) {
  slide.background = { color: template.background };
}

function addDecorativeSystem(slide, template, variant = 'content') {
  const dark = isDarkTemplate(template);
  const wash = dark ? mixColor(template.surface, template.accent, 0.18) : mixColor(template.background, template.accent, 0.08);
  slide.addShape(currentPptx.ShapeType.rect, {
    x: 0, y: 0, w: 10, h: 5.625,
    fill: { color: template.background },
    line: { color: template.background },
  });
  slide.addShape(currentPptx.ShapeType.rect, {
    x: 0, y: 0, w: 10, h: variant === 'title' ? 0.16 : 0.1,
    fill: { color: template.accent },
    line: { color: template.accent },
  });
  slide.addShape(currentPptx.ShapeType.arc, {
    x: 7.42, y: -0.74, w: 2.94, h: 2.94,
    line: { color: template.accent, transparency: dark ? 32 : 42, width: variant === 'title' ? 3 : 1.6 },
  });
  slide.addShape(currentPptx.ShapeType.arc, {
    x: -0.82, y: 4.12, w: 1.9, h: 1.9,
    line: { color: template.accent2, transparency: dark ? 48 : 58, width: 1.4 },
  });
  if (variant !== 'title') {
    slide.addShape(currentPptx.ShapeType.rect, {
      x: 0, y: 0.1, w: 0.08, h: 5.525,
      fill: { color: wash, transparency: dark ? 12 : 0 },
      line: null,
    });
  }
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

function addSectionLabel(slide, text, template, opts = {}) {
  addKicker(slide, text, template);
  slide.addShape(currentPptx.ShapeType.line, {
    x: opts.x ?? 0.54, y: opts.y ?? 0.62, w: opts.w ?? 1.36, h: 0,
    line: { color: template.accent2, transparency: 18, width: 1.2 },
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

function addTextList(slide, bullets, template, opts = {}) {
  const items = cleanBullets(bullets).slice(0, opts.maxItems || 5);
  if (!items.length) return false;
  items.forEach((item, i) => {
    const y = (opts.y ?? 1.5) + i * (opts.rowH ?? 0.42);
    slide.addShape(currentPptx.ShapeType.ellipse, {
      x: opts.x ?? 0.72, y: y + 0.06, w: 0.11, h: 0.11,
      fill: { color: i % 3 === 0 ? template.accent : (i % 3 === 1 ? template.accent2 : template.accent3) },
      line: { color: i % 3 === 0 ? template.accent : (i % 3 === 1 ? template.accent2 : template.accent3) },
    });
    slide.addText(item, {
      x: (opts.x ?? 0.72) + 0.24, y, w: opts.w ?? 5.4, h: opts.h ?? 0.3,
      fontFace: template.fontFace, fontSize: opts.size ?? 10.4,
      color: template.ink, margin: 0.01, fit: 'shrink',
    });
  });
  return true;
}

function addInsightCards(slide, bullets, template, opts = {}) {
  const items = cleanBullets(bullets).slice(0, opts.maxItems || 3);
  if (!items.length) return false;
  const x = opts.x ?? 0.66;
  const y = opts.y ?? 1.58;
  const w = opts.w ?? 6.18;
  const cardH = opts.cardH ?? 0.74;
  const gap = opts.gap ?? 0.18;
  items.forEach((item, i) => {
    const cardY = y + i * (cardH + gap);
    const accent = i % 3 === 0 ? template.accent : (i % 3 === 1 ? template.accent2 : template.accent3);
    slide.addShape(currentPptx.ShapeType.roundRect, {
      x, y: cardY, w, h: cardH,
      rectRadius: 0.04,
      fill: { color: template.surface, transparency: isDarkTemplate(template) ? 8 : 0 },
      line: { color: accent, transparency: 58, width: 0.8 },
    });
    slide.addShape(currentPptx.ShapeType.rect, {
      x, y: cardY, w: 0.08, h: cardH,
      fill: { color: accent },
      line: { color: accent },
    });
    slide.addText(String(i + 1).padStart(2, '0'), {
      x: x + 0.22, y: cardY + 0.18, w: 0.42, h: 0.18,
      fontFace: template.headingFace, fontSize: 8.6, bold: true,
      color: accent, margin: 0,
    });
    slide.addText(item, {
      x: x + 0.76, y: cardY + 0.15, w: w - 0.96, h: cardH - 0.22,
      fontFace: template.fontFace, fontSize: 10,
      color: template.ink, margin: 0.02, fit: 'shrink',
    });
  });
  return true;
}

function addAbstractVisual(slide, template, opts = {}) {
  const x = opts.x ?? 7.02;
  const y = opts.y ?? 1.5;
  const w = opts.w ?? 2.28;
  const h = opts.h ?? 2.74;
  const dark = isDarkTemplate(template);
  slide.addShape(currentPptx.ShapeType.roundRect, {
    x, y, w, h,
    rectRadius: 0.06,
    fill: { color: dark ? mixColor(template.surface, template.accent, 0.1) : 'FFFFFF', transparency: dark ? 4 : 0 },
    line: { color: template.accent, transparency: 55, width: 0.8 },
  });
  const points = [
    [x + 0.42, y + 0.48, template.accent],
    [x + w - 0.44, y + 0.74, template.accent2],
    [x + 0.62, y + h - 0.72, template.accent3],
    [x + w - 0.62, y + h - 0.5, template.accent],
    [x + w / 2, y + h / 2, template.accent2],
  ];
  for (let i = 0; i < points.length - 1; i += 1) {
    const x1 = points[i][0] + 0.08;
    const y1 = points[i][1] + 0.08;
    const x2 = points[i + 1][0] + 0.08;
    const y2 = points[i + 1][1] + 0.08;

    const lx = Math.min(x1, x2);
    const ly = Math.min(y1, y2);
    const lw = Math.max(0.01, Math.abs(x2 - x1));
    const lh = Math.max(0.01, Math.abs(y2 - y1));

    const lineOpts = {
      x: lx,
      y: ly,
      w: lw,
      h: lh,
      line: { color: template.muted, transparency: 58, width: 0.8 },
    };
    if ((x2 - x1) * (y2 - y1) < 0) {
      lineOpts.flipH = true;
    }
    slide.addShape(currentPptx.ShapeType.line, lineOpts);
  }
  points.forEach(([px, py, color], i) => {
    slide.addShape(currentPptx.ShapeType.ellipse, {
      x: px, y: py, w: i === 4 ? 0.34 : 0.22, h: i === 4 ? 0.34 : 0.22,
      fill: { color },
      line: { color, transparency: 15 },
    });
  });
  slide.addShape(currentPptx.ShapeType.rect, {
    x: x + 0.26, y: y + h - 0.28, w: w - 0.52, h: 0.04,
    fill: { color: template.accent, transparency: 20 },
    line: null,
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

function parseChartData(chart) {
  if (!chart) return null;
  const chartData = chart.data || chart;
  if (!chartData) return null;

  // Case 1: 2D Array (e.g. [["Industry", "2024", "2028"], ["Healthcare", 15, 45]])
  if (Array.isArray(chartData) && chartData.length > 0 && Array.isArray(chartData[0])) {
    const headers = chartData[0];
    const rows = chartData.slice(1);
    if (headers.length < 2 || rows.length === 0) return null;

    const seriesCount = headers.length - 1;
    const labels = rows.map((row) => String(row[0] || ''));
    const seriesList = [];
    for (let col = 1; col <= seriesCount; col += 1) {
      const name = String(headers[col] || `Series ${col}`);
      const values = rows.map((row) => {
        const val = Number(row[col]);
        return isNaN(val) ? 0 : val;
      });
      seriesList.push({ name, labels, values });
    }
    return seriesList;
  }

  // Case 2: Array of objects (e.g. [{ name: "Actual", labels: [...], values: [...] }])
  if (Array.isArray(chartData) && chartData.length > 0 && typeof chartData[0] === 'object') {
    if (chartData[0].labels && chartData[0].values) {
      return chartData.map((s) => ({
        name: String(s.name || s.series || 'Series'),
        labels: Array.isArray(s.labels) ? s.labels.map(String) : [],
        values: Array.isArray(s.values) ? s.values.map(Number).map((v) => isNaN(v) ? 0 : v) : [],
      }));
    }

    // Case 3: Flat array of points (e.g. [{ label: "Healthcare", value: 15 }])
    const labels = chartData.map((item) => String(item.label || item.name || item.category || ''));
    const values = chartData.map((item) => {
      const val = Number(item.value || item.val || 0);
      return isNaN(val) ? 0 : val;
    });
    return [{
      name: String(chart.title || 'Value'),
      labels,
      values,
    }];
  }

  return null;
}

function addNativeChart(slide, chart, template, opts = {}) {
  if (!chart) return false;
  const chartData = parseChartData(chart);
  if (!chartData || chartData.length === 0) return false;

  const x = opts.x ?? 0.78;
  const y = opts.y ?? 1.82;
  const w = opts.w ?? 8.02;
  const h = opts.h ?? 2.8;

  const chartType = String(chart.chart_type || chart.type || 'bar').toLowerCase();
  let pptxChartType = currentPptx.ChartType.bar;
  if (chartType === 'line') pptxChartType = currentPptx.ChartType.line;
  else if (chartType === 'pie') pptxChartType = currentPptx.ChartType.pie;
  else if (chartType === 'doughnut') pptxChartType = currentPptx.ChartType.doughnut;
  else if (chartType === 'area') pptxChartType = currentPptx.ChartType.area;

  const colors = [template.accent, template.accent2, template.accent3];

  try {
    slide.addChart(pptxChartType, chartData, {
      x, y, w, h,
      title: chart.title || chart.name || '',
      showTitle: !!(chart.title || chart.name),
      titleColor: template.ink,
      titleFontFace: template.headingFace,
      titleFontSize: 11,
      chartColors: colors,
      showLegend: chartData.length > 1 || chartType === 'pie' || chartType === 'doughnut',
      legendColor: template.muted,
      legendFontFace: template.fontFace,
      legendFontSize: 8,
      catAxisLabelColor: template.muted,
      catAxisLabelFontFace: template.fontFace,
      catAxisLabelFontSize: 8,
      valAxisLabelColor: template.muted,
      valAxisLabelFontFace: template.fontFace,
      valAxisLabelFontSize: 8,
      barDir: chartType === 'bar' ? 'bar' : 'col',
    });
    return true;
  } catch (err) {
    console.error('Error adding native chart:', err);
    return false;
  }
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
        line: null,
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
  addDecorativeSystem(slide, template, 'title');
  slide.addShape(currentPptx.ShapeType.roundRect, {
    x: 6.82, y: 0.88, w: 2.64, h: 3.78,
    rectRadius: 0.08,
    fill: { color: template.surface, transparency: isDarkTemplate(template) ? 6 : 0 },
    line: { color: template.accent, transparency: 54, width: 1.0 },
  });
  addAbstractVisual(slide, template, { x: 7.02, y: 1.14, w: 2.22, h: 2.46 });
  slide.addText('AETHERIA', {
    x: 7.1, y: 3.88, w: 1.6, h: 0.18,
    fontFace: template.fontFace, fontSize: 6.2, bold: true,
    color: template.muted, charSpace: 1.2, margin: 0,
  });
  addSectionLabel(slide, slideData.kicker || 'Presentation', template);
  addTitle(slide, slideData.title || ctx.topic, template, { x: 0.58, y: 1.12, w: 5.92, h: 1.86, size: 33 });
  addSubtitle(slide, slideData.subtitle || slideData.content, template, { x: 0.62, y: 3.12, w: 5.42, h: 0.62, size: 12 });
  const titleMetrics = Array.isArray(slideData.metrics) && slideData.metrics.length
    ? slideData.metrics
    : cleanBullets(slideData.bullets || slideData.points).slice(0, 3).map((item, i) => ({
      value: `0${i + 1}`,
      label: item,
    }));
  addMetricRail(slide, titleMetrics, template, { x: 0.62, y: 4.18, w: 5.92, maxItems: 3 });
  return slide;
}

function buildContentSlide(pptx, slideData, ctx) {
  const slide = pptx.addSlide();
  const { template, index, totalSlides, topic } = ctx;
  addBg(slide, template);
  addDecorativeSystem(slide, template, 'content');
  addSectionLabel(slide, slideData.kicker || slideData.section || (slideData.chart ? 'Evidence' : slideData.table ? 'Data' : (slideData.nodes || slideData.steps) ? 'Process' : 'Insight'), template);
  addTitle(slide, slideData.title, template);

  const hasMetrics = Array.isArray(slideData.metrics) && slideData.metrics.length > 0;
  const chartDone = addNativeChart(slide, slideData.chart, template, { x: 0.78, y: 1.82, w: 8.02, h: hasMetrics ? 2.2 : 2.8 });
  const tableDone = !chartDone && addTable(slide, slideData.table, template, { x: 0.76, y: 1.76, w: 8.26, rowH: hasMetrics ? 0.32 : 0.38 });
  const diagramDone = !chartDone && !tableDone && addDiagram(slide, slideData.nodes || slideData.steps, template, { x: 0.78, y: 2.02, w: 8.22 });

  if (!chartDone && !tableDone && !diagramDone) {
    const sourceItems = slideData.bullets || slideData.content || slideData.points;
    const cardH = hasMetrics ? 0.52 : 0.62;
    const gap = hasMetrics ? 0.1 : 0.14;
    const yStart = hasMetrics ? 1.48 : 1.68;
    const visualH = hasMetrics ? 2.10 : 2.46;
    const calloutY = hasMetrics ? 3.68 : 4.10;
    const calloutH = hasMetrics ? 0.3 : 0.36;

    const cardsDone = addInsightCards(slide, sourceItems, template, { x: 0.68, y: yStart, w: 6.06, maxItems: hasMetrics ? 3 : 4, cardH, gap });
    if (!cardsDone) {
      addTextList(slide, sourceItems, template, { x: 0.78, y: yStart, w: 5.8, maxItems: hasMetrics ? 4 : 5 });
    }
    addAbstractVisual(slide, template, { x: 7.06, y: yStart, w: 2.2, h: visualH });
    slide.addText(normalizeText(slideData.callout || slideData.summary || cleanBullets(sourceItems)[0] || 'Key idea'), {
      x: 7.18, y: calloutY, w: 1.96, h: calloutH,
      fontFace: template.headingFace, fontSize: hasMetrics ? 9.5 : 10.5, bold: true,
      color: template.accent, margin: 0.01, fit: 'shrink',
      align: 'center',
    });
  }
  if (hasMetrics) {
    addMetricRail(slide, slideData.metrics, template, { x: 0.66, y: 4.18, w: 8.65, maxItems: 4, h: 0.54 });
  }
  addFooter(slide, template, index, totalSlides, topic);
  return slide;
}

function buildTwoColumnSlide(pptx, slideData, ctx) {
  const slide = pptx.addSlide();
  const { template, index, totalSlides, topic } = ctx;
  addBg(slide, template);
  addDecorativeSystem(slide, template, 'content');
  addSectionLabel(slide, slideData.kicker || 'Comparison', template);
  addTitle(slide, slideData.title, template);

  const leftTitle = slideData.left_title || slideData.left?.title || 'Current state';
  const rightTitle = slideData.right_title || slideData.right?.title || 'Target state';
  const fallbackItems = cleanBullets(slideData.bullets || slideData.content || slideData.points);
  const midpoint = Math.ceil(fallbackItems.length / 2);
  const leftContent = slideData.left_content || slideData.left_bullets || slideData.left?.content || slideData.left?.bullets || fallbackItems.slice(0, midpoint);
  const rightContent = slideData.right_content || slideData.right_bullets || slideData.right?.content || slideData.right?.bullets || fallbackItems.slice(midpoint);
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
    slide.addShape(currentPptx.ShapeType.rect, {
      x: col.x, y: 1.64, w: 4.08, h: 0.12,
      fill: { color: col.color },
      line: { color: col.color },
    });
    slide.addText(col.title, {
      x: col.x + 0.24, y: 1.9, w: 3.58, h: 0.28,
      fontFace: template.fontFace, fontSize: 10.6, bold: true,
      color: col.color, margin: 0, fit: 'shrink',
    });
    if (!addTextList(slide, col.content, template, {
      x: col.x + 0.28, y: 2.34, w: 3.34, rowH: 0.36, size: 8.8, maxItems: 5,
    })) {
      slide.addText('No comparison details provided', {
        x: col.x + 0.32, y: 2.42, w: 3.28, h: 0.3,
        fontFace: template.fontFace, fontSize: 8.4, italic: true,
        color: template.muted, margin: 0,
      });
    }
  });
  addFooter(slide, template, index, totalSlides, topic);
  return slide;
}

function buildImageSlide(pptx, slideData, ctx) {
  const slide = pptx.addSlide();
  const { template, index, totalSlides, topic } = ctx;
  addBg(slide, template);
  addDecorativeSystem(slide, template, 'content');
  addSectionLabel(slide, slideData.kicker || 'Visual', template);
  addTitle(slide, slideData.title, template);
  addSubtitle(slide, slideData.caption || slideData.content, template, { x: 0.76, y: 4.44, w: 8.5, size: 8.8 });
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
    addAbstractVisual(slide, template, { x: 1.18, y: 1.9, w: 2.3, h: 1.86 });
    addInsightCards(slide, slideData.bullets || slideData.points || slideData.content, template, { x: 3.78, y: 1.92, w: 5.08, maxItems: 3, cardH: 0.48, gap: 0.12 });
    slide.addText(normalizeText(slideData.visual_summary || slideData.summary || 'Visual focus'), {
      x: 1.08, y: 3.88, w: 7.76, h: 0.28,
      fontFace: template.headingFace, fontSize: 13,
      color: template.accent, bold: true, align: 'center',
      margin: 0.01, fit: 'shrink',
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
  if ((normalized.type === 'chart' || normalized.type === 'evidence') && !normalized.chart) {
    normalized.chart = normalized.data ? { title: normalized.chart_title || normalized.title, data: normalized.data } : normalized.chart;
  }
  if ((normalized.type === 'diagram' || normalized.type === 'process') && !(normalized.nodes || normalized.steps)) {
    normalized.nodes = cleanBullets(normalized.bullets || normalized.content || normalized.points).slice(0, 5).map((item) => ({ title: item }));
  }
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
    const kind = slideType(slideData);
    if (kind === 'title') {
      slide = buildTitleSlide(pptx, slideData, ctx);
    } else if (kind === 'two_column') {
      slide = buildTwoColumnSlide(pptx, slideData, ctx);
    } else if (kind === 'image') {
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
      colors: {
        background: template.background,
        surface: template.surface,
        ink: template.ink,
        muted: template.muted,
        accent: template.accent,
        accent2: template.accent2,
        accent3: template.accent3,
      },
    },
    slides: slides.map((slide, index) => ({
      index: index + 1,
      type: slide.type,
      layout: slideType(slide),
      title: slide.title,
      subtitle: normalizeText(slide.subtitle || slide.caption || '').slice(0, 180),
      bullets: cleanBullets(slide.bullets || slide.content || slide.points).slice(0, 4),
      has_chart: Boolean(slide.chart),
      has_table: Boolean(slide.table),
      has_diagram: Boolean(slide.nodes || slide.steps),
      has_visual: slideType(slide) === 'image' || Boolean(slide.image_path || slide.imagePath),
      metrics: Array.isArray(slide.metrics) ? slide.metrics.slice(0, 4) : [],
    })),
  });
}

main().catch((error) => {
  writeJson({ ok: false, error: error.message, stack: error.stack });
  process.exitCode = 1;
});
