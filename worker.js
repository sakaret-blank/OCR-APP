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
  const match = String(value || '').trim().match(/^([0-2]?\d)[:.]([0-5]\d)$/);
  if (!match) return '';
  let hour = Number(match[1]);
  if (String(value).trim().startsWith('24')) hour = 24;
  return `${String(hour).padStart(2, '0')}.${match[2]}`;
};

const normalizeResult = (result) => {
  const sourceRows = Array.isArray(result?.rows) ? result.rows : [];
  const byTime = new Map();

  sourceRows.forEach((row) => {
    const time = normalizeTime(row?.time);
    if (TIMES.includes(time) && !byTime.has(time)) byTime.set(time, row);
  });

  const rows = TIMES.map((time, index) => {
    const source = byTime.get(time) || sourceRows[index] || {};
    const row = emptyRow(time);
    for (const field of ROW_FIELDS) row[field] = String(source[field] ?? '').trim();
    row.unreadableFields = Array.isArray(source.unreadableFields)
      ? source.unreadableFields.filter((field) => ROW_FIELDS.includes(field))
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
      items: {
        type: 'object',
        required: [
          'time', 'productType', 'dw1', 'dw2', 'dw3', 'dw4', 'dw5',
          'hotAirIn', 'hotAirOut', 'speed', 'wetCakeMoisture',
          'productMoisture', 'changeDwFilter', 'remark', 'unreadableFields',
        ],
        properties: {
          time: { type: 'string' },
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

const PROMPT = `
คุณเป็นระบบถอดข้อมูลจากเอกสารโรงงาน “DRYING PROCESS OPERATION REPORT”
งานนี้ต้องการความซื่อสัตย์ต่อภาพมากกว่าการเติมข้อมูลให้ครบ ห้ามเดา ห้ามคัดลอกค่าจากแถวข้างเคียง และห้ามเลื่อนข้อมูลข้ามแถว

วิธีอ่านที่ต้องปฏิบัติอย่างเคร่งครัด:
1. มองเส้นตารางแนวนอนและอ่านทีละแถว โดยล็อกตามเวลา 24 แถวเรียงดังนี้:
08.00, 09.00, 10.00, 11.00, 12.00, 13.00, 14.00, 15.00, 16.00, 17.00, 18.00, 19.00, 20.00, 21.00, 22.00, 23.00, 24.00, 01.00, 02.00, 03.00, 04.00, 05.00, 06.00, 07.00
2. ค่าในแต่ละแถวต้องมาจากพื้นที่ระหว่างเส้นบนและเส้นล่างของแถวนั้นเท่านั้น
3. ช่องว่างต้องคืนค่าเป็น "" ห้ามเติมค่าจากแถวก่อนหรือแถวถัดไป
4. หากตัวเลขหรือลายมือไม่ชัด ให้คืน "" และเพิ่มชื่อฟิลด์นั้นใน unreadableFields
5. ห้ามสร้างเครื่องหมาย “/” ใน DW หรือ Filter หากในภาพไม่มีเครื่องหมายในช่องนั้น
6. เครื่องหมายซ้ำของ PRODUCT TYPE เช่น ", 〃 หรือขีดซ้ำ ให้คืนตามที่เห็น ห้ามแทนชื่อผลิตภัณฑ์เอง
7. REMARK อาจมีเวลาจริงอยู่ภายในข้อความ เช่น 17:45 Stop dryer / 18:50 Start dryer ให้คัดลอกเวลาและข้อความตามภาพ ห้ามปรับเวลาให้ตรงชั่วโมงประจำแถว
8. ตรวจทานรอบสุดท้ายว่าไม่มีข้อมูลไหลข้ามช่วงหยุดเครื่อง และไม่มีค่าที่แต่งเติมในช่องว่าง

กฎเฉพาะช่องความชื้น:
- WET CAKE MOISTURE: ถ้าเป็นข้อความ ให้เลือกเฉพาะ “แป้งไม่ลง” หรือ “แซะสลัด” เมื่อความหมายชัดเจนจริงเท่านั้น
- PRODUCT MOISTURE: ถ้าเป็นข้อความ ให้เลือกเฉพาะ “แป้งไม่ลง”, “แป้งไม่ลง หยุดรอความเหนียว”, หรือ “แป้งไม่ลง หยุดซ่อม” เมื่อความหมายชัดเจนจริงเท่านั้น
- ถ้าไม่มั่นใจ ห้ามเดา ให้คืนข้อความที่อ่านได้หรือ "" และเพิ่มฟิลด์ใน unreadableFields

ตรวจสอบเชิงภาพก่อนส่งผล:
- เปรียบเทียบตำแหน่ง PRODUCT TYPE ที่เปลี่ยนชื่อกับเส้นเวลาอย่างละเอียด
- ตรวจช่วงที่ DW1-DW5 ว่าง เพราะอาจเป็นช่วงหยุดอบแป้ง
- ตรวจตัวเลข 3, 5, 8, 9 และจุดทศนิยมซ้ำอีกครั้ง
- ตรวจว่าทุกแถวมี time ตามรายการที่กำหนด แต่ข้อมูลช่องอื่นอาจว่างได้

ส่งเฉพาะ JSON ตาม schema ที่กำหนดเท่านั้น
`;

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

      const models = ['gemini-3.6-flash', 'gemini-3.1-flash-lite', 'gemini-2.5-flash'];
      let lastError = 'ไม่สามารถเรียกโมเดลได้';

      for (const model of models) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;
        try {
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{
                parts: [
                  { text: PROMPT },
                  { inlineData: { mimeType: 'image/jpeg', data: body.imageBase64 } },
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
          catch { lastError = `${model}: API ส่งข้อมูลที่ไม่ใช่ JSON`; continue; }

          if (!response.ok) {
            lastError = `${model}: ${apiData?.error?.message || `HTTP ${response.status}`}`;
            continue;
          }

          const text = apiData?.candidates?.[0]?.content?.parts
            ?.map((part) => part.text || '')
            .join('')
            .trim();
          if (!text) {
            lastError = `${model}: ไม่พบข้อความผลลัพธ์`;
            continue;
          }

          const parsed = JSON.parse(text);
          const normalized = normalizeResult(parsed);
          return new Response(JSON.stringify(normalized), {
            status: 200,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          });
        } catch (error) {
          lastError = `${model}: ${error.message}`;
        }
      }

      throw new Error(`สแกนล้มเหลว: ${lastError}`);
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }
  },
};
