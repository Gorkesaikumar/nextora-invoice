import { inflateSync } from 'node:zlib';

/**
 * Text extraction for the PDFs this application generates.
 *
 * pdf-lib writes every object into a compressed object stream and encodes text
 * as glyph codes, so a byte search proves nothing about what a client actually
 * reads. Each embedded subset font carries a ToUnicode CMap, which this module
 * uses to recover the visible text and the position it was drawn at.
 *
 * It intentionally supports only the structures pdf-lib emits (FlateDecode
 * streams, hex strings, Td/TD/Tm positioning) instead of pretending to be a
 * general purpose PDF parser.
 */

const hexToString = hex => {
  const digits = hex.replace(/\s+/g, '');
  const padded = digits.length % 4 ? digits.padEnd(digits.length + (4 - (digits.length % 4)), '0') : digits;
  const buffer = Buffer.from(padded, 'hex');
  buffer.swap16();
  return buffer.toString('utf16le');
};

const inflate = body => {
  const bytes = Buffer.from(body, 'latin1');
  try {
    return inflateSync(bytes).toString('latin1');
  } catch {
    return null;
  }
};

function parseCMap(content) {
  const map = new Map();
  for (const block of content.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      map.set(parseInt(pair[1], 16), hexToString(pair[2]));
    }
  }
  for (const block of content.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const entry of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]+)>|\[([\s\S]*?)\])/g)) {
      const from = parseInt(entry[1], 16);
      const to = parseInt(entry[2], 16);
      if (entry[3]) {
        const start = parseInt(entry[3], 16);
        for (let code = from; code <= to; code += 1) map.set(code, String.fromCodePoint(start + (code - from)));
      } else if (entry[4]) {
        [...entry[4].matchAll(/<([0-9A-Fa-f]+)>/g)].forEach((value, index) => map.set(from + index, hexToString(value[1])));
      }
    }
  }
  return map;
}

/** Every object in the file, including the ones stored inside object streams. */
function readObjects(raw) {
  const objects = new Map();
  const streams = [];
  for (const match of raw.matchAll(/(\d+)\s+0\s+obj([\s\S]*?)endobj/g)) {
    const number = Number(match[1]);
    const body = match[2];
    objects.set(number, body);
    const stream = body.match(/stream\r?\n([\s\S]*?)\r?\nendstream/);
    if (stream) streams.push({ number, dictionary: body, content: inflate(stream[1]) });
  }
  for (const item of streams) {
    if (!/\/Type\s*\/ObjStm/.test(item.dictionary) || !item.content) continue;
    const count = Number(item.dictionary.match(/\/N\s+(\d+)/)?.[1] || 0);
    const first = Number(item.dictionary.match(/\/First\s+(\d+)/)?.[1] || 0);
    const header = item.content.slice(0, first).trim().split(/\s+/).map(Number);
    for (let index = 0; index < count; index += 1) {
      const number = header[index * 2];
      const offset = header[index * 2 + 1];
      const next = index + 1 < count ? header[(index + 1) * 2 + 1] : item.content.length - first;
      objects.set(number, item.content.slice(first + offset, first + next));
    }
  }
  return { objects, streams };
}

/** Page number -> { width, height, text, runs, positions }. */
export function extractPdf(bytes) {
  const raw = Buffer.from(bytes).toString('latin1');
  const { objects, streams } = readObjects(raw);

  const cmaps = new Map();
  for (const [number, body] of objects) {
    const reference = body.match(/\/ToUnicode\s+(\d+)\s+0\s+R/);
    if (!reference) continue;
    const target = streams.find(item => item.number === Number(reference[1]));
    if (target?.content) cmaps.set(number, parseCMap(target.content));
  }

  // Font resource name (the name used by `/Name size Tf`) -> character map.
  const fonts = new Map();
  for (const body of objects.values()) {
    const dictionary = body.match(/\/Font\s*<<([\s\S]*?)>>/);
    if (!dictionary) continue;
    for (const entry of dictionary[1].matchAll(/\/([^\s/<>]+)\s+(\d+)\s+0\s+R/g)) {
      if (cmaps.has(Number(entry[2]))) fonts.set(entry[1], cmaps.get(Number(entry[2])));
    }
  }
  // A single-font document still decodes if the resource name cannot be matched.
  const fallback = fonts.size === 1 ? [...fonts.values()][0] : null;
  if (fonts.size === 0 && cmaps.size === 1) fonts.set('__default', [...cmaps.values()][0]);

  const pages = [];
  for (const [number, body] of [...objects].sort((a, b) => a[0] - b[0])) {
    if (!/\/Type\s*\/Page[^s]/.test(body)) continue;
    const size = body.match(/\/MediaBox\s*\[\s*([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)/);
    const contents = [];
    const single = body.match(/\/Contents\s+(\d+)\s+0\s+R/);
    const many = body.match(/\/Contents\s*\[([^\]]*)\]/);
    if (single) contents.push(Number(single[1]));
    if (many) for (const item of many[1].matchAll(/(\d+)\s+0\s+R/g)) contents.push(Number(item[1]));
    if (!contents.length) continue;
    pages.push({
      object: number,
      width: size ? Number(size[3]) : null,
      height: size ? Number(size[4]) : null,
      streams: contents,
    });
  }

  return pages
    .sort((a, b) => a.object - b.object)
    .map((page, index) => {
      const runs = [];
      const positions = [];
      let font = fallback;
      let x = 0;
      let y = 0;
      for (const streamNumber of page.streams) {
        const content = streams.find(item => item.number === streamNumber)?.content;
        if (!content) continue;
        const token = /\/([^\s/<>[\]]+)\s+([\d.]+)\s+Tf|<([0-9A-Fa-f\s]+)>\s*Tj|\[([^\]]*)\]\s*TJ|([\d.-]+)\s+([\d.-]+)\s+(?:Td|TD|Tm)/g;
        for (const match of content.matchAll(token)) {
          if (match[1] !== undefined) {
            font = fonts.get(match[1]) || fallback;
          } else if (match[3] !== undefined) {
            runs.push({ y, text: decodeHex(match[3], font) });
          } else if (match[4] !== undefined) {
            for (const part of match[4].matchAll(/<([0-9A-Fa-f\s]+)>/g)) {
              runs.push({ y, text: decodeHex(part[1], font) });
            }
          } else if (match[5] !== undefined) {
            x = Number(match[5]);
            y = Number(match[6]);
            positions.push({ x, y });
          }
        }
      }
      return { page: index + 1, width: page.width, height: page.height, runs, positions, text: runsToText(runs) };
    });
}

function decodeHex(hex, font) {
  const digits = hex.replace(/\s+/g, '');
  let text = '';
  for (let index = 0; index + 4 <= digits.length; index += 4) {
    const code = parseInt(digits.slice(index, index + 4), 16);
    text += font?.get(code) ?? '?';
  }
  return text;
}

/** Consecutive runs on the same baseline become one line, in drawing order. */
function runsToText(runs) {
  const lines = [];
  for (const run of runs) {
    const last = lines.at(-1);
    if (last && Math.abs(last.y - run.y) < 0.5) last.text += run.text;
    else lines.push({ y: run.y, text: run.text });
  }
  return lines.map(line => line.text);
}
