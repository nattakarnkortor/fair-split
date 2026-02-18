// GuestPay.jsx
import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db } from './firebase'; 
import { doc, getDoc } from 'firebase/firestore';
import { QRCodeCanvas } from 'qrcode.react';
import { 
  ArrowLeft, Receipt, User, Loader2, 
  AlertCircle, CheckCircle, Utensils, Download, Check
} from 'lucide-react';
import './GuestPay.css';

const avatarEmojis = [
  "😎","🔥","🐱","🐶","🦊","🐼","🐵","🐯","🐨",
  "🦁","🐸","🐻","🐰","🦄","👻","🤖","👽","💀",
  "🍕","🍔","🍟","🍣","🍩","🍿","🥑","🌮","🌈"
];

const getRandomAvatar = () => {
  return avatarEmojis[
    Math.floor(Math.random() * avatarEmojis.length)
  ];
};

// ✅ Helper: Format เงิน (ปรับแก้ตามสั่ง)
// - ถ้าเป็นจำนวนเต็ม -> ไม่แสดงจุดทศนิยม (20)
// - ถ้ามีเศษ -> แสดง 2 ตำแหน่ง (20.50)
const formatCurrency = (amount) => {
    const num = Number(amount);
    if (Number.isInteger(num)) {
        return num.toLocaleString('en-US');
    }
    return num.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
};

