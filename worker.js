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

// รายชื่อโมเดลเริ่มต้น เรียงตามลำดับที่จะลอง
// หมายเหตุ: gemini-3.5-flash และ gemini-3.7-flash ถูกเลิกใช้และ Google ส่งต่อไปยังรุ่นใหม่กว่าอัตโนมัติ
// จึงไม่ใส่ไว้ เพราะจะไปใช้โควตาเดียวกับรุ่นที่ส่งต่อไป
// ปรับรายชื่อได้โดยไม่ต้องแก้โค้ด: ตั้งตัวแปร GEMINI_MODELS ใน Cloudflare (คั่นด้วย ,)
const DEFAULT_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash-lite',
];

function getModels(env, preferred) {
  const fromEnv = String(env.GEMINI_MODELS || '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  const list = fromEnv.length ? fromEnv : DEFAULT_MODELS;

  // รอบที่สองเริ่มจากรุ่นที่ใช้ได้ในรอบแรก เพื่อไม่ให้เสียโควตาไปกับรุ่นที่ล้มเหลวซ้ำ
  if (preferred && list.includes(preferred)) {
    return [preferred, ...list.filter((m) => m !== preferred)];
  }
  return list;
}

// โหมด precheck (ตรวจทิศทาง/ตรวจว่าเป็นรายงานหรือไม่) ใช้รุ่นเล็กก่อนเพื่อประหยัดโควตา
// ปรับได้ที่ตัวแปร GEMINI_PRECHECK_MODELS (คั่นด้วย ,)
const DEFAULT_PRECHECK_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3.8-flash',
];

function getPrecheckModels(env) {
  const fromEnv = String(env.GEMINI_PRECHECK_MODELS || '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  return fromEnv.length ? fromEnv : DEFAULT_PRECHECK_MODELS;
}

const CORE_FIELDS = [
  'productType',
  'hotAirIn',
  'hotAirOut',
  'speed',
  'wetCakeMoisture',
  'productMoisture',
  'remark',
];

const MARK_FIELDS = [
  'dw1', 'dw2', 'dw3', 'dw4', 'dw5', 'changeDwFilter',
];

const emptyRow = (time) => ({
  time,
  productType: '',
  dw1: '',
  dw2: '',
  dw3: '',
  dw4: '',
  dw5: '',
  hotAirIn: '',
  hotAirOut: '',
  speed: '',
  wetCakeMoisture: '',
  productMoisture: '',
  changeDwFilter: '',
  remark: '',
  unreadableFields: [],
});

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

function cleanText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function normalizeTime(value) {
  const raw = cleanText(value).replace(':', '.');
  const match = raw.match(/^(\d{1,2})\.(\d{2})$/);

  if (!match || match[2] !== '00') return '';

  const hour = Number(match[1]);
  if (hour < 0 || hour > 24) return '';

  return `${String(hour).padStart(2, '0')}.00`;
}

// Gemini ต้องประกาศช่องว่างด้วย "-" แล้ว Worker จึงลบออกภายหลัง
function dashToBlank(value) {
  const raw = cleanText(value);
  if (!raw || /^(?:-|—|–|−|null|none|n\/a)$/i.test(raw)) return '';
  return raw;
}

function normalizeMark(value) {
  const raw = dashToBlank(value);
  if (!raw) return '';

  if (/^(?:\/|1|I|i|l|\||✓|✔|√|⁄)$/u.test(raw)) {
    return '/';
  }

  // ค่าที่ไม่ใช่เครื่องหมายที่ยอมรับ จะไม่ถูกนำมาแสดง
  return '';
}

function parseJsonSafely(text) {
  let cleaned = cleanText(text)
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');

    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }

    throw new Error('ไม่สามารถแปลงผล OCR เป็น JSON ได้');
  }
}

function extractCandidateText(apiData) {
  const parts = apiData?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts.map((part) => part?.text || '').join('').trim();
}

