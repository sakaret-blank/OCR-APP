import React, { useState, useRef } from 'react';
import { Download, FileImage, Table as TableIcon, CheckCircle2, AlertCircle, Loader2, Save, Upload, Image as ImageIcon, X, ScanLine, Server } from 'lucide-react';

// ==========================================
// ลิงก์ API Backend ของคุณ
// ==========================================
const WORKER_API_URL = 'https://ocr-api.sakaretblank.workers.dev'; 

// ฟังก์ชันบีบอัดรูปภาพก่อนส่ง ป้องกัน Timeout
const compressImage = (file, maxWidth = 1600) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ratio = maxWidth / img.width;
        const width = img.width > maxWidth ? maxWidth : img.width;
        const height = img.width > maxWidth ? img.height * ratio : img.height;

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        
        // บีบอัด JPEG 70% และตัดส่วนหัว Base64 ออก
        const base64String = canvas.toDataURL('image/jpeg', 0.7).split(',')[1];
        resolve(base64String);
      };
    };
    reader.onerror = (error) => reject(error);
  });
};

// สร้างแถวเปล่า 24 แถวตามเอกสาร
const generateEmptyData = () => {
  const times = ['08.00', '09.00', '10.00', '11.00', '12.00', '13.00', '14.00', '15.00', '16.00', '17.00', '18.00', '19.00', '20.00', '21.00', '22.00', '23.00', '24.00', '01.00', '02.00', '03.00', '04.00', '05.00', '06.00', '07.00'];
  return times.map((time, index) => ({
    id: index + 1, time, productType: '', dw1: '', dw2: '', dw3: '', dw4: '', dw5: '', hotAirIn: '', hotAirOut: '', speed: '', wetCakeMoisture: '', productMoisture: '', changeDwFilter: '', remark: '', unreadableFields: []
  }));
};

