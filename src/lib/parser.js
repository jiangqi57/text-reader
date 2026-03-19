export function normalizeText(text) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u0000/g, '')
    .trim();
}

function cleanText(raw) {
  if (!raw) return '';
  return raw
    .replace(/\t/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripLeadingPunctuation(text) {
  return (text || '')
    .replace(/^[\s,，.。:：;；!！?？、"'“”‘’《》〈〉（）()【】\[\]—\-]+/, '')
    .trim();
}

function shortenInlineTitle(text, maxLength = 28) {
  let title = cleanText(text);
  title = stripLeadingPunctuation(title);

  title = title.split(/[。！？；]/)[0].trim();

  if (title.length > 30) {
    title = title.split(/[，,]/)[0].trim();
  }

  title = stripLeadingPunctuation(title);

  if (title.length > maxLength) {
    title = `${title.slice(0, maxLength)}…`;
  }

  return title;
}

function parseDisplayTitle(line) {
  const trimmed = cleanText(line);

  const cnMatch = trimmed.match(
    /^(正文\s*)?(第[\d一二三四五六七八九十百千万零两〇]+[章节回卷部篇集])\s*(.*)$/i
  );

  if (cnMatch) {
    const numberPart = cleanText(cnMatch[2]);
    const restPart = stripLeadingPunctuation(cleanText(cnMatch[3] || ''));

    return {
      displayNumber: numberPart || '章节',
      displayTitle: restPart ? shortenInlineTitle(restPart) : '',
    };
  }

  const enMatch = trimmed.match(/^(chapter\s+\d+|chap\.\s*\d+)\s*(.*)$/i);

  if (enMatch) {
    const numberPart = cleanText(enMatch[1]);
    const restPart = stripLeadingPunctuation(cleanText(enMatch[2] || ''));

    return {
      displayNumber: numberPart || 'Chapter',
      displayTitle: restPart ? shortenInlineTitle(restPart) : '',
    };
  }

  return {
    displayNumber: '',
    displayTitle: shortenInlineTitle(trimmed) || '未命名章节',
  };
}

function buildDrawerTitle(displayNumber, displayTitle) {
  if (displayNumber && displayTitle) return `${displayNumber} ${displayTitle}`;
  if (displayNumber) return displayNumber;
  if (displayTitle) return displayTitle;
  return '未命名章节';
}

export function extractChapters(rawText) {
  const text = normalizeText(rawText);
  const lines = text.split('\n');

  const lineStarts = [];
  let cursor = 0;
  for (const line of lines) {
    lineStarts.push(cursor);
    cursor += line.length + 1;
  }

  const chapterLineRegex =
    /^(正文\s*)?(第[\d一二三四五六七八九十百千万零两〇]+[章节回卷部篇集].*|chapter\s+\d+.*|chap\.\s*\d+.*)$/i;

  const chapterMarkers = [];

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    if (chapterLineRegex.test(trimmed)) {
      const parsed = parseDisplayTitle(trimmed);

      chapterMarkers.push({
        title: buildDrawerTitle(parsed.displayNumber, parsed.displayTitle),
        displayNumber: parsed.displayNumber,
        displayTitle: parsed.displayTitle,
        start: lineStarts[index],
      });
    }
  });

  if (chapterMarkers.length === 0) {
    return [
      {
        title: '全文',
        displayNumber: '全文',
        displayTitle: '',
        start: 0,
        end: text.length,
        content: text,
      },
    ];
  }

  const chapters = chapterMarkers.map((marker, index) => {
    const end =
      index < chapterMarkers.length - 1
        ? chapterMarkers[index + 1].start
        : text.length;

    return {
      title: marker.title,
      displayNumber: marker.displayNumber,
      displayTitle: marker.displayTitle,
      start: marker.start,
      end,
      content: text.slice(marker.start, end).trim(),
    };
  });

  if (chapters[0].start > 0) {
    chapters.unshift({
      title: '前言/未识别部分',
      displayNumber: '前言',
      displayTitle: '未识别部分',
      start: 0,
      end: chapters[0].start,
      content: text.slice(0, chapters[0].start).trim(),
    });
  }

  return chapters;
}