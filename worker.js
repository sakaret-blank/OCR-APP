const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const TIMES = [
  '08.00', '09.00', '10.00', '11.00', '12.00', '13.00',
  '14.00', '15.00', '16.00', '17.00', '18.00', '19.00',
  '20.00', '21.00', '22.00', '23.00', '24.00', '01.00',
  '02.00', '03.00', '04.00', '05.00', '06.00', '07.00',
];

const ROW_FIELDS = [
  'productType', 'dw1', 'dw2', 'dw3', 'dw4', 'dw5',
  'hotAirIn', 'hotAirOut', 'speed', 'wetCakeMoisture',
  'productMoisture', 'changeDwFilter', 'remark',
];

const emptyRow = (time) => ({
  time,
  productType: '',
  dw1: '', dw2: '', dw3: '', dw4: '', dw5: '',
  hotAirIn: '', hotAirOut: '', speed: '',
  wetCakeMoisture: '', productMoisture: '',
  changeDwFilter: '', remark: '', unreadableFields: [],
});

const normalizeTime = (value) => {
  const raw = String(value || '').trim();
  const match = raw.match(/^([0-2]?\d)[:.]([0-5]\d)$/);
  if (!match) return '';
  let hour = Number(match[1]);
  if (raw.startsWith('24')) hour = 24;
  return `${String(hour).padStart(2, '0')}.${match[2]}`;
};

const normalizeMark = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (/^(?:\/|1|I|l|\||✓|✔|√)$/i.test(raw)) return '/';
  return raw;
};

const normalizeResult = (result) => {
  const sourceRows = Array.isArray(result?.rows) ? result.rows : [];
  const byTime = new Map();

  for (const source of sourceRows) {
    const time = normalizeTime(source?.time);
    if (!TIMES.includes(time) || byTime.has(time)) continue;
    byTime.set(time, source);
  }

  const rows = TIMES.map((time) => {
    const source = byTime.get(time);
    if (!source) {
      const row = emptyRow(time);
      row.unreadableFields = ['time'];
      return row;
    }

    const row = emptyRow(time);
    for (const field of ROW_FIELDS) row[field] = String(source[field] ?? '').trim();
    for (const field of ['dw1', 'dw2', 'dw3', 'dw4', 'dw5', 'changeDwFilter']) {
      row[field] = normalizeMark(row[field]);
    }
    row.unreadableFields = Array.isArray(source.unreadableFields)
      ? [...new Set(source.unreadableFields.filter((field) => ROW_FIELDS.includes(field)))]
      : [];
    return row;
  });

  return {
    reportDate: String(result?.reportDate || '').trim(),
    documentCode: String(result?.documentCode || 'FM-PD-010').trim(),
    rows,
  };
};

const RESPONSE_SCHEMA = {
  type: 'object',
  required: ['reportDate', 'documentCode', 'rows'],
  properties: {
    reportDate: { type: 'string' },
    documentCode: { type: 'string' },
    rows: {
      type: 'array',
      minItems: 24,
      maxItems: 24,
      items: {
        type: 'object',
        required: [
          'time', 'productType', 'dw1', 'dw2', 'dw3', 'dw4', 'dw5',
          'hotAirIn', 'hotAirOut', 'speed', 'wetCakeMoisture',
          'productMoisture', 'changeDwFilter', 'remark', 'unreadableFields',
        ],
        properties: {
          time: { type: 'string', enum: TIMES },
          productType: { type: 'string' },
          dw1: { type: 'string' }, dw2: { type: 'string' },
          dw3: { type: 'string' }, dw4: { type: 'string' }, dw5: { type: 'string' },
          hotAirIn: { type: 'string' }, hotAirOut: { type: 'string' },
          speed: { type: 'string' }, wetCakeMoisture: { type: 'string' },
          productMoisture: { type: 'string' }, changeDwFilter: { type: 'string' },
          remark: { type: 'string' },
          unreadableFields: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
};

const SYSTEM_INSTRUCTION = `
You are a high-precision OCR data extraction engine for an industrial DRYING PROCESS OPERATION REPORT.
Your only task is to transcribe the handwritten table faithfully. Never infer, predict, average, repair, or copy values from nearby rows.

STRICT RULES:
1. Use the pre-printed TIME column as the anchor. Trace horizontally inside the exact grid boundaries of each row.
2. Return exactly 24 rows in this exact order: 08.00 through 23.00, then 24.00, then 01.00 through 07.00.
3. Blank cell means empty string. A dryer stop or downtime often creates blank cells; never fill them.
4. PRODUCT TYPE ditto marks such as quotation mark or 〃 must be returned as the visible ditto mark. Do not expand into a product name.
5. DW1-DW5 and Change DW Filter: visible slash/check mark = "/"; empty = "". Never output 1 for a slash.
6. Copy REMARK text and embedded times exactly as visible. Attach it only to the row where it is written or where its line begins.
7. If uncertain, output "" and add that field name to unreadableFields.
8. Re-check digits 1/7, 3/5/8/9, decimal points, and row boundaries before answering.
9. Do not translate product names. Do not output generic words such as Tapioca or แป้งมัน unless those exact words are written.
`;

const USER_PROMPT = `
Read the entire document image once, preserving full-page context. Return only JSON matching the schema.
Before finalizing, verify every row against its printed time and verify that blank downtime rows remain blank.
`;

const extractCandidateText = (apiData) => apiData?.candidates?.[0]?.content?.parts
  ?.map((part) => part.text || '')
  .join('')
  .trim();

const isStructurallyValid = (result) => {
  if (!Array.isArray(result?.rows) || result.rows.length !== 24) return false;
  const times = result.rows.map((row) => normalizeTime(row?.time));
  return TIMES.every((time, index) => times[index] === time);
};

async function callGemini({ apiKey, imageBase64, retry = false }) {
  const model = 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const correction = retry
    ? '\nPrevious extraction failed the 24-row time-order validation. Re-read the original image from scratch. Do not reuse or shift any previous row values.'
    : '';

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      contents: [{
        parts: [
          { text: USER_PROMPT + correction },
          { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } },
        ],
      }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseJsonSchema: RESPONSE_SCHEMA,
        temperature: 0,
        maxOutputTokens: 16384,
      },
    }),
  });

  const raw = await response.text();
  let apiData;
  try { apiData = JSON.parse(raw); }
  catch { throw new Error('Gemini API ส่งข้อมูลที่ไม่ใช่ JSON'); }

  if (!response.ok) throw new Error(apiData?.error?.message || `HTTP ${response.status}`);
  const text = extractCandidateText(apiData);
  if (!text) throw new Error('ไม่พบข้อความผลลัพธ์จาก Gemini');
  return JSON.parse(text);
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    try {
      if (!env.GEMINI_API_KEY) throw new Error('ยังไม่ได้ตั้งค่า GEMINI_API_KEY ใน Cloudflare');
      const body = await request.json();
      if (!body.imageBase64) throw new Error('ไม่พบข้อมูลรูปภาพ (imageBase64)');

      let result = await callGemini({ apiKey: env.GEMINI_API_KEY, imageBase64: body.imageBase64 });
      if (!isStructurallyValid(result)) {
        result = await callGemini({ apiKey: env.GEMINI_API_KEY, imageBase64: body.imageBase64, retry: true });
      }

      const normalized = normalizeResult(result);
      return new Response(JSON.stringify(normalized), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }
  },
};