// ลองโมเดลตามลำดับใน models จนกว่าจะได้ผล ถ้าล้มทุกตัวจะรวมข้อความ error ของทุกรุ่นส่งกลับ
async function callGemini({
  apiKey,
  models,
  imageBase64,
  systemInstruction,
  prompt,
  maxOutputTokens = 16384,
}) {
  const errors = [];

  for (const model of models) {
    try {
      const url =
        `https://generativelanguage.googleapis.com/v1beta/models/` +
        `${model}:generateContent`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: systemInstruction }],
          },
          contents: [
            {
              role: 'user',
              parts: [
                { text: prompt },
                {
                  inlineData: {
                    mimeType: 'image/jpeg',
                    data: imageBase64,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: 'application/json',
            maxOutputTokens,
          },
        }),
      });

      const raw = await response.text();
      let apiData;

      try {
        apiData = JSON.parse(raw);
      } catch {
        throw new Error(`${model}: API ส่งข้อมูลตอบกลับผิดรูปแบบ`);
      }

      if (!response.ok) {
        throw new Error(
          `${model}: ${apiData?.error?.message || `HTTP ${response.status}`}`
        );
      }

      const candidateText = extractCandidateText(apiData);
      if (!candidateText) {
        throw new Error(`${model}: ไม่พบผล OCR`);
      }

      return {
        model,
        data: parseJsonSafely(candidateText),
      };
    } catch (error) {
      console.error(error);
      errors.push(error?.message || `${model}: เกิดข้อผิดพลาด`);
    }
  }

  throw new Error(errors.join(' | ') || 'ไม่สามารถเรียกใช้งาน Gemini ได้');
}

function rowsByTime(sourceRows) {
  const map = new Map();

  for (const source of Array.isArray(sourceRows) ? sourceRows : []) {
    const time = normalizeTime(source?.time);
    if (!TIMES.includes(time) || map.has(time)) continue;
    map.set(time, source);
  }

  return map;
}

function normalizeMainResult(result) {
  const sourceMap = rowsByTime(result?.rows);

  const rows = TIMES.map((time) => {
    const source = sourceMap.get(time);
    const row = emptyRow(time);

    if (!source) {
      row.unreadableFields = ['missingRow'];
      return row;
    }

    for (const field of CORE_FIELDS) {
      row[field] = dashToBlank(source[field]);
    }

    row.unreadableFields = Array.isArray(source?.unreadableFields)
      ? [
          ...new Set(
            source.unreadableFields
              .map(cleanText)
              .filter((field) => CORE_FIELDS.includes(field))
          ),
        ]
      : [];

    return row;
  });

  return {
    reportDate: dashToBlank(result?.reportDate),
    documentCode:
      dashToBlank(result?.documentCode) || 'FM-PD-010 Rev.1',
    rows,
  };
}

function mergeMarkResult(rows, result) {
  const sourceMap = rowsByTime(result?.rows);

  return rows.map((row) => {
    const source = sourceMap.get(row.time);
    if (!source) return row;

    const merged = { ...row };
    for (const field of MARK_FIELDS) {
      merged[field] = normalizeMark(source[field]);
    }
    return merged;
  });
}

function structuralWarnings(rows) {
  const warnings = [];

  for (const row of rows) {
    if (row.unreadableFields.includes('missingRow')) {
      warnings.push(`ไม่พบผล OCR สำหรับแถว ${row.time}`);
    }
  }

  const row1200 = rows.find((row) => row.time === '12.00');
  if (row1200) {
    const hasAnyCore = [
      row1200.hotAirIn,
      row1200.hotAirOut,
      row1200.speed,
      row1200.wetCakeMoisture,
      row1200.productMoisture,
    ].some(Boolean);

    if (!hasAnyCore) {
      warnings.push('แถว 12.00 ไม่มีค่ากระบวนการ กรุณาตรวจสอบกับภาพต้นฉบับ');
    }
  }

  return warnings;
}

