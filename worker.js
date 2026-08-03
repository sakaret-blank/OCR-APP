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

const SECTIONS = [
  TIMES.slice(0, 8),   // 08.00–15.00
  TIMES.slice(8, 16),  // 16.00–23.00
  TIMES.slice(16, 24), // 24.00–07.00
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
  changeDwFilter: '', remark: '',
  rowConfidence: 0,
  reviewReasons: ['ไม่พบแถวนี้จากผล OCR'],
  unreadableFields: [],
});

const normalizeTime = (value) => {
  const match = String(value || '').trim().match(/^([0-2]?\d)[:.]([0-5]\d)$/);
  if (!match) return '';
  let hour = Number(match[1]);
  if (String(value).trim().startsWith('24')) hour = 24;
  return `${String(hour).padStart(2, '0')}.${match[2]}`;
};

const normalizeMark = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (['/', '／', '\\', '|', '1', 'I', 'l'].includes(raw)) return '/';
  return '';
};

const normalizeRow = (source, time) => {
  const row = emptyRow(time);
  for (const field of ROW_FIELDS) row[field] = String(source?.[field] ?? '').trim();
  row.dw1 = normalizeMark(row.dw1);
  row.dw2 = normalizeMark(row.dw2);
  row.dw3 = normalizeMark(row.dw3);
  row.dw4 = normalizeMark(row.dw4);
  row.dw5 = normalizeMark(row.dw5);
  row.changeDwFilter = normalizeMark(row.changeDwFilter);
  row.rowConfidence = Math.max(0, Math.min(1, Number(source?.rowConfidence) || 0));
  row.reviewReasons = Array.isArray(source?.reviewReasons)
    ? source.reviewReasons.map(String).filter(Boolean).slice(0, 6)
    : [];
  row.unreadableFields = Array.isArray(source?.unreadableFields)
    ? source.unreadableFields.filter((field) => ROW_FIELDS.includes(field))
    : [];
  return row;
};

const normalizeResult = (sectionResults) => {
  const byTime = new Map();
  let reportDate = '';
  let documentCode = 'FM-PD-010';

  for (const result of sectionResults) {
    if (!reportDate && result?.reportDate) reportDate = String(result.reportDate).trim();
    if (result?.documentCode) documentCode = String(result.documentCode).trim();
    for (const source of Array.isArray(result?.rows) ? result.rows : []) {
      const time = normalizeTime(source?.time);
      if (TIMES.includes(time) && !byTime.has(time)) byTime.set(time, source);
    }
  }

  return {
    reportDate,
    documentCode,
    rows: TIMES.map((time) => normalizeRow(byTime.get(time), time)),
  };
};

