const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const TIMES = [
  '08.00', '09.00', '10.00', '11.00', '12.00', '13.00', '14.00', '15.00',
  '16.00', '17.00', '18.00', '19.00', '20.00', '21.00', '22.00', '23.00',
  '24.00', '01.00', '02.00', '03.00', '04.00', '05.00', '06.00', '07.00',
];
const SECTIONS = [TIMES.slice(0, 8), TIMES.slice(8, 16), TIMES.slice(16, 24)];
const MODELS = ['gemini-3.1-flash-lite', 'gemini-2.5-flash'];

const SYSTEM_INSTRUCTION = `You are a high-precision OCR data extraction engine for industrial process sheets.
Extract handwritten table data from the image with absolute accuracy following these STRICT rules:

1. ROW ALIGNMENT & TIME ANCHORING:
- Match every row strictly to its pre-printed Time stamp.
- Never skip a row. Never combine two rows into one.
- Trace horizontally across the exact grid line for each time stamp.

2. DITTO MARKS:
- If PRODUCT TYPE contains a ditto mark (\" or 〃), convert it to the actual product name from the previous row.

3. CHECKMARKS AND SLASHES:
- Under DW RUNNING DW1-DW5 and Change Dryer Filter, slash/checkmark means true; blank means false.

4. BLANK CELLS & MACHINE STOPS:
- If a cell is blank, return null.
- Never hallucinate, infer, interpolate, average, or copy values from adjacent rows.

5. REMARKS:
- Copy handwritten remarks and times exactly.
- Attach a remark only to the row where the handwriting or guide line originates.

6. UNCERTAINTY:
- If a value is not clearly readable, return null and list that field in unreadableFields.`;

const nullable = (type) => ({ anyOf: [{ type }, { type: 'null' }] });

const makeRowsSchema = (sectionTimes) => ({
  type: 'object',
  additionalProperties: false,
  required: ['rows'],
  properties: {
    rows: {
      type: 'array',
      minItems: 8,
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'time', 'productType', 'dw1', 'dw2', 'dw3', 'dw4', 'dw5',
          'hotAirIn', 'hotAirOut', 'speed', 'wetCakeMoisture',
          'productMoisture', 'changeDwFilter', 'remark', 'confidence', 'unreadableFields',
        ],
        properties: {
          time: { type: 'string', enum: sectionTimes },
          productType: nullable('string'),
          dw1: { type: 'boolean' }, dw2: { type: 'boolean' }, dw3: { type: 'boolean' },
          dw4: { type: 'boolean' }, dw5: { type: 'boolean' },
          hotAirIn: nullable('number'),
          hotAirOut: nullable('number'),
          speed: nullable('number'),
          wetCakeMoisture: { anyOf: [{ type: 'number' }, { type: 'string' }, { type: 'null' }] },
          productMoisture: { anyOf: [{ type: 'number' }, { type: 'string' }, { type: 'null' }] },
          changeDwFilter: { type: 'boolean' },
          remark: nullable('string'),
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          unreadableFields: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
});

const HEADER_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['reportDate', 'documentCode'],
  properties: {
    reportDate: nullable('string'),
    documentCode: nullable('string'),
  },
};

const sectionPrompt = (times) => `This image is a real crop containing ONLY these 8 table rows: ${times.join(', ')}.
Return exactly 8 rows in that exact order.
Read each row left-to-right across the same horizontal grid line.
WET CAKE may be a number or one of: แป้งไม่ลง, แซะสลัด.
PRODUCT MOISTURE may be a number or one of: แป้งไม่ลง, แป้งไม่ลง หยุดรอความเหนียว, แป้งไม่ลง หยุดซ่อม.
Do not use values outside this crop. Do not repeat remarks on another row.`;

const extractText = (data) => data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('').trim();

async function callGemini({ apiKey, model, imageBase64, prompt, schema }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      contents: [{ role: 'user', parts: [
        { text: prompt },
        { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } },
      ] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseJsonSchema: schema,
        temperature: 0,
        maxOutputTokens: 8192,
      },
    }),
  });
  const raw = await response.text();
  let apiData;
  try { apiData = JSON.parse(raw); } catch { throw new Error(`${model}: API response is not JSON`); }
  if (!response.ok) throw new Error(`${model}: ${apiData?.error?.message || `HTTP ${response.status}`}`);
  const text = extractText(apiData);
  if (!text) throw new Error(`${model}: empty model response`);
  return JSON.parse(text);
}