export default function App() {
  const [data, setData] = useState(generateEmptyData());
  const [docInfo, setDocInfo] = useState({ date: '-', code: 'FM-PD-010 Rev.1' });
  const [appState, setAppState] = useState('ready'); // 'ready', 'uploaded', 'scanning'
  const [saveStatus, setSaveStatus] = useState('');
  
  const [imageSrc, setImageSrc] = useState(null); 
  const [selectedFile, setSelectedFile] = useState(null);
  const [showImagePane, setShowImagePane] = useState(false);
  const fileInputRef = useRef(null);

  // จัดการเมื่อพิมพ์แก้ไขข้อมูลในเซลล์
  const handleCellChange = (index, field, value) => {
    const newData = [...data];
    newData[index][field] = value;
    
    // ลบสถานะสีเหลืองออกเมื่อมีการแก้ไข
    if (newData[index].unreadableFields?.includes(field)) {
      newData[index].unreadableFields = newData[index].unreadableFields.filter(f => f !== field);
    }
    
    setData(newData);
    setSaveStatus('Unsaved changes');
  };

  const handleSave = () => {
    setSaveStatus('Saved successfully');
    setTimeout(() => setSaveStatus(''), 2000);
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      setSelectedFile(file);
      const url = URL.createObjectURL(file);
      setImageSrc(url);
      setShowImagePane(true);
      setAppState('uploaded');
      setData(generateEmptyData()); // เคลียร์ตารางรอสแกน
      setDocInfo({ date: '-', code: 'FM-PD-010 Rev.1' });
    }
    e.target.value = null;
  };

  // ฟังก์ชันหลักสำหรับส่งรูปไปสแกน
  const handleScanDocument = async () => {
    if (!selectedFile) return;
    setAppState('scanning');
    
    try {
      // บีบอัดรูป
      const base64Image = await compressImage(selectedFile);

      // ยิง API ไปที่ Cloudflare Worker
      const response = await fetch(WORKER_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64Image })
      });

      // อ่านค่า Text ออกมาก่อนเผื่อเป็น Error Message
      const responseText = await response.text();
      let result;
      
      try {
        result = JSON.parse(responseText);
      } catch (parseError) {
        throw new Error(`เซิร์ฟเวอร์คืนค่าผิดรูปแบบ: ${responseText.substring(0, 100)}`);
      }

      // ถ้า Response ผิดพลาด โยน Error ออกไปดักจับ
      if (!response.ok) {
        throw new Error(result.error || `HTTP Error ${response.status}`);
      }

      // นำข้อมูลลงตาราง
      if (result.rows && Array.isArray(result.rows)) {
        if(result.reportDate) setDocInfo(prev => ({ ...prev, date: result.reportDate }));
        if(result.documentCode) setDocInfo(prev => ({ ...prev, code: result.documentCode }));
        
        const formattedRows = result.rows.map((row, idx) => ({
          ...row,
          id: idx + 1,
          unreadableFields: Array.isArray(row.unreadableFields) ? row.unreadableFields : []
        }));
        
        setData(formattedRows);
      } else {
        throw new Error("AI ส่งข้อมูลกลับมาแต่ไม่พบรายการแถว (rows)");
      }
      
      setAppState('ready');
      setSaveStatus('');
      
    } catch (error) {
      console.error("Scanning failed:", error);
      alert(`⚠️ เกิดข้อผิดพลาดในการสแกน:\n${error.message}\n\nกรุณาลองใหม่อีกครั้ง หรือเช็คการตั้งค่า API`);
      setAppState('uploaded'); // กลับไปหน้าพร้อมสแกน ไม่ให้ค้าง
    }
  };

  const triggerFileInput = () => {
    fileInputRef.current.click();
  };

  const exportToCSV = () => {
    let csvContent = "Time,PRODUCT TYPE,DW1,DW2,DW3,DW4,DW5,HOT AIR IN,HOT AIR OUT,% SPEED CS102,% WET CAKE MOISTURE,% PRODUCT MOISTURE,Change On-filter,REMARK\n";
    data.forEach(row => {
      const rowData = [
        row.time, `"${row.productType || ''}"`, row.dw1 || '', row.dw2 || '', row.dw3 || '', row.dw4 || '', row.dw5 || '',
        row.hotAirIn || '', row.hotAirOut || '', row.speed || '', `"${row.wetCakeMoisture || ''}"`, `"${row.productMoisture || ''}"`, row.changeDwFilter || '', `"${row.remark || ''}"`
      ];
      csvContent += rowData.join(",") + "\n";
    });

    const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `report_${docInfo.date !== '-' ? docInfo.date.replace(/\//g, '') : new Date().getTime()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // เช็คคลาสเพื่อไฮไลท์สีเหลืองช่องที่อ่านไม่ออก
  const getCellClass = (row, fieldName, baseClass) => {
    const isUnreadable = row.unreadableFields?.includes(fieldName);
    return `${baseClass} ${isUnreadable ? 'bg-yellow-200 focus:bg-yellow-100 placeholder:text-yellow-600 font-bold' : 'bg-transparent focus:bg-white'}`;
  };

  if (appState === 'scanning') {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center space-y-4">
        <Loader2 className="w-12 h-12 text-blue-600 animate-spin" />
        <h2 className="text-xl font-semibold text-slate-700">กำลังประมวลผลเอกสาร...</h2>
        <p className="text-slate-500">บีบอัดภาพ และส่งไปให้ AI วิเคราะห์ (อาจใช้เวลา 10-20 วินาที)</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 p-2 md:p-4 font-sans flex flex-col">
      <div className="max-w-screen-2xl mx-auto w-full bg-white rounded-xl shadow-lg border border-slate-200 overflow-hidden flex flex-col flex-1 h-[95vh]">
        
        {/* Header */}
        <header className="bg-white border-b border-slate-200 px-4 py-3 flex flex-wrap items-center justify-between gap-4 shrink-0">
          <div className="flex items-center space-x-3">
            <div className="bg-blue-100 p-2 rounded-lg">
              <TableIcon className="w-6 h-6 text-blue-700" />
            </div>
            <div>
              <h1 className="text-lg md:text-xl font-bold text-slate-800 leading-tight">ระบบตรวจสอบเอกสาร (Production)</h1>
              <p className="text-xs md:text-sm text-slate-500">{docInfo.code} | สแกนวันที่: {docInfo.date}</p>
            </div>
          </div>
          
          <div className="flex items-center space-x-2 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
            <input 
              type="file" 
              accept="image/*" 
              ref={fileInputRef} 
              onChange={handleImageUpload} 
              className="hidden" 
            />
            
            {appState === 'uploaded' ? (
              <button 
                onClick={handleScanDocument}
                className="px-4 py-2 bg-emerald-600 border border-emerald-700 rounded-lg text-white hover:bg-emerald-700 flex items-center text-sm font-bold transition-all shadow-md animate-pulse whitespace-nowrap"
              >
                <ScanLine className="w-5 h-5 mr-2" />
                เริ่มสแกนและแปลงเป็นตาราง
              </button>
            ) : (
              <button 
                onClick={triggerFileInput}
                className="px-3 py-2 bg-indigo-50 border border-indigo-200 rounded-lg text-indigo-700 hover:bg-indigo-100 flex items-center text-sm font-medium transition-colors whitespace-nowrap"
              >
                <Upload className="w-4 h-4 mr-2" />
                อัปโหลดรูปใหม่
              </button>
            )}

            {imageSrc && (
              <button 
                onClick={() => setShowImagePane(!showImagePane)}
                className={`px-3 py-2 border rounded-lg flex items-center text-sm font-medium transition-colors whitespace-nowrap ${showImagePane ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'}`}
              >
                <ImageIcon className="w-4 h-4 mr-2" />
                {showImagePane ? 'ซ่อนรูป' : 'ดูรูปอ้างอิง'}
              </button>
            )}
            
            <div className="h-6 w-px bg-slate-300 mx-1"></div>
            
            {appState === 'ready' && (
              <>
                <button 
                  onClick={handleSave}
                  className="px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 flex items-center text-sm font-medium transition-colors whitespace-nowrap"
                >
                  <Save className="w-4 h-4 mr-1 md:mr-2" />
                  <span className="hidden md:inline">บันทึก</span>
                </button>
                <button 
                  onClick={exportToCSV}
                  className="px-3 py-2 bg-blue-600 rounded-lg text-white hover:bg-blue-700 flex items-center text-sm font-medium transition-colors shadow-sm whitespace-nowrap"
                >
                  <Download className="w-4 h-4 mr-1 md:mr-2" />
                  <span className="hidden md:inline">ส่งออก CSV</span>
                </button>
              </>
            )}
          </div>
        </header>

        {/* Info Bar */}
        <div className="bg-blue-50 px-4 py-2 text-xs md:text-sm flex items-center justify-between text-blue-800 border-b border-blue-100 shrink-0">
          <div className="flex items-center">
            <Server className="w-4 h-4 mr-2 flex-shrink-0" />
            <span>
              ช่องที่มี <strong>สีเหลือง</strong> คือข้อมูลที่ AI อ่านลายมือไม่ออก/เว้นว่างไว้ กรุณาพิมพ์แก้ไข (พิมพ์เสร็จสีจะหายไป)
            </span>
          </div>
        </div>

        {/* Main Area (Split Pane) */}
        <div className="flex-1 overflow-hidden flex flex-col lg:flex-row bg-slate-200">
          
          {/* Image Preview */}
          {(showImagePane || appState === 'uploaded') && imageSrc && (
            <div className={`w-full bg-slate-900 flex flex-col relative shrink-0 ${appState === 'uploaded' ? 'h-full lg:w-full' : 'h-1/2 lg:h-full lg:w-2/5 border-b lg:border-b-0 lg:border-r border-slate-300'}`}>
              {appState === 'ready' && (
                <div className="absolute top-2 right-2 z-10 flex space-x-2">
                  <button onClick={() => setShowImagePane(false)} className="p-1.5 bg-black/50 text-white rounded-md hover:bg-black/70 backdrop-blur-sm">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}
              <div className="flex-1 overflow-auto p-4 flex items-center justify-center">
                <img 
                  src={imageSrc} 
                  alt="Scanned Document" 
                  className="max-w-full h-auto max-h-full object-contain rounded shadow-lg border border-slate-700"
                />
              </div>
              <div className="p-2 bg-slate-800 text-xs text-slate-300 text-center">
                ภาพเอกสารอ้างอิง
              </div>
            </div>
          )}

          {/* Data Table */}
          {appState === 'ready' && (
            <div className="flex-1 overflow-auto bg-white relative">
              <table className="w-full text-xs md:text-sm text-left border-collapse min-w-[1000px]">
                <thead className="bg-slate-100 text-slate-700 sticky top-0 z-10 text-center font-semibold text-[11px] md:text-xs uppercase tracking-wider shadow-sm">
                  <tr>
                    <th rowSpan="2" className="border-b-2 border-r border-slate-300 p-2 min-w-[50px] bg-slate-200">Time</th>
                    <th rowSpan="2" className="border-b-2 border-r border-slate-300 p-2 min-w-[120px] bg-slate-200">PRODUCT TYPE</th>
                    <th colSpan="5" className="border-b border-r border-slate-300 p-1.5 bg-blue-50/80">DW RUNING</th>
                    <th colSpan="2" className="border-b border-r border-slate-300 p-1.5 bg-orange-50/80">HOT AIR TEMP</th>
                    <th rowSpan="2" className="border-b-2 border-r border-slate-300 p-2 whitespace-pre-wrap bg-slate-100">% SPEED<br/>CS102</th>
                    <th rowSpan="2" className="border-b-2 border-r border-slate-300 p-2 whitespace-pre-wrap bg-slate-100">% WET CAKE<br/>MOISTURE</th>
                    <th rowSpan="2" className="border-b-2 border-r border-slate-300 p-2 whitespace-pre-wrap bg-slate-100">% PRODUCT<br/>MOISTURE</th>
                    <th rowSpan="2" className="border-b-2 border-r border-slate-300 p-2 whitespace-pre-wrap bg-slate-100">Change<br/>On-filter</th>
                    <th rowSpan="2" className="border-b-2 border-slate-300 p-2 min-w-[150px] bg-slate-100">REMARK</th>
                  </tr>
                  <tr>
                    <th className="border-b-2 border-r border-slate-300 p-1 w-8 bg-blue-50/80">1</th>
                    <th className="border-b-2 border-r border-slate-300 p-1 w-8 bg-blue-50/80">2</th>
                    <th className="border-b-2 border-r border-slate-300 p-1 w-8 bg-blue-50/80">3</th>
                    <th className="border-b-2 border-r border-slate-300 p-1 w-8 bg-blue-50/80">4</th>
                    <th className="border-b-2 border-r border-slate-300 p-1 w-8 bg-blue-50/80">5</th>
                    <th className="border-b-2 border-r border-slate-300 p-1 min-w-[60px] bg-orange-50/80">IN</th>
                    <th className="border-b-2 border-r border-slate-300 p-1 min-w-[60px] bg-orange-50/80">OUT</th>
                  </tr>
                </thead>
                <tbody className="text-slate-800">
                  {data.map((row, index) => (
                    <tr key={row.id} className="hover:bg-blue-50/40 border-b border-slate-200 transition-colors group">
                      <td className="border-r border-slate-200 text-center bg-slate-50/50 font-medium">{row.time}</td>
                      <td className="border-r border-slate-200 p-0 relative">
                        <input type="text" value={row.productType || ''} onChange={(e) => handleCellChange(index, 'productType', e.target.value)}
                              className={getCellClass(row, 'productType', "w-full h-full p-1.5 md:p-2 border-2 border-transparent focus:border-blue-500 outline-none text-center")} />
                      </td>
                      {['dw1', 'dw2', 'dw3', 'dw4', 'dw5'].map((dwField) => (
                        <td key={dwField} className="border-r border-slate-200 p-0 text-center">
                          <input type="text" value={row[dwField] || ''} onChange={(e) => handleCellChange(index, dwField, e.target.value)}
                                className={getCellClass(row, dwField, "w-full h-full p-1 border-2 border-transparent focus:border-blue-500 outline-none text-center text-blue-600 font-bold")} />
                        </td>
                      ))}
                      <td className="border-r border-slate-200 p-0">
                        <input type="text" value={row.hotAirIn || ''} onChange={(e) => handleCellChange(index, 'hotAirIn', e.target.value)}
                              className={getCellClass(row, 'hotAirIn', "w-full h-full p-1.5 md:p-2 border-2 border-transparent focus:border-blue-500 outline-none text-center")} />
                      </td>
                      <td className="border-r border-slate-200 p-0">
                        <input type="text" value={row.hotAirOut || ''} onChange={(e) => handleCellChange(index, 'hotAirOut', e.target.value)}
                              className={getCellClass(row, 'hotAirOut', "w-full h-full p-1.5 md:p-2 border-2 border-transparent focus:border-blue-500 outline-none text-center")} />
                      </td>
                      <td className="border-r border-slate-200 p-0">
                        <input type="text" value={row.speed || ''} onChange={(e) => handleCellChange(index, 'speed', e.target.value)}
                              className={getCellClass(row, 'speed', "w-full h-full p-1.5 md:p-2 border-2 border-transparent focus:border-blue-500 outline-none text-center")} />
                      </td>
                      <td className="border-r border-slate-200 p-0">
                        <input type="text" value={row.wetCakeMoisture || ''} onChange={(e) => handleCellChange(index, 'wetCakeMoisture', e.target.value)}
                              className={getCellClass(row, 'wetCakeMoisture', "w-full h-full p-1.5 md:p-2 border-2 border-transparent focus:border-blue-500 outline-none text-center")} />
                      </td>
                      <td className="border-r border-slate-200 p-0">
                        <input type="text" value={row.productMoisture || ''} onChange={(e) => handleCellChange(index, 'productMoisture', e.target.value)}
                              className={getCellClass(row, 'productMoisture', "w-full h-full p-1.5 md:p-2 border-2 border-transparent focus:border-blue-500 outline-none text-center")} />
                      </td>
                      <td className="border-r border-slate-200 p-0 text-center">
                        <input type="text" value={row.changeDwFilter || ''} onChange={(e) => handleCellChange(index, 'changeDwFilter', e.target.value)}
                              className={getCellClass(row, 'changeDwFilter', "w-full h-full p-1.5 md:p-2 border-2 border-transparent focus:border-blue-500 outline-none text-center text-blue-600 font-bold")} />
                      </td>
                      <td className="p-0">
                        <input type="text" value={row.remark || ''} onChange={(e) => handleCellChange(index, 'remark', e.target.value)}
                              className={getCellClass(row, 'remark', "w-full h-full p-1.5 md:p-2 border-2 border-transparent focus:border-blue-500 outline-none text-left text-red-600 text-xs sm:text-sm")} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}