const MAIN_SYSTEM = `
You are a strict, high-precision OCR data transcriber for an industrial form named DRYING PROCESS OPERATION REPORT.

Read only these fields:
- reportDate
- documentCode
- productType
- hotAirIn
- hotAirOut
- speed
- wetCakeMoisture
- productMoisture
- remark

Do not read DW1-DW5 or Change Dryer Filter in this pass.

CRITICAL RULES:

1. TRACK ROW BY ROW
Use the pre-printed TIME column as the absolute anchor.
Read horizontally inside the exact printed grid row.
Return exactly 24 rows in this exact order:
${TIMES.join(', ')}
Never skip a row.
Never combine rows.
Never shift values upward or downward.
Check row 12.00 especially carefully before moving to row 13.00.

2. NO INK = DASH
For every requested cell, first look for visible pen ink inside that exact cell.
If there is no handwriting in the cell, output the string "-".
Do not output null.
Do not leave a JSON property missing.
Do not infer or copy a value from another row.

3. NO PATTERN COMPLETION
Repeated values do not authorize copying.
Only transcribe numbers visibly written in that exact row.
Blank downtime rows must remain "-".
Never fill a blank because nearby rows contain normal operating values.

4. PRODUCT TYPE
Copy the visible text exactly.
If a ditto mark such as " or 〃 is visible, output that visible mark exactly.
Do not expand it into the product name.
Do not translate it.

5. NUMBERS
Return every number as a STRING.
Preserve every decimal point exactly.
Do not round or normalize unusual values.
Pay special attention to 1/7, 3/5, 5/8, 8/9 and decimal points.

6. REMARK
Copy only handwriting visibly located in the REMARK cell of that row.
If no remark ink exists, output "-".
Do not duplicate the same remark into another row.

7. UNREADABLE INK
If ink exists but cannot be read confidently:
- output "-"
- add the field name to unreadableFields
Never guess.

Return one JSON object only with this structure:
{
  "reportDate": "-",
  "documentCode": "-",
  "rows": [
    {
      "time": "08.00",
      "productType": "-",
      "hotAirIn": "-",
      "hotAirOut": "-",
      "speed": "-",
      "wetCakeMoisture": "-",
      "productMoisture": "-",
      "remark": "-",
      "unreadableFields": []
    }
  ]
}

Return exactly 24 rows. Return no markdown and no explanation.
`;

const MAIN_PROMPT = `
Transcribe the complete document image once.

Before returning the JSON, perform this physical tracking sequence:
1. Locate 08.00 in the printed TIME column.
2. Trace horizontally across that exact row.
3. Move down exactly one printed grid row to 09.00.
4. Continue one row at a time without jumping.
5. Pause at 12.00 and verify that its values come from the 12.00 row, not 13.00.
6. Continue through 07.00.

For each cell, explicitly decide whether visible pen ink exists.
No ink must be represented by "-".
Return only JSON.
`;

const MARK_SYSTEM = `
You are a strict visual mark transcriber for the same DRYING PROCESS OPERATION REPORT.

Read only:
- DW1
- DW2
- DW3
- DW4
- DW5
- changeDwFilter

Use the printed TIME column as the absolute row anchor.
Return exactly 24 rows in this exact order:
${TIMES.join(', ')}

For every mark cell:
- If a slash/check/pen mark is visibly present inside the exact cell, output "/".
- If there is no pen ink, output "-".
- Never infer a mark from neighboring rows.
- Never fill all DW columns merely because nearby rows contain marks.
- Never output the number 1.
- Read DW1, DW2, DW3, DW4, DW5 separately.

Return only this JSON structure:
{
  "rows": [
    {
      "time": "08.00",
      "dw1": "-",
      "dw2": "-",
      "dw3": "-",
      "dw4": "-",
      "dw5": "-",
      "changeDwFilter": "-"
    }
  ]
}

Return exactly 24 rows. Return no markdown and no explanation.
`;

const MARK_PROMPT = `
Inspect only the DW RUNNING columns and Change Dryer Filter column.
Track one printed time row at a time from 08.00 through 07.00.
For each individual cell, output "/" only when pen ink is visibly present; otherwise output "-".
Return only JSON.
`;

// ===== โหมด precheck: ตรวจว่าเป็นรายงานหรือไม่ และต้องหมุนภาพกี่องศาก่อนอ่าน =====
const PRECHECK_SYSTEM = `
You inspect ONE photo. It may or may not be a Thai factory form named "DRYING PROCESS OPERATION REPORT" (document code FM-PD-010).

The printed form is LANDSCAPE. Its title "DRYING PROCESS OPERATION REPORT" is printed in a box along the top edge, the company name is at the top-left, and a table with a TIME column (08.00, 09.00, ...) is below. Photos are often taken with the paper or the phone turned, so the form can appear sideways or upside down.

Answer these fields:

1. isDryingReport
   true only when the photo clearly shows this form. false for any other photo or document.

2. rotationDegrees
   The number of degrees the image must be rotated CLOCKWISE so the printed text becomes upright and reads left to right.
   Allowed values: 0, 90, 180, 270.
   - 0   = already upright.
   - 90  = the printed title currently reads from the BOTTOM of the photo toward the TOP (the tops of the letters face left).
   - 180 = upside down.
   - 270 = the printed title currently reads from the TOP of the photo toward the BOTTOM (the tops of the letters face right).
   Judge by the printed text (title, column headings), not by the handwriting and not by the clipboard or background.
   If isDryingReport is false, use 0.

3. reportDate
   The handwritten date next to "Date" exactly as written (for example "20/10/26"). Use "-" if it cannot be read or does not exist.

4. imageQuality
   One of: "good", "blurry", "cropped", "dark", "glare".
   Use "cropped" if part of the table is cut off.

Return one JSON object only, with no markdown and no explanation:
{
  "isDryingReport": true,
  "rotationDegrees": 0,
  "reportDate": "-",
  "imageQuality": "good"
}
`;