async function withFallback(args) {
  let lastError;
  for (const model of MODELS) {
    try { return await callGemini({ ...args, model }); }
    catch (error) { lastError = error; }
  }
  throw lastError || new Error('Gemini OCR failed');
}

const valueToString = (v) => v === null || v === undefined ? '' : String(v);
const boolToMark = (v) => v === true ? '/' : '';
const emptyRow = (time) => ({
  time, productType: '', dw1: '', dw2: '', dw3: '', dw4: '', dw5: '',
  hotAirIn: '', hotAirOut: '', speed: '', wetCakeMoisture: '', productMoisture: '',
  changeDwFilter: '', remark: '', rowConfidence: 0,
  reviewReasons: ['ไม่พบข้อมูลแถวนี้จากภาพครอป'], unreadableFields: [],
});

function normalizeRows(sectionResults) {
  const map = new Map();
  for (const result of sectionResults) {
    for (const row of result?.rows || []) {
      if (!TIMES.includes(row.time) || map.has(row.time)) continue;
      map.set(row.time, {
        time: row.time,
        productType: valueToString(row.productType),
        dw1: boolToMark(row.dw1), dw2: boolToMark(row.dw2), dw3: boolToMark(row.dw3),
        dw4: boolToMark(row.dw4), dw5: boolToMark(row.dw5),
        hotAirIn: valueToString(row.hotAirIn), hotAirOut: valueToString(row.hotAirOut),
        speed: valueToString(row.speed), wetCakeMoisture: valueToString(row.wetCakeMoisture),
        productMoisture: valueToString(row.productMoisture),
        changeDwFilter: boolToMark(row.changeDwFilter), remark: valueToString(row.remark),
        rowConfidence: Number(row.confidence) || 0,
        reviewReasons: Number(row.confidence) < 0.75 ? ['ความมั่นใจ OCR ต่ำ กรุณาตรวจสอบกับภาพต้นฉบับ'] : [],
        unreadableFields: Array.isArray(row.unreadableFields) ? row.unreadableFields : [],
      });
    }
  }
  return TIMES.map(time => map.get(time) || emptyRow(time));
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
    if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405, headers: CORS_HEADERS });
    try {
      if (!env.GEMINI_API_KEY) throw new Error('ยังไม่ได้ตั้งค่า GEMINI_API_KEY ใน Cloudflare');
      const body = await request.json();
      const sections = body.sectionImagesBase64;
      if (!Array.isArray(sections) || sections.length !== 3 || sections.some(v => !v)) {
        throw new Error('ไม่พบภาพครอปตารางครบ 3 ส่วน กรุณาอัปเดตหน้าเว็บเป็นเวอร์ชันล่าสุด');
      }

      const headerPromise = body.headerImageBase64
        ? withFallback({ apiKey: env.GEMINI_API_KEY, imageBase64: body.headerImageBase64, prompt: 'Extract only the document date and document code from this header crop.', schema: HEADER_SCHEMA })
        : Promise.resolve({ reportDate: '', documentCode: '' });

      const sectionPromises = SECTIONS.map((times, i) => withFallback({
        apiKey: env.GEMINI_API_KEY,
        imageBase64: sections[i],
        prompt: sectionPrompt(times),
        schema: makeRowsSchema(times),
      }));

      const [header, ...sectionResults] = await Promise.all([headerPromise, ...sectionPromises]);
      return new Response(JSON.stringify({
        reportDate: valueToString(header?.reportDate),
        documentCode: valueToString(header?.documentCode) || 'FM-PD-010',
        rows: normalizeRows(sectionResults),
        ocrMethod: 'crop-based-v16',
      }), { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }
  },
};
