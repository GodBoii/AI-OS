// Distinct composition systems. Geometry remains shared by browser and Office.
const DESIGN_PROFILES = require('./presentation_design_profiles.json');

function applyDesignChrome(spec, t, rect) {
  const get = (id) => spec.objects.find(o => o.id === id);
  const top = get('top-rule');
  const kicker = get('kicker');
  const footer = get('footer-rule');
  const headline = get('headline');
  if (t.id === 'venture_blueprint') {
    top.w = 360; top.h = 8;
    if (kicker) { kicker.x = 96; kicker.y = 42; }
    rect('journal-edge', 1856, 96, 12, 876, t.accent2);
  } else if (t.id === 'aetheria_modern') {
    top.w = 1728; top.h = 3; top.y = 105;
    if (kicker) { kicker.x = 96; kicker.y = 56; }
  } else if (t.id === 'executive') {
    top.w = 1728; top.y = 106;
    if (kicker) { kicker.x = 96; kicker.w = 1728; kicker.style.align = 'center'; }
    footer.h = 3;
  } else if (t.id === 'startup_pitch') {
    top.x = 0; top.y = 0; top.w = 1920; top.h = 20;
    footer.w = 90; footer.h = 8;
  } else if (t.id === 'academic') {
    top.w = 1728; top.h = 1; top.y = 106;
    if (kicker) { kicker.x = 96; kicker.style.fontFace = 'Arial'; }
    if (headline && !['title', 'section'].includes(spec.type)) headline.style.fontSizePt = 33;
  } else if (t.id === 'creative_portfolio') {
    top.w = 1728; top.h = 8; top.style.fill = t.ink;
    if (kicker) kicker.y = 42;
    if (headline) headline.style.italic = true;
    footer.style.fill = t.ink;
  } else if (t.id === 'minimal_zen') {
    spec.objects = spec.objects.filter(o => !['top-rule', 'footer-rule'].includes(o.id));
    if (kicker) { kicker.x = 96; kicker.w = 1728; kicker.style.align = 'center'; kicker.style.bold = false; }
    if (headline) { headline.style.bold = false; headline.style.align = 'center'; }
  } else if (t.id === 'tech_dark') {
    top.w = 1728; top.h = 1;
    rect('terminal-edge', 64, 120, 3, 830, t.accent);
    if (kicker) { kicker.y = 42; kicker.style.letterSpacing = 1; }
    if (headline) headline.style.bold = false;
  } else if (t.id === 'corporate_gradient') {
    top.x = 0; top.y = 0; top.w = 1920; top.h = 116;
    if (kicker) { kicker.x = 96; kicker.style.color = 'FFFFFF'; }
    rect('corporate-edge', 0, 116, 28, 964, t.accent);
  }
}

