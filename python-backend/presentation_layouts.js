// All layouts use the same editable objects for browser previews and PowerPoint.
const fs = require('node:fs');

function buildProfessionalSlide(data, index, ctx, api) {
  const { template: t, topic, totalSlides } = ctx;
  const { createSlideSpec, addObject, readableColor, mixColor } = api;
  const spec = createSlideSpec(data, index, ctx);
  const type = spec.type;
  const text = (id, value, x, y, w, h, size = 20, extra = {}) => {
    if (value === undefined || value === null || value === '') return;
    addObject(spec, { id, type: 'textbox', x, y, w, h, z: 3, text: value,
      style: { fontFace: t.fontFace, fontSizePt: size, color: t.ink, lineHeight: 1.12, ...extra } });
  };
  const rect = (id, x, y, w, h, fill, extra = {}) => addObject(spec, {
    id, type: 'shape', x, y, w, h, z: 1, protected: false,
    style: { shape: 'rect', fill, ...extra },
  });
  const rule = (id, x, y, w, color = t.grid) => rect(id, x, y, w, 2, color);
  const accent = readableColor(t, t.accent, t.background);
  const muted = readableColor(t, t.muted, t.background);
  const bg = rect('background', 0, 0, 1920, 1080, t.background);
  bg.decorative = true;
  bg.z = 0;
  rule('top-rule', 96, 82, 90, t.accent);
  text('kicker', data.kicker || data.section || '', 212, 62, 1450, 32, 11, { bold: true, color: muted });
  rule('footer-rule', 96, 998, 1728);
  text('footer-topic', topic, 96, 1016, 1500, 30, 9, { color: muted });
  text('page', `${index} / ${totalSlides}`, 1660, 1016, 164, 30, 9, { color: muted, align: 'right' });

  const items = (value) => Array.isArray(value) ? value : String(value || '').split(/\n|;/).filter(Boolean);
  const bodyItems = items(data.bullets || data.content || data.points);
  const heading = (x = 96, y = 140, w = 1728, h = 158, size = 34) =>
    text('headline', data.title, x, y, w, h, size, { bold: true, fontFace: t.headingFace });
  const subtitle = (x = 96, y = 309, w = 1650, h = 96) =>
    text('subtitle', data.subtitle, x, y, w, h, 19, { color: muted });
  const source = () => text('source', data.source, 96, 952, 1728, 42, 9, { color: muted });
  const list = (prefix, values, x, y, w, areaH, size = 21) => {
    const rowH = areaH / Math.max(values.length, 1);
    values.forEach((item, i) => {
      text(`${prefix}-index-${i}`, String(i + 1).padStart(2, '0'), x, y + i * rowH + 4, 65, 42, 13,
        { bold: true, color: accent });
      text(`${prefix}-text-${i}`, item, x + 90, y + i * rowH, w - 90, rowH - 20, size);
      if (i < values.length - 1) rule(`${prefix}-rule-${i}`, x + 90, y + (i + 1) * rowH - 14, w - 90);
    });
  };
  const metricGrid = (metrics, y = 465, height = 335) => {
    const width = 1728 / metrics.length;
    metrics.forEach((metric, i) => {
      const x = 96 + i * width;
      if (i) rect(`metric-rule-${i}`, x - 22, y, 2, height, t.grid);
      text(`metric-value-${i}`, String(metric.value), x, y + 22, width - 42, 146,
        metrics.length > 3 ? 36 : 44, { bold: true, color: accent, fontFace: t.headingFace });
      text(`metric-label-${i}`, metric.label, x, y + 196, width - 42, 100, 18, { color: muted });
    });
  };

  if (type === 'title' || type === 'section') {
    text('cover-number', type === 'section' ? String(index).padStart(2, '0') : '01',
      96, 167, 360, 78, 28, { color: accent, bold: true });
    heading(96, 290, 1580, 290, type === 'section' ? 48 : 52);
    subtitle(102, 646, 1420, 142);
    if (data.metrics?.length) metricGrid(data.metrics, 817, 105);
    // Cover metrics use compact treatment to leave room for the footer.
    if (data.metrics?.length) {
      spec.objects.filter((o) => o.id.startsWith('metric-value')).forEach((o) => { o.y = 817; o.h = 62; o.style.fontSizePt = 24; });
      spec.objects.filter((o) => o.id.startsWith('metric-label')).forEach((o) => { o.y = 896; o.h = 54; o.style.fontSizePt = 12; });
    }
    rect('cover-accent', 1738, 302, 86, 276, t.accent);
  } else if (type === 'two_column') {
    heading();
    const columns = [
      { x: 96, title: data.left_title, values: items(data.left_content || data.left), color: t.accent },
      { x: 992, title: data.right_title, values: items(data.right_content || data.right), color: t.accent2 },
    ];
    columns.forEach((col, i) => {
      rect(`panel-${i}`, col.x, 352, 832, 559, mixColor(t.background, col.color, 0.045));
      rule(`panel-accent-${i}`, col.x, 352, 832, col.color);
      text(`panel-title-${i}`, col.title, col.x + 36, 390, 760, 106, 24, { bold: true });
      list(`panel-list-${i}`, col.values, col.x + 36, 520, 750, 359, 19);
    });
  } else if (type === 'metrics') {
    heading(); subtitle(); metricGrid(data.metrics);
    text('callout', data.callout, 96, 852, 1650, 90, 21, { color: accent, bold: true });
  } else if (type === 'chart') {
    heading();
    const chart = data.chart;
    const points = chart.data;
    const values = points.map((p) => p.value);
    const min = Math.min(0, ...values);
    const max = Math.max(0, ...values);
    const range = max - min || 1;
    const format = (v) => String(Number(v.toPrecision(5)));
    const plot = { x: 400, y: 382, w: data.callout ? 810 : 1240, h: 482 };
    if (data.callout) {
      rule('chart-callout-rule', 1426, 382, 398, t.accent);
      text('chart-callout', data.callout, 1426, 422, 398, 352, 23, { bold: true });
    }
    if (chart.type === 'bar' || !chart.type) {
      const zero = plot.x + ((0 - min) / range) * plot.w;
      const rowH = plot.h / points.length;
      rect('zero-axis', zero, plot.y, 2, plot.h, t.grid);
      points.forEach((p, i) => {
        const endpoint = plot.x + ((p.value - min) / range) * plot.w;
        const y = plot.y + i * rowH;
        text(`chart-label-${i}`, p.label, 96, y + 4, 280, rowH - 12, 15, { color: muted });
        if (p.value !== 0) rect(`bar-${i}`, Math.min(zero, endpoint), y + 8,
          Math.max(2, Math.abs(endpoint - zero)), Math.min(rowH - 22, 42), t.accent);
        text(`chart-value-${i}`, format(p.value), plot.x + plot.w + 18, y + 4, 122, rowH - 12, 16, { bold: true });
      });
    } else {
      // Column and line charts share the same scales and labels in both exports.
      const zeroY = plot.y + plot.h - ((0 - min) / range) * plot.h;
      const valueY = (v) => plot.y + plot.h - ((v - min) / range) * plot.h;
      const step = plot.w / points.length;
      for (let tick = 0; tick <= 4; tick += 1) {
        const v = min + range * tick / 4;
        const y = valueY(v);
        rule(`grid-${tick}`, plot.x, y, plot.w);
        text(`axis-${tick}`, format(v), 188, y - 16, 186, 38, 12, { color: muted, align: 'right' });
      }
      points.forEach((p, i) => {
        const x = plot.x + step * (i + 0.5);
        const y = valueY(p.value);
        if (chart.type === 'column' && p.value !== 0) rect(`column-${i}`, x - step * 0.3,
          Math.min(y, zeroY), step * 0.6, Math.max(2, Math.abs(y - zeroY)), t.accent);
        if (chart.type === 'line') {
          addObject(spec, { id: `point-${i}`, type: 'shape', x: x - 7, y: y - 7, w: 14, h: 14,
            z: 2, protected: false, style: { shape: 'ellipse', fill: t.accent } });
          if (i > 0) {
            const lastY = valueY(points[i - 1].value);
            addObject(spec, { id: `line-${i}`, type: 'shape', x: x - step, y: Math.min(y, lastY),
              w: step, h: Math.abs(y - lastY), z: 2, protected: false,
              style: { shape: 'line', line: t.accent, lineWidth: 2.5, flipH: y < lastY } });
          }
        }
        text(`chart-label-${i}`, p.label, x - step / 2 + 6, plot.y + plot.h + 26, step - 12, 58, 12,
          { align: 'center', color: muted });
      });
    }
    text('chart-subtitle', data.subtitle || chart.title, 96, 308, 1728, 48, 16, { color: muted });
  } else if (type === 'table') {
    heading();
    const rows = data.table;
    const rowH = 560 / rows.length;
    const colW = 1728 / rows[0].length;
    rows.forEach((row, r) => {
      rect(`row-${r}`, 96, 354 + r * rowH, 1728, rowH, r === 0 ? t.accent : r % 2 ? t.surface : t.background);
      row.forEach((cell, c) => text(`cell-${r}-${c}`, String(cell), 118 + c * colW,
        370 + r * rowH, colW - 44, rowH - 30, rows.length > 5 ? 15 : 18,
        { bold: r === 0, color: r === 0 ? readableColor(t, 'FFFFFF', t.accent) : t.ink }));
      if (r > 0) rule(`row-rule-${r}`, 96, 354 + (r + 1) * rowH, 1728);
    });
  } else if (type === 'diagram') {
    heading(); subtitle();
    const nodes = data.steps || data.nodes;
    const stepW = 1728 / nodes.length;
    nodes.forEach((node, i) => {
      const x = 96 + i * stepW;
      rule(`step-rule-${i}`, x, 462, stepW - 34, t.accent);
      text(`step-index-${i}`, String(i + 1).padStart(2, '0'), x, 497, stepW - 34, 74, 25, { color: accent, bold: true });
      text(`step-title-${i}`, typeof node === 'string' ? node : node.title, x, 604, stepW - 34, 148, 21, { bold: true });
      text(`step-detail-${i}`, node.detail || node.description, x, 770, stepW - 34, 148, 15, { color: muted });
    });
  } else if (type === 'image') {
    heading();
    const imagePath = data.image_path || data.imagePath;
    if (!fs.existsSync(imagePath)) throw new Error(`Slide ${index}: image does not exist: ${imagePath}`);
    addObject(spec, { id: 'image', type: 'image', x: 96, y: 348, w: bodyItems.length ? 1100 : 1728,
      h: 550, z: 2, data: { imagePath }, style: {} });
    if (bodyItems.length) list('image-copy', bodyItems, 1260, 370, 564, 518, 19);
    text('caption', data.caption, 96, 913, 1728, 35, 12, { color: muted });
  } else if (type === 'closing') {
    heading(96, 171, 1640, 230, 42);
    list('closing', bodyItems, 96, 462, 1570, 344, 24);
    if (data.callout) {
      rule('closing-rule', 96, 841, 1728, t.accent);
      text('closing-ask', data.callout, 96, 870, 1650, 74, 22, { bold: true, color: accent });
    }
  } else {
    heading(); subtitle();
    list('insight', bodyItems, 96, data.subtitle ? 452 : 362, data.callout ? 1120 : 1640,
      data.subtitle ? 460 : 550, 23);
    if (data.callout) {
      rule('takeaway-rule', 1356, 452, 468, t.accent);
      text('takeaway', data.callout, 1356, 492, 468, 352, 25, { bold: true });
    }
    if (data.metrics?.length) throw new Error(`Slide ${index}: use a metrics slide to keep numbers readable.`);
  }
  source();
  return spec;
}

module.exports = { buildProfessionalSlide };
