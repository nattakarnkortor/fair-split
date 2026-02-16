import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from "react-router-dom";
import App from './App.jsx'
import GuestPay from './GuestPay.jsx'

// ✅ ใช้ import.meta.env.BASE_URL เพื่อดึงค่า base จาก vite.config.js อัตโนมัติ
// หรือจะใส่เป็น basename="/fair-split" ตรงๆ ก็ได้ครับ

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter basename="/fair-split">  {/* 👈 เพิ่มตรงนี้ครับ */}
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/pay/:roomId" element={<GuestPay />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)