// --- Helper: สร้าง Payload PromptPay ---
function generatePromptPayPayload(target, amount) {
  const sanitize = (str) => str.replace(/[^0-9]/g, '');
  let targetSanitized = sanitize(target || '');
  let targetType = targetSanitized.length >= 13 ? '13' : (targetSanitized.length >= 10 ? '10' : null);
  if (!targetType) return null;

  let payload = '000201';
  payload += amount ? '010212' : '010211';
  let merchantInfo = '0016A000000677010111';
  if (targetType === '10') {
    if (targetSanitized.startsWith('0')) targetSanitized = '66' + targetSanitized.substring(1);
    merchantInfo += '011300' + targetSanitized;
  } else {
    merchantInfo += '0213' + targetSanitized;
  }
  payload += '29' + merchantInfo.length.toString().padStart(2, '0') + merchantInfo;
  payload += '5802TH' + '5303764';
  if (amount) {
    const amtStr = parseFloat(amount).toFixed(2);
    payload += '54' + amtStr.length.toString().padStart(2, '0') + amtStr;
  }
  payload += '6304';
  const crc = (str) => {
    let crc = 0xFFFF;
    for (let i = 0; i < str.length; i++) {
      let x = ((crc >> 8) ^ str.charCodeAt(i)) & 0xFF;
      x ^= x >> 4;
      crc = ((crc << 8) ^ (x << 12) ^ (x << 5) ^ x) & 0xFFFF;
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
  };
  return payload + crc(payload);
}

// --- Helper: คำนวณยอดเงิน ---
const calculateMyBill = (roomData, myName) => {
  if (!roomData || !myName) return null;

  const myItems = [];
  let myTotalFood = 0;

  roomData.items.forEach(item => {
    if (item.participants.includes(myName)) {
      const pricePerHead = item.price / item.participants.length;
      myItems.push({
        name: item.name,
        price: pricePerHead,
        fullPrice: item.price,
        sharedBy: item.participants.length
      });
      myTotalFood += pricePerHead;
    }
  });

  const subtotal = roomData.subtotal || 1;
  const ratio = myTotalFood / subtotal;
  
  const totalExtraCharges = (roomData.serviceChargeAmount || 0) + (roomData.vatAmount || 0);
  const myExtra = totalExtraCharges * ratio;
  const netTotal = myTotalFood + myExtra;

  return {
    items: myItems,
    totalFood: myTotalFood,
    extraCharge: myExtra,
    netTotal: netTotal
  };
};

const GuestPay = () => {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const [roomData, setRoomData] = useState(null);
  const [selectedUser, setSelectedUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // ✅ State สำหรับสถานะการดาวน์โหลด
  const [isDownloaded, setIsDownloaded] = useState(false);

  useEffect(() => {
    const fetchRoom = async () => {
      if (!roomId) return;
      try {
        const docRef = doc(db, "paymentRooms", roomId);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
          setRoomData(docSnap.data());
        } else {
          setError("ไม่พบข้อมูลห้อง หรือห้องอาจถูกปิดไปแล้ว");
        }
      } catch (err) {
        console.error(err);
        setError("เกิดข้อผิดพลาดในการดึงข้อมูล");
      }
      setLoading(false);
    };
    fetchRoom();
  }, [roomId]);

  // Reset download status when user changes
  useEffect(() => {
    setIsDownloaded(false);
  }, [selectedUser]);

  const myBillData = useMemo(() => {
    return calculateMyBill(roomData, selectedUser);
  }, [roomData, selectedUser]);

  const qrCodeValue = useMemo(() => {
    if (!myBillData || !roomData?.promptPayId) return "";
    return generatePromptPayPayload(roomData.promptPayId, myBillData.netTotal);
  }, [myBillData, roomData]);

  // ✅ ฟังก์ชันดาวน์โหลด QR Code
  const handleDownloadQR = () => {
    const canvas = document.getElementById('guest-qr-canvas');
    if (canvas) {
        const pngUrl = canvas.toDataURL("image/png");
        const downloadLink = document.createElement("a");
        downloadLink.href = pngUrl;
        downloadLink.download = `FairSplit_${selectedUser}.png`;
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);
        
        // Update status
        setIsDownloaded(true);
    }
  };

  if (loading) return (
    <div className="guest-screen-center">
      <Loader2 className="animate-spin text-primary" size={40} />
      <p>กำลังโหลดข้อมูล...</p>
    </div>
  );

  if (error) return (
    <div className="guest-screen-center text-danger">
      <AlertCircle size={48} />
      <p>{error}</p>
      <button onClick={() => navigate('/')} className="btn-secondary mt-4">กลับหน้าหลัก</button>
    </div>
  );

  // VIEW 1: เลือกชื่อ
  if (!selectedUser) {
    return (
      <div className="guest-container">
        <header className="guest-header">
          <Receipt size={32} />
          <div>
            <h1>FairSplit Guest</h1>
            <p>ห้องของ: {roomData.hostName}</p>
          </div>
        </header>

        <div className="guest-content animate-fade-in">
          <h2 className="text-center mb-6 text-gray-600">คุณคือคนไหน?</h2>
          
          <div className="member-grid">
              {roomData.members.map(member => {
                const name = typeof member === "string" ? member : member.name;
                const avatar = typeof member === "string" ? getRandomAvatar() : member.avatar || getRandomAvatar();

                return (
                  <button
                    key={name}
                    onClick={() => setSelectedUser(name)}
                    className="member-card-btn"
                  >
                    <div className="member-avatar">
                      {avatar}
                    </div>
                    <span>
                      {name === 'เรา' ? 'หัวบิล' : name}
                    </span>
                  </button>
                );
              })}
          </div>
        </div>
      </div>
    );
  }

  // VIEW 2: หน้าสลิป + จ่ายเงิน
  return (
    <div className="guest-container bg-slate-100">
      <div className="guest-nav">
        <button onClick={() => setSelectedUser(null)} className="btn-back">
          <ArrowLeft size={20} /> เลือกชื่อใหม่
        </button>
      </div>

      <div className="guest-content animate-slide-up">
        
        {/* Ticket Card */}
        <div className="ticket-paper">
          
          {/* Header Ticket */}
          <div className="ticket-top">
            <div className="ticket-user">
              <User size={16} /> บิลของ {selectedUser}
            </div>
            <div className="ticket-total-display">
              <span className="label">ยอดที่ต้องจ่าย</span>
              {/* ✅ ใช้ Helper ทศนิยม */}
              <span className="amount">{formatCurrency(myBillData.netTotal)} ฿</span>
            </div>
          </div>

          <div className="dashed-line"></div>

          {/* รายการอาหาร */}
          <div className="ticket-body">
            <h4 className="section-title"><Utensils size={14}/> รายการอาหาร</h4>
            <div className="bill-items">
              {myBillData.items.length === 0 ? (
                <p className="text-muted text-center text-sm">ไม่มีรายการอาหาร</p>
              ) : (
                myBillData.items.map((item, idx) => (
                  <div key={idx} className="bill-item-row">
                    <div className="item-info">
                      <span className="item-name">{item.name}</span>
                      {item.sharedBy > 1 && <span className="item-badge">หาร {item.sharedBy}</span>}
                    </div>
                    {/* ✅ ใช้ Helper ทศนิยม */}
                    <span className="item-price">{formatCurrency(item.price)}</span>
                  </div>
                ))
              )}
            </div>

            {/* Extra Charges */}
            {myBillData.extraCharge > 0 && (
              <div className="extra-charges mt-4 pt-2 border-t border-dashed border-gray-200">
                <div className="bill-item-row text-muted">
                  <span>ค่าธรรมเนียม/ภาษี (เฉลี่ย)</span>
                  {/* ✅ ใช้ Helper ทศนิยม */}
                  <span>{formatCurrency(myBillData.extraCharge)}</span>
                </div>
              </div>
            )}
          </div>

          {/* QR Code Section */}
          <div className="ticket-footer-qr">
            <div className="qr-wrapper">
              {roomData.promptPayId ? (
                <QRCodeCanvas 
                  id="guest-qr-canvas" // ✅ ใส่ ID เพื่อให้ดึงไป Download ได้
                  value={qrCodeValue} 
                  size={180} 
                  level="M" 
                  includeMargin={true}
                  imageSettings={{
                    src: "https://promptpay.io/img/logo.png",
                    height: 24,
                    width: 24,
                    excavate: true,
                  }}
                />
              ) : (
                <div className="no-qr">Host ยังไม่ระบุเลข PromptPay</div>
              )}
            </div>
            
            <p className="qr-prompt">สแกนจ่ายยอดนี้ได้เลย</p>
            {roomData.promptPayId && <p className="qr-id">พร้อมเพย์: {roomData.promptPayId}</p>}

            {/* ✅ ปุ่ม Download และ สถานะ */}
            {roomData.promptPayId && (
                <div className="download-section">
                    <button 
                        className={`btn-download-qr ${isDownloaded ? 'downloaded' : ''}`} 
                        onClick={handleDownloadQR}
                    >
                        {isDownloaded ? <Check size={16} /> : <Download size={16} />}
                        {isDownloaded ? 'บันทึกแล้ว' : 'บันทึก QR Code'}
                    </button>
                </div>
            )}

          </div>

        </div>

        {/* Footer info */}
        <div className="secure-badge">
           <CheckCircle size={14} /> ข้อมูลถูกต้องคำนวณจากต้นฉบับ
        </div>

      </div>
    </div>
  );
};

export default GuestPay;