const PRECHECK_PROMPT = `
Look at the whole photo and return the JSON object described in the instructions.
`;

const IMAGE_QUALITIES = ['good', 'blurry', 'cropped', 'dark', 'glare'];

function normalizePrecheckResult(result) {
  const rawRotation = Number(result?.rotationDegrees);
  const rotationDegrees = Number.isFinite(rawRotation)
    ? (((Math.round(rawRotation / 90) * 90) % 360) + 360) % 360
    : 0;

  const quality = cleanText(result?.imageQuality).toLowerCase();
  const isDryingReport = result?.isDryingReport === true || result?.isDryingReport === 'true';

  return {
    isDryingReport,
    // ถ้าไม่ใช่รายงาน ไม่ต้องหมุนภาพ
    rotationDegrees: isDryingReport ? rotationDegrees : 0,
    reportDate: dashToBlank(result?.reportDate),
    imageQuality: IMAGE_QUALITIES.includes(quality) ? quality : 'unknown',
  };
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS,
      });
    }

    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    try {
      if (!env.GEMINI_API_KEY) {
        throw new Error('ยังไม่ได้ตั้งค่า GEMINI_API_KEY ใน Cloudflare');
      }

      let body;
      try {
        body = await request.json();
      } catch {
        throw new Error('ข้อมูล Request ไม่ใช่ JSON ที่ถูกต้อง');
      }

      const imageBase64 = cleanText(body?.imageBase64).replace(
        /^data:image\/[a-zA-Z0-9.+-]+;base64,/,
        ''
      );

      if (!imageBase64) {
        throw new Error('ไม่พบข้อมูลรูปภาพ imageBase64');
      }

      // โหมด precheck: คำถามสั้นๆ ครั้งเดียว ไม่แตะการอ่านรายงานเต็ม
      if (body?.mode === 'precheck') {
        const precheck = await callGemini({
          apiKey: env.GEMINI_API_KEY,
          models: getPrecheckModels(env),
          imageBase64,
          systemInstruction: PRECHECK_SYSTEM,
          prompt: PRECHECK_PROMPT,
          maxOutputTokens: 2048,
        });

        return jsonResponse({
          ...normalizePrecheckResult(precheck.data),
          modelUsed: precheck.model,
          mode: 'precheck',
        });
      }

      // รอบหลัก: ตัวเลข ชนิดแป้ง และ Remark
      const mainPass = await callGemini({
        apiKey: env.GEMINI_API_KEY,
        models: getModels(env),
        imageBase64,
        systemInstruction: MAIN_SYSTEM,
        prompt: MAIN_PROMPT,
      });

      let normalized = normalizeMainResult(mainPass.data);

      // รอบเครื่องหมาย: แยกออกจากตัวเลขเพื่อลดการรบกวนสายตา
      // เริ่มจากรุ่นที่ใช้ได้ในรอบแรก
      const markPass = await callGemini({
        apiKey: env.GEMINI_API_KEY,
        models: getModels(env, mainPass.model),
        imageBase64,
        systemInstruction: MARK_SYSTEM,
        prompt: MARK_PROMPT,
      });

      normalized = {
        ...normalized,
        rows: mergeMarkResult(normalized.rows, markPass.data),
      };

      // ไม่มีรอบที่ 3 และไม่มีการเติมค่าจากแถวข้างเคียงโดยเด็ดขาด
      const warnings = structuralWarnings(normalized.rows);

      return jsonResponse({
        ...normalized,
        modelUsed: mainPass.model,
        markModelUsed: markPass.model,
        ocrMode: 'full-image-no-ink-dash-v21',
        warnings,
      });
    } catch (error) {
      console.error(error);
      return jsonResponse(
        {
          error: error?.message || 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ',
        },
        500
      );
    }
  },
};