function buildDesignedSlide(data, index, ctx, h) {
  const t = ctx.template;
  const { spec, text, rect, rule, list, image, readableColor } = h;
  const accent = readableColor(t, t.accent, t.background);
  const muted = readableColor(t, t.muted, t.background);
  const title = (x, y, w, height, size, extra = {}) => text('headline', data.title, x, y, w, height, size,
    { fontFace: t.headingFace, bold: true, ...extra });
  const subtitle = (x, y, w, height, extra = {}) => text('subtitle', data.subtitle, x, y, w, height, 19,
    { color: muted, ...extra });
  const bullets = Array.isArray(data.bullets) ? data.bullets : String(data.content || data.points || '').split(/\n|;/).filter(Boolean);
  const hero = Boolean(data.image_path || data.imagePath);
  const portrait = (x, y, w, height) => image('cover-image', x, y, w, height);
  const coverMetrics = () => {
    const metrics = data.metrics || [];
    const width = 1728 / Math.max(metrics.length, 1);
    metrics.forEach((m, i) => {
      const x = 96 + i * width;
      text(`metric-value-${i}`, String(m.value), x, 811, width - 40, 74, 24, { bold: true, color: accent });
      text(`metric-label-${i}`, m.label, x, 888, width - 40, 60, 12, { color: muted });
    });
  };

  if (['title', 'section'].includes(spec.type)) {
    if (t.id === 'venture_blueprint') {
      text('cover-label', 'THE VENTURE JOURNAL', 96, 160, 970, 46, 13, { bold: true, color: accent });
      title(96, 240, 970, 354, 43);
      subtitle(96, 623, 950, 152);
      if (hero) portrait(1140, 170, 660, 600);
      else {
        rect('venture-plate', 1140, 170, 660, 600, t.accent);
        text('venture-folio', String(index).padStart(2, '0'), 1220, 290, 500, 230, 82, { fontFace: 'Georgia', color: 'FFFFFF' });
        rule('venture-plate-rule', 1220, 606, 480, t.accent2);
      }
    } else if (t.id === 'aetheria_modern') {
      title(96, 230, hero ? 1010 : 1700, 330, hero ? 45 : 55, { bold: false });
      subtitle(96, 639, hero ? 1000 : 1450, 130);
      if (hero) portrait(1210, 255, 614, 500);
      else if (!data.metrics?.length) rect('swiss-block', 96, 832, 1728, 54, t.accent);
    } else if (t.id === 'executive') {
      text('cover-label', 'BOARD MEMORANDUM', 96, 170, 1728, 42, 12, { align: 'center', color: accent });
      if (hero) {
        title(170, 240, 1580, 238, 44, { align: 'center' });
        subtitle(280, 504, 1360, 90, { align: 'center' });
        portrait(510, 610, 900, data.metrics?.length ? 170 : 302);
      } else {
        title(170, 340, 1580, 260, 47, { align: 'center' });
        subtitle(270, 656, 1380, 126, { align: 'center' });
        rule('executive-hairline', 690, 284, 540, t.accent);
      }
    } else if (t.id === 'startup_pitch') {
      text('cover-label', 'BUILD WHAT COMES NEXT', 96, 148, 1500, 48, 15, { bold: true, color: accent });
      title(96, 249, hero ? 1080 : 1700, 363, hero ? 43 : 57);
      subtitle(96, 667, hero ? 1080 : 1520, 120, { color: t.ink });
      if (hero) portrait(1280, 264, 544, 470);
      else rule('pitch-rule', 96, 774, 440, t.accent2);
    } else if (t.id === 'academic') {
      text('cover-label', 'RESEARCH BRIEFING', 96, 168, 1700, 48, 13, { color: accent, fontFace: 'Arial' });
      title(96, 276, hero ? 1000 : 1630, 327, hero ? 42 : 49, { bold: false });
      subtitle(96, 662, hero ? 1000 : 1520, 128, { fontFace: 'Arial' });
      if (hero) portrait(1160, 285, 640, 463);
      rule('research-rule', 96, 225, 1728);
    } else if (t.id === 'creative_portfolio') {
      text('poster-folio', String(index).padStart(2, '0'), 96, 184, 300, 176, 71, { fontFace: 'Georgia', color: t.ink });
      title(460, 205, 1320, 360, 49, { italic: true });
      subtitle(96, 639, hero ? 920 : 1520, 148, { color: t.ink });
      if (hero) portrait(1130, 594, 694, data.metrics?.length ? 182 : 310);
      else rect('poster-stripe', 96, 475, 282, 78, t.accent2);
    } else if (t.id === 'minimal_zen') {
      if (hero) {
        portrait(96, 207, 760, 566);
        title(985, 312, 815, 300, 38, { bold: false });
        subtitle(985, 663, 815, 123);
      } else {
        title(180, 380, 1560, 270, 46, { align: 'center', bold: false });
        subtitle(360, 699, 1200, 90, { align: 'center' });
      }
    } else if (t.id === 'tech_dark') {
      text('terminal-label', `// BRIEF_${String(index).padStart(2, '0')}`, 116, 173, 1620, 50, 15, { color: accent });
      title(116, 289, hero ? 1000 : 1620, 310, hero ? 37 : 45, { bold: false });
      subtitle(116, 660, hero ? 1000 : 1500, 126);
      if (hero) portrait(1240, 255, 560, 492);
      else {
        rule('terminal-bottom-rule', 116, 770, 1570, t.accent);
        text('terminal-end', '[ END OF BRIEF ]', 1260, 789, 425, 22, 9, { color: accent });
      }
    } else {
      if (hero) {
        rect('commercial-title-band', 28, 167, 1100, 590, t.accent);
        title(116, 239, 912, 340, 42, { color: 'FFFFFF' });
        subtitle(116, 634, 912, 100, { color: 'FFFFFF' });
        portrait(1188, 202, 636, 540);
      } else {
        rect('commercial-title-band', 28, 167, 1892, 430, t.accent);
        title(116, 239, 1600, 315, 49, { color: 'FFFFFF' });
        subtitle(116, 656, 1530, 120);
      }
    }
    if (data.metrics?.length) coverMetrics();
    return true;
  }

  if (spec.type === 'content') {
    title(96, 142, 1728, 170, 34, { bold: !['quiet', 'terminal'].includes(t.contentLayout) });
    const start = data.subtitle ? 439 : 363;
    if (data.subtitle) subtitle(96, 309, 1700, 96);
    const count = bullets.length;
    const bodyBottom = data.callout ? 828 : 914;
    const mode = t.contentLayout;
    if (mode === 'rail') {
      const headline = spec.objects.find(o => o.id === 'headline');
      Object.assign(headline, { x: 96, y: 165, w: 645, h: 490 });
      headline.style.fontSizePt = 35;
      const sub = spec.objects.find(o => o.id === 'subtitle');
      if (sub) Object.assign(sub, { x: 96, y: 665, w: 645, h: 220 });
      rect('journal-divider', 785, 164, 3, 745, t.grid);
      list('insight', bullets, 850, 353, 960, bodyBottom - 353, 21);
    } else if (mode === 'tiles' || mode === 'cards') {
      const cols = count > 1 ? 2 : 1;
      const rows = Math.ceil(count / cols);
      const width = (1728 - 36 * (cols - 1)) / cols;
      const height = (bodyBottom - start - 28 * (rows - 1)) / rows;
      bullets.forEach((item, i) => {
        const x = 96 + (i % cols) * (width + 36);
        const y = start + Math.floor(i / cols) * (height + 28);
        rect(`tile-${i}`, x, y, width, height, mode === 'cards' ? t.surface : t.surface,
          { line: t.grid, lineWidth: mode === 'cards' ? 1 : 0 });
        if (mode === 'cards') rect(`tile-band-${i}`, x, y, 12, height, t.accent);
        text(`tile-index-${i}`, String(i + 1).padStart(2, '0'), x + 32, y + 18, width - 64, 44, 15, { color: accent, bold: true });
        text(`insight-text-${i}`, item, x + 32, y + 80, width - 64, height - 96, 21);
      });
    } else if (mode === 'poster') {
      const width = 1728 / Math.max(count, 1);
      bullets.forEach((item, i) => {
        const x = 96 + i * width;
        text(`poster-index-${i}`, String(i + 1).padStart(2, '0'), x, start, width - 34, 124, 45,
          { fontFace: 'Georgia', italic: true });
        text(`insight-text-${i}`, item, x, start + 145, width - 34, bodyBottom - start - 145, count > 3 ? 18 : 20);
      });
    } else if (mode === 'terminal') {
      bullets.forEach((item, i) => {
        const rowH = (bodyBottom - start) / Math.max(count, 1);
        rect(`terminal-row-${i}`, 96, start + i * rowH, 1728, rowH - 20, t.surface, { line: t.grid, lineWidth: 1 });
        text(`terminal-index-${i}`, `0${i + 1} >`, 126, start + i * rowH + 21, 154, 58, 17, { color: accent });
        text(`insight-text-${i}`, item, 300, start + i * rowH + 20, 1475, rowH - 36, 21);
      });
    } else if (mode === 'stack') {
      bullets.forEach((item, i) => {
        const rowH = (bodyBottom - start) / Math.max(count, 1);
        text(`pitch-index-${i}`, String(i + 1), 96, start + i * rowH, 116, rowH - 16, 32, { fontFace: 'Arial Black', color: accent });
        text(`insight-text-${i}`, item, 254, start + i * rowH + 9, 1500, rowH - 24, 24, { bold: true });
      });
    } else if (mode === 'quiet') {
      bullets.forEach((item, i) => {
        const rowH = (bodyBottom - start) / Math.max(count, 1);
        text(`insight-text-${i}`, item, 260, start + i * rowH, 1400, rowH - 18, 25, { align: 'center' });
      });
    } else {
      list('insight', bullets, mode === 'paper' ? 164 : 96, start, mode === 'paper' ? 1580 : 1728, bodyBottom - start, 23);
      if (mode === 'memo') rect('memo-margin', 96, start - 26, 1728, 3, t.accent);
    }
    if (data.callout) {
      rule('takeaway-rule', 96, 851, 1728, t.accent);
      text('takeaway', data.callout, 96, 876, 1728, 74, 20, { bold: true, color: accent });
    }
    return true;
  }

  if (spec.type === 'image') {
    title(96, 142, 1728, 158, 34);
    const copyLeft = ['venture_blueprint', 'academic', 'tech_dark'].includes(t.id);
    const x = copyLeft && bullets.length ? 864 : 96;
    const width = bullets.length ? (copyLeft ? 960 : 1100) : 1728;
    image('image', x, 348, width, 550);
    if (bullets.length) list('image-copy', bullets, copyLeft ? 96 : 1260, 376, copyLeft ? 706 : 564, 514, 19);
    text('caption', data.caption, 96, 913, 1728, 35, 12, { color: muted });
    return true;
  }
  return false;
}

module.exports = { DESIGN_PROFILES, buildDesignedSlide, applyDesignChrome };
