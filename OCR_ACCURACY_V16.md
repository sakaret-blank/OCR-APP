# OCR Accuracy v16 — Crop-Based OCR

- Frontend ครอปภาพจริงเป็น Header + ตาราง 3 ส่วนก่อนส่ง Worker
- Worker ส่ง Gemini เฉพาะภาพ 8 แถวต่อครั้ง ไม่ส่งภาพเต็มซ้ำ
- ใช้ `systemInstruction` และ Structured JSON Schema
- DW1–DW5 และ Filter ใช้ Boolean แล้วแปลงเป็น `/` หรือว่าง
- ช่องว่างคืน `null` และ Worker แปลงเป็นช่องว่าง ห้ามเติมค่าจากแถวข้างเคียง
- แต่ละแถวมี `confidence` และ `unreadableFields` สำหรับแจ้งตรวจสอบ

ต้องอัปเดตทั้ง Frontend และ Cloudflare Worker พร้อมกัน