const makeSectionSchema = (sectionTimes) => ({
  type: 'object',
  required: ['reportDate', 'documentCode', 'rows'],
  properties: {
    reportDate: { type: 'string' },
    documentCode: { type: 'string' },
    rows: {
      type: 'array',
      minItems: sectionTimes.length,
      maxItems: sectionTimes.length,
      items: {
        type: 'object',
        required: [
          'time', 'productType', 'dw1', 'dw2', 'dw3', 'dw4', 'dw5',
          'hotAirIn', 'hotAirOut', 'speed', 'wetCakeMoisture',
          'productMoisture', 'changeDwFilter', 'remark',
          'rowConfidence', 'reviewReasons', 'unreadableFields',
        ],
        properties: {
          time: { type: 'string', enum: sectionTimes },
          productType: { type: 'string' },
          dw1: { type: 'string', enum: ['', '/'] },
          dw2: { type: 'string', enum: ['', '/'] },
          dw3: { type: 'string', enum: ['', '/'] },
          dw4: { type: 'string', enum: ['', '/'] },
          dw5: { type: 'string', enum: ['', '/'] },
          hotAirIn: { type: 'string' },
          hotAirOut: { type: 'string' },
          speed: { type: 'string' },
          wetCakeMoisture: { type: 'string' },
          productMoisture: { type: 'string' },
          changeDwFilter: { type: 'string', enum: ['', '/'] },
          remark: { type: 'string' },
          rowConfidence: { type: 'number', minimum: 0, maximum: 1 },
          reviewReasons: { type: 'array', items: { type: 'string' } },
          unreadableFields: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
});

const makeSectionPrompt = (sectionTimes, sectionIndex) => `
คุณเป็นระบบถอดข้อมูลจากภาพเอกสารโรงงาน “DRYING PROCESS OPERATION REPORT”
รอบนี้ให้อ่านเฉพาะส่วนที่ ${sectionIndex + 1} จาก 3 และคืนเฉพาะ ${sectionTimes.length} แถวต่อไปนี้ตามลำดับเท่านั้น:
${sectionTimes.join(', ')}

กฎสำคัญสูงสุด:
1. ล็อกแต่ละค่ากับเส้นแนวนอนของเวลาเดียวกัน ห้ามย้ายค่าจากแถวบนหรือล่างมาเติม
2. อ่านแต่ละแถวจากซ้ายไปขวา: PRODUCT TYPE → DW1–DW5 → IN → OUT → SPEED → WET → PRODUCT → FILTER → REMARK
3. ถ้าช่องใดว่าง ให้คืน "" แม้แถวข้างเคียงจะมีค่า ห้ามเติมหรือคาดเดา
4. หากอ่านไม่ชัด ให้คืน "" และเพิ่มชื่อฟิลด์ลง unreadableFields
5. DW1–DW5 และ FILTER มีเพียง "/" หรือ "" เท่านั้น ห้ามคืนเลข 1 ตัว I หรือตัว l
6. ต้องคืนครบ ${sectionTimes.length} แถวและ time ต้องตรงตามรายการ ห้ามใช้เวลาอื่น
7. ก่อนส่งผล ให้ตรวจซ้ำแถว 12.00, 17.00, 18.00, 19.00, 20.00, 22.00 และ 23.00 เป็นพิเศษ หากอยู่ในส่วนนี้ เพราะมักมีช่วงหยุดเครื่องหรือข้อมูลว่าง
8. REMARK ที่มีเวลาจริง เช่น 17:45 Stop dryer และ 18:50 Start dryer ให้คัดลอกตามภาพ ห้ามเปลี่ยนเวลา
9. PRODUCT TYPE ที่เป็นเครื่องหมายซ้ำให้คืนเครื่องหมายตามภาพ ไม่ต้องขยายชื่อ
10. ห้ามใช้ค่าจากความจำหรือค่าที่ดูสมเหตุสมผลแทนภาพ

กฎเฉพาะความชื้น:
- WET CAKE MOISTURE อาจเป็นตัวเลข หรือข้อความ “แป้งไม่ลง” / “แซะสลัด”
- PRODUCT MOISTURE อาจเป็นตัวเลข หรือข้อความ “แป้งไม่ลง” / “แป้งไม่ลง หยุดรอความเหนียว” / “แป้งไม่ลง หยุดซ่อม”
- ถ้าไม่เห็นชัด ให้เว้นว่างและแจ้ง unreadableFields

rowConfidence:
- 0.95–1.00 เมื่อเส้นแถวและทุกค่าชัดเจน
- 0.70–0.94 เมื่อมีบางช่องไม่ชัดแต่ตำแหน่งแถวแน่นอน
- ต่ำกว่า 0.70 เมื่อเส้นแถวหรือข้อมูลมีโอกาสเลื่อน ให้เพิ่ม reviewReasons อธิบายสั้น ๆ

ส่งเฉพาะ JSON ตาม schema เท่านั้น
`;

const extractText = (apiData) => apiData?.candidates?.[0]?.content?.parts
  ?.map((part) => part.text || '')
  .join('')
  .trim();

const callGemini = async ({ model, apiKey, imageBase64, sectionTimes, sectionIndex }) => {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: makeSectionPrompt(sectionTimes, sectionIndex) },
          { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } },
        ],
      }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseJsonSchema: makeSectionSchema(sectionTimes),
        temperature: 0,
        maxOutputTokens: 8192,
      },
    }),
  });

  const raw = await response.text();
  let apiData;
  try { apiData = JSON.parse(raw); }
  catch { throw new Error(`${model}: API ส่งข้อมูลที่ไม่ใช่ JSON`); }
  if (!response.ok) throw new Error(`${model}: ${apiData?.error?.message || `HTTP ${response.status}`}`);
  const text = extractText(apiData);
  if (!text) throw new Error(`${model}: ไม่พบข้อความผลลัพธ์`);
  return JSON.parse(text);
};

const scanSectionWithFallback = async ({ apiKey, imageBase64, sectionTimes, sectionIndex }) => {
  const models = ['gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-2.5-flash'];
  let lastError = 'ไม่สามารถเรียกโมเดลได้';
  for (const model of models) {
    try {
      return await callGemini({ model, apiKey, imageBase64, sectionTimes, sectionIndex });
    } catch (error) {
      lastError = error.message;
    }
  }
  throw new Error(`ส่วนที่ ${sectionIndex + 1} สแกนล้มเหลว: ${lastError}`);
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, {
        status: 405,
        headers: CORS_HEADERS,
      });
    }

    try {
      if (!env.GEMINI_API_KEY) throw new Error('ยังไม่ได้ตั้งค่า GEMINI_API_KEY ใน Cloudflare');
      const body = await request.json();
      if (!body.imageBase64) throw new Error('ไม่พบข้อมูลรูปภาพ (imageBase64)');

      // แบ่งอ่าน 3 ช่วง ช่วงละ 8 แถว เพื่อลดการเลื่อนแถวและการดึงค่าข้ามช่วง
      const sectionResults = [];
      for (let i = 0; i < SECTIONS.length; i += 1) {
        sectionResults.push(await scanSectionWithFallback({
          apiKey: env.GEMINI_API_KEY,
          imageBase64: body.imageBase64,
          sectionTimes: SECTIONS[i],
          sectionIndex: i,
        }));
      }

      const normalized = normalizeResult(sectionResults);
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
