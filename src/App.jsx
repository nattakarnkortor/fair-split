// App.jsx
// ======================================================
// 🔷 IMPORTS
// ======================================================

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './App.css';
import { QRCodeCanvas } from 'qrcode.react';
import Swal from "sweetalert2";

import {
  Plus, Trash2, Users, Receipt, Check, Coffee, X, Edit2, RefreshCw,
  Percent, Smartphone, ArrowRight, Menu, LayoutDashboard, UtensilsCrossed,
  Wallet, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, LogOut,
  History, Save, FileText, Calendar, User, Share2, Copy, CheckCircle, Link // ✅ เพิ่มไอคอนครบแล้ว
} from 'lucide-react';

import { auth, googleProvider, db } from './firebase';
import { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import {
  collection, addDoc, query, where,
  getDocs, orderBy, deleteDoc, doc
} from 'firebase/firestore';


// ======================================================
// 🔷 HELPER FUNCTIONS (PURE LOGIC)
// ======================================================

function generatePromptPayPayload(target, amount) {
  const sanitize = (str) => str.replace(/[^0-9]/g, '');
  let targetSanitized = sanitize(target);

  let targetType =
    targetSanitized.length >= 13
      ? '13'
      : (targetSanitized.length >= 10 ? '10' : null);

  if (!targetType) return null;

  let payload = '000201';
  payload += amount ? '010212' : '010211';

  let merchantInfo = '0016A000000677010111';

  if (targetType === '10') {
    if (targetSanitized.startsWith('0')) {
      targetSanitized = '66' + targetSanitized.substring(1);
    }
    merchantInfo += '011300' + targetSanitized;
  } else {
    merchantInfo += '0213' + targetSanitized;
  }

  payload +=
    '29' +
    merchantInfo.length.toString().padStart(2, '0') +
    merchantInfo;

  payload += '5802TH';
  payload += '5303764';

  if (amount) {
    const amtStr = parseFloat(amount).toFixed(2);
    payload +=
      '54' +
      amtStr.length.toString().padStart(2, '0') +
      amtStr;
  }

  payload += '6304';

  const crc = (str) => {
    let crc = 0xFFFF;
    let x;
    for (let i = 0; i < str.length; i++) {
      x = ((crc >> 8) ^ str.charCodeAt(i)) & 0xFF;
      x ^= x >> 4;
      crc =
        ((crc << 8) ^ (x << 12) ^ (x << 5) ^ x) &
        0xFFFF;
    }
    return crc
      .toString(16)
      .toUpperCase()
      .padStart(4, '0');
  };

  return payload + crc(payload);
}

const getMemberBreakdown = (bill) => {
  const breakdown = {};

  bill.members.forEach(m => {
    breakdown[m] = {
      items: [],
      totalFood: 0,
      extraCharge: 0,
      netTotal: 0
    };
  });

  bill.items.forEach(item => {
    const pricePerHead =
      item.price / item.participants.length;

    item.participants.forEach(person => {
      if (breakdown[person]) {
        breakdown[person].items.push({
          name: item.name,
          price: pricePerHead
        });
        breakdown[person].totalFood += pricePerHead;
      }
    });
  });

  const totalExtra =
    (bill.serviceChargeAmount || 0) +
    (bill.vatAmount || 0);

  const subtotal = bill.subtotal || 1;

  Object.keys(breakdown).forEach(m => {
    const ratio =
      breakdown[m].totalFood / subtotal;

    const myExtra = totalExtra * ratio;

    breakdown[m].extraCharge = myExtra;
    breakdown[m].netTotal =
      breakdown[m].totalFood + myExtra;
  });

  return breakdown;
};


// ======================================================
// 🔷 MAIN COMPONENT
// ======================================================

const App = () => {
  const navigate = useNavigate();

  // ==================================================
  // 🔹 CORE STATE (Bill Data)
  // ==================================================

  const [members, setMembers] = useState(() => {
    const saved = localStorage.getItem('fs_members');
    return saved ? JSON.parse(saved) : ['เรา'];
  });

  const [items, setItems] = useState(() => {
    const saved = localStorage.getItem('fs_items');
    return saved ? JSON.parse(saved) : [];
  });

  // ==================================================
  // 🔹 UI STATE
  // ==================================================

  const [activeTab, setActiveTab] = useState('home');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState({});
  
  // ✅ State สำหรับ Modal แชร์ห้อง
  const [createdRoom, setCreatedRoom] = useState(null);
  const [isCopiedLink, setIsCopiedLink] = useState(false);

  const [confirmConfig, setConfirmConfig] = useState({
    open: false,
    title: '',
    message: '',
    onConfirm: null
  });

  const closeConfirm = () => {
    setConfirmConfig(prev => ({
      ...prev,
      open: false
    }));
  };

  const openConfirm = (title, message, onConfirm) => {
    setConfirmConfig({
      open: true,
      title,
      message,
      onConfirm
    });
  };

  // ==================================================
  // 🔹 BILL OPTIONS
  // ==================================================

  const [useVat, setUseVat] = useState(
    () => localStorage.getItem('fs_useVat') === 'true'
  );

  const [useServiceCharge, setUseServiceCharge] = useState(
    () => localStorage.getItem('fs_useSVC') === 'true'
  );

  const [serviceChargePercent, setServiceChargePercent] =
    useState(() =>
      Number(localStorage.getItem('fs_svcPercent')) || 10
    );

  const [svcString, setSvcString] =
    useState(() =>
      localStorage.getItem('fs_svcPercent') || "10"
    );

  // ==================================================
  // 🔹 FORM INPUT STATE
  // ==================================================

  const [memberName, setMemberName] = useState('');
  const [itemName, setItemName] = useState('');
  const [itemPrice, setItemPrice] = useState('');
  const [itemQty, setItemQty] = useState('1');

  const [promptPayId, setPromptPayId] =
    useState(() =>
      localStorage.getItem('fs_promptPay') || ''
    );

  const [showQR, setShowQR] = useState(false);

  // ==================================================
  // 🔹 AUTH & HISTORY STATE
  // ==================================================

  const [user, setUser] = useState(null);
  const [historyList, setHistoryList] = useState([]);
  const [viewingBill, setViewingBill] = useState(null);


  // ==================================================
  // 🔹 EFFECTS
  // ==================================================

  // 🔸 Auto Save
  useEffect(() => {
    localStorage.setItem('fs_members', JSON.stringify(members));
    localStorage.setItem('fs_items', JSON.stringify(items));
    localStorage.setItem('fs_useVat', useVat);
    localStorage.setItem('fs_useSVC', useServiceCharge);
    localStorage.setItem('fs_svcPercent', serviceChargePercent);
    localStorage.setItem('fs_promptPay', promptPayId);
  }, [
    members,
    items,
    useVat,
    useServiceCharge,
    serviceChargePercent,
    promptPayId
  ]);

  // 🔸 Auth Listener
  useEffect(() => {
    const unsubscribe =
      onAuthStateChanged(auth, (currentUser) => {
        setUser(currentUser);
      });

    return () => unsubscribe();
  }, []);

  // ==================================================
  // 🔹 DERIVED DATA (COMPUTED VALUES)
  // ==================================================

  const groupedItems = useMemo(() => {
    const groups = {};

    items.forEach(item => {
      const groupKey =
        item.baseName ||
        item.name.replace(/\s\(\d+\)$/, '');

      if (!groups[groupKey]) {
        groups[groupKey] = [];
      }

      groups[groupKey].push(item);
    });

    return groups;
  }, [items]);


  useEffect(() => {
    if (items.length > 0) {

      const newGroups = {};

      Object.keys(groupedItems).forEach(g => {
        if (expandedGroups[g] === undefined) {
          newGroups[g] = false;
        }
      });

      if (Object.keys(newGroups).length > 0) {
        setExpandedGroups(prev => ({
          ...prev,
          ...newGroups
        }));
      }
    }
  }, [groupedItems]);


  const {
    subtotal,
    serviceChargeAmount,
    vatAmount,
    grandTotal,
    memberShares
  } = useMemo(() => {

    let rawTotal = 0;
    let shares = {};

    members.forEach(m => {
      shares[m] = 0;
    });

    items.forEach(item => {

      const safePrice = Number(item.price) || 0;
      rawTotal += safePrice;

      const count = item.participants.length;

      if (count > 0) {
        const pricePerPerson = safePrice / count;

        item.participants.forEach(p => {
          if (shares[p] !== undefined) {
            shares[p] += pricePerPerson;
          }
        });
      }
    });

    const svcRate =
      useServiceCharge
        ? (serviceChargePercent / 100)
        : 0;

    const vatRate =
      useVat ? 0.07 : 0;

    const calculatedSvc = rawTotal * svcRate;

    const vatableAmount =
      rawTotal + calculatedSvc;

    const calculatedVat =
      vatableAmount * vatRate;

    const calculatedGrandTotal =
      rawTotal + calculatedSvc + calculatedVat;

    if (rawTotal > 0) {
      Object.keys(shares).forEach(m => {

        const userRawShare = shares[m];
        const userSvc = userRawShare * svcRate;
        const userVatable = userRawShare + userSvc;
        const userVat = userVatable * vatRate;

        shares[m] =
          userRawShare + userSvc + userVat;
      });
    }

    return {
      subtotal: rawTotal,
      serviceChargeAmount: calculatedSvc,
      vatAmount: calculatedVat,
      grandTotal: calculatedGrandTotal,
      memberShares: shares
    };

  }, [
    items,
    members,
    useVat,
    useServiceCharge,
    serviceChargePercent
  ]);


// ==================================================
// 🔹 AUTH ACTIONS
// ==================================================

const loginMessages = [
  "กินข้าวมื้อนี้ให้อร่อยนะ 🍜",
  "อย่าลืมหารให้ครบทุกคนนะ 😆",
  "อิ่มจังตังอยู่ครบ อิ อิ 😜",
  "บิลนี้ไม่มีใครหนีแน่นอน 💸",
  "ขอให้มื้อนี้อิ่มแบบแฟร์ ๆ 😋",
  "หารง่าย จ่ายสบาย 👍",
  "มื้อนี้อร่อยแน่ แต่อย่าลืมกดเลือกคนกินด้วยนะ 😏",
  "กินได้เต็มที่ เดี๋ยวระบบช่วยคำนวณให้เอง 🤖",
  "อิ่มก่อน คิดเงินทีหลัง เดี๋ยวแอปจัดการให้ 🍽️",
  "สายแดกตัวจริง ต้องไม่ลืมหารนะ 🤭",
  "กินเยอะแค่ไหน ก็แฟร์ได้ 💙",
  "เพื่อนรักต้องหารเท่า ๆ กันนะ 🫶",
  "สั่งได้ไม่อั้น แต่ต้องเลือกคนกินด้วยนะ 😎",
  "จ่ายครบ ไม่มีดราม่า ✨",
  "วันนี้อิ่มท้อง พรุ่งนี้อิ่มใจ 😆",
  "ระบบพร้อมแล้ว ลุยสั่งอาหารเลย 🔥",
  "มื้อนี้ไม่มีคำว่าโกง มีแต่คำว่าแฟร์ 🤝",
  "กินกันให้สุด แล้วหยุดที่ความยุติธรรม ⚖️",
  "หารดี ๆ ชีวิตจะดีเอง 😂",
  "แค่กินอย่างเดียวไม่พอ ต้องกดเลือกชื่อด้วยนะ 😝"
];

const handleLogin = async () => {
  try {
    const result = await signInWithPopup(auth, googleProvider);

    const randomMessage =
      loginMessages[Math.floor(Math.random() * loginMessages.length)];

    Swal.fire({
      icon: "success",
      title: `ยินดีต้อนรับ ${result.user.displayName}`,
      text: randomMessage,
      confirmButtonText: "เริ่มหารเลย",
      buttonsStyling: false,
      customClass: {
        confirmButton: "swal-primary-btn"
      }
    });

  } catch (error) {
    console.error("Login Error:", error);

    Swal.fire({
      icon: "error",
      title: "เข้าสู่ระบบไม่สำเร็จ",
      text: "กรุณาลองใหม่อีกครั้ง",
      confirmButtonText: "ตกลง",
      buttonsStyling: false,
      customClass: {
        confirmButton: "swal-primary-btn"
      }
    });
  }
};

const handleLogout = () => {
  openConfirm(
    "ออกจากระบบ",
    "คุณต้องการออกจากระบบใช่ไหม?",
    async () => {
      await signOut(auth);
      setHistoryList([]);
      closeConfirm();

      Swal.fire({
        icon: "success",
        title: "ออกจากระบบแล้ว",
        text: "แล้วพบกันใหม่นะ 👋",
        confirmButtonText: "ตกลง",
        buttonsStyling: false,
        customClass: {
          confirmButton: "swal-primary-btn"
        }
      });
    }
  );
};

  // ==================================================
  // 🔹 BILL ACTIONS
  // ==================================================

  const saveBillToHistory = async () => {

    if (!user) {
      return Swal.fire({
        icon: "warning",
        title: "ยังไม่ได้เข้าสู่ระบบ",
        text: "กรุณาเข้าสู่ระบบก่อนบันทึกบิล",
        confirmButtonText: "ตกลง",
        buttonsStyling: false,
        customClass: {
          confirmButton: "swal-primary-btn"
        }
      });
    }

    if (items.length === 0) {
      return Swal.fire({
        icon: "error",
        title: "ไม่มีรายการอาหาร",
        text: "กรุณาเพิ่มรายการอาหารก่อนบันทึก",
        confirmButtonText: "ตกลง",
        buttonsStyling: false,
        customClass: {
          confirmButton: "swal-primary-btn"
        }
      });
}

    try {
      await addDoc(collection(db, "bills"), {
        uid: user.uid,
        billName:
          `บิลวันที่ ${
            new Date().toLocaleDateString('th-TH')
          } ${
            new Date().toLocaleTimeString('th-TH')
          }`,
        date: new Date(),
        items: items,
        members: members,
        totalAmount: grandTotal,
        subtotal: subtotal,
        serviceChargeAmount: serviceChargeAmount,
        vatAmount: vatAmount
      });

      Swal.fire({
        icon: "success",
        title: "บันทึกสำเร็จ",
        text: "บันทึกบิลของคุณเรียบร้อยแล้ว",
        confirmButtonText: "ตกลง",
        buttonsStyling: false,
        customClass: {
          confirmButton: "swal-primary-btn"
        }
      });

    } catch (error) {
      console.error("Error adding document: ", error);
      alert("บันทึกไม่สำเร็จ ❌");
    }
  };


  const fetchHistory = async () => {
    if (!user) return;
    try {
      const q = query(
        collection(db, "bills"),
        where("uid", "==", user.uid),
        orderBy("date", "desc")
      );

      const querySnapshot = await getDocs(q);

      const bills =
        querySnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));

      setHistoryList(bills);

    } catch (error) {
      console.error("Error fetching history:", error);
    }
  };


  useEffect(() => {
    if (activeTab === 'history' && user) {
      fetchHistory();
    }
  }, [activeTab, user]);

  const deleteHistoryItem = async (id) => {
    openConfirm(
      "ยืนยันการลบ",
      "ต้องการลบบิลนี้ใช่ไหม?",
      async () => {
        await deleteDoc(doc(db, "bills", id));
        fetchHistory();
        closeConfirm();
      }
    );
  };


const handleClearBill = () => {
  openConfirm(
    "ยืนยันการล้างบิล",
    "ต้องการล้างบิลทั้งหมดและเริ่มใหม่ใช่ไหม?",
    () => {

      setMembers(['เรา']);
      setItems([]);

      setUseVat(false);
      setUseServiceCharge(false);

      setServiceChargePercent(10);
      setSvcString("10");

      setMemberName('');
      setItemName('');
      setItemPrice('');
      setItemQty('1');

      setPromptPayId('');
      setShowQR(false);
      setActiveTab('members');

      localStorage.removeItem('fs_members');
      localStorage.removeItem('fs_items');
      localStorage.removeItem('fs_useVat');
      localStorage.removeItem('fs_useSVC');
      localStorage.removeItem('fs_svcPercent');

      closeConfirm();
    }
  );
};

  // ==================================================
  // ✅ HANDLE CREATE ROOM (NEW VERSION)
  // ==================================================
  const handleCreateRoom = async () => {
    // 1. เช็คความพร้อม
    if (items.length === 0) return Swal.fire("แจ้งเตือน", "ไม่มีรายการอาหาร", "warning");
    if (!promptPayId) return Swal.fire("แจ้งเตือน", "กรุณากรอกเบอร์ PromptPay ก่อนสร้างห้อง", "warning");
  
    // 2. ถามยืนยัน
    const confirm = await Swal.fire({
      title: 'สร้างห้องเก็บเงิน?',
      text: 'ระบบจะสร้างลิงก์และ QR Code ให้เพื่อนสแกน',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'สร้างเลย',
      cancelButtonText: 'ยกเลิก',
      buttonsStyling: false,
      customClass: {
        confirmButton: "swal-primary-btn",
        cancelButton: "btn-cancel"
      }
    });
  
    if (!confirm.isConfirmed) return;
  
    try {
      // 3. เตรียมข้อมูล
      const roomPayload = {
        hostName: user ? user.displayName : members[0] || "Host", 
        hostUid: user ? user.uid : "anon",
        createdAt: new Date(),
        items: items,
        members: members,
        shares: memberShares,
        promptPayId: promptPayId,
        subtotal: subtotal,
        serviceChargeAmount: serviceChargeAmount,
        vatAmount: vatAmount,
        totalAmount: grandTotal,
        config: { useVat, useServiceCharge, serviceChargePercent }
      };
  
      // 4. บันทึกลง Firebase
      const docRef = await addDoc(collection(db, "paymentRooms"), roomPayload);
      
      // 5. สร้างลิงก์ (เพิ่ม /fair-split เพื่อความชัวร์กับ basename)
      const origin = window.location.origin;
      const roomLink = `${origin}/fair-split/pay/${docRef.id}`;
      
      // 6. เปิด Modal แสดงผล
      setCreatedRoom({
        id: docRef.id,
        link: roomLink
      });
  
    } catch (error) {
      console.error(error);
      Swal.fire("Error", "สร้างห้องไม่สำเร็จ", "error");
    }
  };

  const handleCopyLink = () => {
    if (createdRoom) {
      navigator.clipboard.writeText(createdRoom.link);
      setIsCopiedLink(true);
      setTimeout(() => setIsCopiedLink(false), 2000);
    }
  };


  // ==================================================
  // 🔹 MEMBER ACTIONS
  // ==================================================

  const handleAddMember = useCallback(() => {
    if (
      memberName.trim() &&
      !members.includes(memberName.trim())
    ) {
      setMembers(prev => [
        ...prev,
        memberName.trim()
      ]);
      setMemberName('');
    }
  }, [members, memberName]);


  const handleRemoveMember = useCallback((target) => {
    if (members.length <= 1) {
      alert("ต้องมีสมาชิกอย่างน้อย 1 คน");
      return;
    }

    openConfirm(
      "ลบสมาชิก",
      `ต้องการลบ ${target} ออกใช่ไหม?`,
      () => {
        setMembers(prev =>
          prev.filter(m => m !== target)
        );

        setItems(prevItems =>
          prevItems.map(item => ({
            ...item,
            participants:
              item.participants.filter(
                p => p !== target
              )
          }))
        );
        closeConfirm();
      }
    );
  }, [members]);

    // ==================================================
  // 🔹 ITEM ACTIONS
  // ==================================================

  const handleAddItem = useCallback(() => {
    const qty = itemQty ? parseInt(itemQty) : 1;
    const cleanName = itemName.trim();

    if (cleanName && itemPrice) {
      const price = parseFloat(itemPrice);
      if (isNaN(price) || price < 0) {
        alert("ราคาไม่ถูกต้อง");
        return;
      }
      const newItems = [];
      const timestamp = Date.now();

      for (let i = 0; i < qty; i++) {
        let finalName = cleanName;
        if (qty > 1) {
          finalName = `${cleanName} (${i + 1})`;
        }
        newItems.push({
          id: `${timestamp}-${i}-${Math.random().toString(36).substr(2, 9)}`,
          name: finalName,
          baseName: cleanName,
          price: price,
          participants: []
        });
      }

      setItems(prev => [...prev, ...newItems]);
      setExpandedGroups(prev => ({
        ...prev,
        [cleanName]: false
      }));

      setItemName('');
      setItemPrice('');
      setItemQty('1');
    }
  }, [itemName, itemPrice, itemQty]);


  const handleEditItemName = useCallback((id, oldName) => {
    const newName =
      window.prompt("แก้ไขชื่อรายการ:", oldName);

    if (newName && newName.trim() !== "") {
      setItems(prevItems =>
        prevItems.map(item => {
          if (item.id === id) {
            const trimmedName = newName.trim();
            const newBaseName =
              trimmedName.replace(/\s\(\d+\)$/, '');
            return {
              ...item,
              name: trimmedName,
              baseName: newBaseName
            };
          }
          return item;
        })
      );
    }
  }, []);


  const handleRemoveItem = useCallback((id) => {
    setItems(prev =>
      prev.filter(item => item.id !== id)
    );
  }, []);


  const toggleParticipant = useCallback((itemId, member) => {
    setItems(prevItems =>
      prevItems.map(item => {
        if (item.id === itemId) {
          const isSelected =
            item.participants.includes(member);
          return {
            ...item,
            participants: isSelected
              ? item.participants.filter(p => p !== member)
              : [...item.participants, member]
          };
        }
        return item;
      })
    );
  }, []);


  const toggleGroup = (groupName) => {
    setExpandedGroups(prev => ({
      ...prev,
      [groupName]: !prev[groupName]
    }));
  };


  const handleChangeSvcString = (e) => {
    let valStr = e.target.value;
    if (valStr.length > 1 && valStr.startsWith('0')) {
      valStr = valStr.replace(/^0+/, '');
    }
    setSvcString(valStr);
    setServiceChargePercent(Number(valStr));
  };


  // ==================================================
  // 🔹 QR / PROMPTPAY LOGIC
  // ==================================================

  const qrPayload = useMemo(() => {
    if (!promptPayId) return "";
    if (
      promptPayId.length !== 10 &&
      promptPayId.length !== 13
    ) return "";

    if (
      promptPayId.length === 10 &&
      !promptPayId.startsWith('0')
    ) return "";

    return generatePromptPayPayload(
      promptPayId,
      null
    );
  }, [promptPayId]);


  const isValidLength =
    (promptPayId.length === 10 &&
      promptPayId.startsWith('0')) ||
    promptPayId.length === 13;


  // ==================================================
  // 🔹 NAVIGATION LOGIC
  // ==================================================

  const menuOrder = [
    'members',
    'items',
    'summary',
    'payment',
    'history'
  ];


  const currentIndex =
    menuOrder.indexOf(activeTab);

  const goToNext = () => {
    if (currentIndex < menuOrder.length - 1) {
      setActiveTab(menuOrder[currentIndex + 1]);
    }
  };

  const goToPrev = () => {
    if (currentIndex > 0) {
      setActiveTab(menuOrder[currentIndex - 1]);
    }
  };

  // ==================================================
  // 🔹 RENDER SECTION
  // ==================================================

// ==================================================
// 🔹 RENDER CONTENT
// ==================================================

const renderContent = () => {

  switch (activeTab) {

    // ==================================================
    // 🔸 HOME
    // ==================================================
    case 'home':
      return (
        <div className="home-landing animate-fade-in">

          <div className="home-hero">
            <div className="hero-icon">
              <Receipt size={48} />
            </div>
            <h1>ยินดีต้อนรับสู่ FairSplit</h1>
            <p className="hero-subtext">
              เว็บช่วยหารค่าอาหารแบบแฟร์ ๆ  
              ใส่เมนู เลือกคนกิน ระบบคำนวณให้ครบ  
              ไม่มีใครจ่ายเกิน ไม่มีใครหนีบิล 😆
            </p>

            <div className="hero-buttons">
              <button
                className="btn-start"
                onClick={() => setActiveTab('members')}
              >
                เริ่มทำบิลเลย
              </button>

              {!user && (
                <button
                  className="btn-login-hero"
                  onClick={handleLogin}
                >
                  เข้าสู่ระบบด้วย Google
                </button>
              )}
            </div>
          </div>


          <div className="home-features">
            <div className="feature-card">
              <Users size={28} />
              <h4>จัดการสมาชิกง่าย</h4>
              <p>เพิ่มเพื่อน เลือกคนหาร ได้ในคลิกเดียว</p>
            </div>
            <div className="feature-card">
              <LayoutDashboard size={28} />
              <h4>คำนวณอัตโนมัติ</h4>
              <p>รวม VAT / Service Charge ให้ครบ</p>
            </div>
            <div className="feature-card">
              <Wallet size={28} />
              <h4>สร้าง QR รับเงิน</h4>
              <p>สแกนจ่ายได้ทันทีผ่าน PromptPay</p>
            </div>
          </div>

        </div>
      );

    // ==================================================
    // 🔸 MEMBERS
    // ==================================================
    case 'members':
      return (
        <div className="content-card animate-fade-in">

          <div className="section-header">
            <Users size={20} />
            <h3>จัดการสมาชิก ({members.length})</h3>
          </div>

          <div className="member-chips-container">
            {members.map(m => (
              <div
                key={m}
                className={`member-chip ${m === 'เรา' ? 'me' : ''}`}
              >
                <div className="avatar">{m.charAt(0)}</div>
                <span>{m}</span>
                <button
                  onClick={() => handleRemoveMember(m)}
                  className="btn-icon-small"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>

          <div className="input-row">
            <input
              type="text"
              placeholder="เพิ่มชื่อเพื่อน..."
              value={memberName}
              onChange={(e) => setMemberName(e.target.value)}
              onKeyDown={(e) =>
                e.key === 'Enter' && handleAddMember()
              }
            />
            <button
              onClick={handleAddMember}
              disabled={!memberName}
              className="btn-gray-add"
            >
              <Plus size={20} />
            </button>
          </div>

        </div>
      );


    // ==================================================
    // 🔸 ITEMS
    // ==================================================
    case 'items':
      return (
        <div className="content-card animate-fade-in">

          <div className="section-header">
            <Coffee size={20} />
            <h3>รายการอาหาร</h3>
          </div>

          <div className="add-item-wrapper-blue">
            <div className="add-item-row">
              <input
                className="input-name"
                type="text"
                placeholder="ชื่อเมนู"
                value={itemName}
                onChange={(e) => setItemName(e.target.value)}
              />
              <input
                className="input-qty"
                type="number"
                min="1"
                placeholder="จำนวน"
                value={itemQty}
                onChange={(e) => setItemQty(e.target.value)}
              />
              <input
                className="input-price"
                type="number"
                placeholder="ราคา"
                min="0"
                step="0.01"
                value={itemPrice}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value === '' || Number(value) >= 0) {
                    setItemPrice(value);
                  }
                }}
                onKeyDown={(e) =>
                  e.key === 'Enter' && handleAddItem()
                }
              />
              <button
                onClick={handleAddItem}
                className="btn-add-blue"
              >
                เพิ่ม
              </button>
            </div>
          </div>


          <div className="items-list">
            {items.length === 0 && (
              <div className="empty-state">
                ยังไม่มีรายการอาหาร
              </div>
            )}

            {Object.entries(groupedItems).map(
              ([groupName, groupItems]) => {
                const isExpanded =
                  expandedGroups[groupName] !== false;

                return (
                  <div
                    key={groupName}
                    className={`item-group-card ${!isExpanded ? 'collapsed' : ''}`}
                  >
                    <div
                      className="group-header"
                      onClick={() => toggleGroup(groupName)}
                      style={{ cursor: 'pointer' }}
                    >
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                      }}>
                        {isExpanded
                          ? <ChevronUp size={16} />
                          : <ChevronDown size={16} />}
                        <span className="group-title">
                          {groupName}
                        </span>
                      </div>
                      <span className="group-count-badge">
                        {groupItems.length} รายการ
                      </span>
                    </div>

                    {isExpanded && (
                      <div className="group-items-container animate-slide-down">
                        {groupItems.map((item, index) => (
                          <div
                            key={item.id}
                            className="sub-item-card"
                          >
                            <div className="sub-item-top-row">
                              <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px'
                              }}>
                                <span className="sub-item-index">
                                  #{index + 1}
                                </span>
                                <button
                                  onClick={() =>
                                    handleEditItemName(item.id, item.name)
                                  }
                                  className="btn-edit-box"
                                >
                                  <Edit2 size={12} />
                                </button>
                              </div>
                              <span className="item-price">
                                {item.price.toLocaleString()}
                              </span>
                            </div>

                            <div className="sub-item-bottom-row">
                              <div className="participant-selector-row">
                                {members.map(m => (
                                  <button
                                    key={m}
                                    onClick={() =>
                                      toggleParticipant(item.id, m)
                                    }
                                    className={`toggle-chip-pill ${item.participants.includes(m) ? 'active' : ''}`}
                                  >
                                    {item.participants.includes(m) &&
                                      <Check size={10} strokeWidth={4} />
                                    }
                                    {m}
                                  </button>
                                ))}
                              </div>
                              <button
                                onClick={() =>
                                  handleRemoveItem(item.id)
                                }
                                className="btn-delete-icon-only"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              }
            )}
          </div>
        </div>
      );


    // ==================================================
    // 🔸 SUMMARY
    // ==================================================
    case 'summary':
      return (
        <div className="content-card animate-fade-in">

          <div className="section-header">
            <LayoutDashboard size={20} />
            <h3>สรุปยอดที่ต้องจ่าย</h3>
          </div>

          <div
            className="options-bar"
            style={{
              justifyContent: 'flex-start',
              marginBottom: '20px'
            }}
          >
            <label className={`option-pill ${useServiceCharge ? 'active' : ''}`}>
              <input
                type="checkbox"
                checked={useServiceCharge}
                onChange={(e) =>
                  setUseServiceCharge(e.target.checked)
                }
              />
              <Percent size={14} />
              SVC

              {useServiceCharge && (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  marginLeft: '6px'
                }}>
                  <input
                    type="number"
                    className="percent-input"
                    placeholder="0"
                    value={svcString}
                    onChange={handleChangeSvcString}
                    onClick={(e) => e.stopPropagation()}
                    min="0"
                  />
                  <span style={{ marginLeft: '4px' }}>%</span>
                </div>
              )}
            </label>

            <label className={`option-pill ${useVat ? 'active' : ''}`}>
              <input
                type="checkbox"
                checked={useVat}
                onChange={(e) => setUseVat(e.target.checked)}
              />
              <Percent size={14} />
              VAT 7%
            </label>
          </div>

          {items.length > 0 ? (
            <div className="summary-card-dark">
              <div className="bill-breakdown">
                <div className="breakdown-row">
                  <span>รวมค่าอาหาร</span>
                  <span>{subtotal.toLocaleString()} ฿</span>
                </div>
                {useServiceCharge && (
                  <div className="breakdown-row text-muted">
                    <span>
                      Service Charge ({serviceChargePercent}%)
                    </span>
                    <span>
                      {serviceChargeAmount.toLocaleString(undefined, {
                        maximumFractionDigits: 2
                      })} ฿
                    </span>
                  </div>
                )}
                {useVat && (
                  <div className="breakdown-row text-muted">
                    <span>VAT (7%)</span>
                    <span>
                      {vatAmount.toLocaleString(undefined, {
                        maximumFractionDigits: 2
                      })} ฿
                    </span>
                  </div>
                )}
                <div className="breakdown-row total-row">
                  <span>ยอดสุทธิ</span>
                  <span>
                    {grandTotal.toLocaleString(undefined, {
                      maximumFractionDigits: 2
                    })} ฿
                  </span>
                </div>
              </div>

              <hr className="divider-soft" />

              <div className="summary-rows">
                {members.map(m => (
                  <div
                    key={m}
                    className="summary-row-dark-item"
                  >
                    <div className="summary-name">
                      <div className="avatar-small-dark">
                        {m.charAt(0)}
                      </div>
                      {m}
                    </div>
                    <span className="summary-amount-green">
                      {memberShares[m]?.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2
                      })} ฿
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="empty-state">
              ยังไม่มีข้อมูลการคำนวณ
            </div>
          )}

          <button
            onClick={saveBillToHistory}
            className="btn-full-primary"
            style={{ marginTop: '20px' }}
          >
            <Save size={18} />
            บันทึกบิลลงประวัติ
          </button>

        </div>
      );

    // ==================================================
    // 🔸 HISTORY
    // ==================================================
    case 'history':
      return (
        <div className="content-card animate-fade-in">
          <div className="section-header">
            <History size={20} />
            <h3>ประวัติบิล</h3>
          </div>

          {!user ? (
            <div className="empty-state-login">
              <p>กรุณาเข้าสู่ระบบเพื่อดูประวัติบิล</p>
              <button
                onClick={handleLogin}
                className="btn-login-small"
              >
                G Login
              </button>
            </div>
          ) : historyList.length === 0 ? (
            <div className="empty-state">
              ยังไม่มีประวัติการบันทึก
            </div>
          ) : (
            <div className="history-list-page">
              {historyList.map(bill => (
                <div
                  key={bill.id}
                  className="history-card"
                  onClick={() => setViewingBill(bill)}
                >
                  <div className="history-header-row">
                    <div className="history-date-group">
                      <span className="history-date">
                        <Calendar size={14} style={{ marginRight: '4px' }} />
                        {new Date(bill.date.seconds * 1000)
                          .toLocaleDateString('th-TH', {
                            day: 'numeric',
                            month: 'short',
                            year: '2-digit'
                          })}
                      </span>
                      <span className="history-time">
                        {new Date(bill.date.seconds * 1000)
                          .toLocaleTimeString('th-TH', {
                            hour: '2-digit',
                            minute: '2-digit'
                          })} น.
                      </span>
                    </div>
                    <div className="history-price">
                      {bill.totalAmount?.toLocaleString()} ฿
                    </div>
                  </div>
                  <div className="history-divider"></div>
                  <div className="history-footer-row">
                    <div className="history-stats">
                      <span className="stat-badge">
                        <UtensilsCrossed size={12} />
                        {bill.items.length}
                      </span>
                      <span className="stat-badge">
                        <Users size={12} />
                        {bill.members.length}
                      </span>
                    </div>
                    <button
                      className="btn-delete-icon"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteHistoryItem(bill.id);
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      );


    // ==================================================
    // 🔸 PAYMENT
    // ==================================================
    case 'payment':
      return (
        <div className="content-card animate-fade-in">

          <div className="section-header">
            <Wallet size={20} />
            <h3>QR รับเงิน (PromptPay)</h3>
          </div>

          <div className="payment-box">
            <div className="input-row-icon">
              <Smartphone size={18} className="icon-input" />
              <input
                type="text"
                className="input-promptpay"
                placeholder="เบอร์มือถือ / เลขบัตร ปชช."
                maxLength={13}
                value={promptPayId}
                onChange={(e) => {
                  const val = e.target.value.replace(/[^0-9]/g, '');
                  setPromptPayId(val);
                  setShowQR(false);
                }}
              />
            </div>

            {!showQR && isValidLength && (
              <button
                onClick={() => setShowQR(true)}
                className="btn-create-qr"
              >
                สร้าง QR Code
                <ArrowRight size={16} />
              </button>
            )}

            {showQR && isValidLength && (
              <div className="qr-container">
                <div className="qr-wrapper">
                  <QRCodeCanvas
                    value={qrPayload}
                    size={220}
                    level="M"
                    includeMargin={true}
                  />
                </div>
                <div className="qr-info">
                  <span>สแกนจ่ายได้เลย</span>
                </div>
              </div>
            )}

            {/* ✅ ปุ่มสร้างห้องจ่ายเงิน */}
            {isValidLength && (
              <div style={{ marginTop: '20px', borderTop: '1px solid #eee', paddingTop: '20px' }}>
                <h4 style={{marginBottom: '10px', fontSize: '1rem', color: '#334155'}}>ห้องหารเงินออนไลน์</h4>
                <button
                  onClick={handleCreateRoom}
                  className="btn-full-primary"
                  style={{ background: '#10b981', borderColor: '#059669', color: 'white' }}
                >
                  <Share2 size={18} /> สร้างห้อง & แชร์ลิงก์ให้เพื่อน
                </button>
                <p style={{fontSize: '0.8rem', color: '#64748b', marginTop: '8px', textAlign: 'center'}}>
                  เพื่อนจะเห็นเฉพาะยอดของตัวเอง และสแกนจ่ายได้ทันที
                </p>
              </div>
            )}

          </div>

        </div>
      );


    // ==================================================
    // 🔸 DEFAULT
    // ==================================================
    default:
      return null;
  }
};
// ==================================================
// 🔹 MENU CONFIG
// ==================================================

const menuItems = [
  { id: 'home', label: 'หน้าหลัก', icon: <LayoutDashboard size={20} /> },
  { id: 'members', label: 'สมาชิก', icon: <Users size={20} /> },
  { id: 'items', label: 'รายการอาหาร', icon: <UtensilsCrossed size={20} /> },
  { id: 'summary', label: 'สรุปยอด', icon: <LayoutDashboard size={20} /> },
  { id: 'payment', label: 'ชำระเงิน', icon: <Wallet size={20} /> },
  { id: 'history', label: 'ประวัติบิล', icon: <History size={20} /> }
];


// ==================================================
// 🔹 MAIN RETURN LAYOUT
// ==================================================

return (
  <div className="main-layout">

    {/* ============================
        🔸 MOBILE HEADER
    ============================ */}
    <div className="mobile-header">
      <div className="brand-mobile">
        <Receipt size={24} color="white" />
        <span className="brand-text">FairSplit</span>
      </div>
      <button
        className="mobile-menu-btn"
        onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
      >
        {isMobileMenuOpen
          ? <X size={24} color="white" />
          : <Menu size={24} color="white" />}
      </button>
    </div>


    {/* ============================
        🔸 SIDEBAR
    ============================ */}
    <nav className={`sidebar ${isMobileMenuOpen ? 'open' : ''}`}>
      {/* Sidebar Header */}
      <div className="sidebar-header">
        <div className="logo-box">
          <Receipt size={28} color="white" />
        </div>
        <div className="brand-container">
          <h1 className="sidebar-title">FairSplit</h1>
          <span className="sidebar-subtitle">
            หารยาวแค่ไหนก็ง่าย
          </span>
        </div>
      </div>

      {/* Sidebar Menu */}
      <ul className="sidebar-menu">
        {menuItems.map(item => (
          <li
            key={item.id}
            className={activeTab === item.id ? 'active' : ''}
            onClick={() => {
              setActiveTab(item.id);
              setIsMobileMenuOpen(false);
            }}
          >
            {item.icon}
            <span>{item.label}</span>
          </li>
        ))}
      </ul>


      {/* Sidebar Footer */}
      <div className="sidebar-footer">
        {/* Auth Box */}
        <div
          style={{
            marginBottom: '15px',
            padding: '10px',
            background: 'rgba(37,99,235,0.05)',
            borderRadius: '12px',
            border: '1px solid #eff6ff'
          }}
        >
          {user ? (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                overflow: 'hidden'
              }}>
                <img
                  src={user.photoURL}
                  alt=""
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%'
                  }}
                />
                <span className="user-name-text">
                  {user.displayName.split(' ')[0]}
                </span>
              </div>
              <button
                onClick={handleLogout}
                style={{
                  background: 'white',
                  border: '1px solid #e2e8f0',
                  borderRadius: '6px',
                  padding: '4px',
                  cursor: 'pointer',
                  color: '#ef4444'
                }}
              >
                <LogOut size={14} />
              </button>
            </div>
          ) : (
            <button
              onClick={handleLogin}
              style={{
                width: '100%',
                background: 'white',
                border: '1px solid #cbd5e1',
                borderRadius: '8px',
                padding: '8px',
                cursor: 'pointer',
                fontSize: '0.9rem',
                fontWeight: '600',
                color: '#475569',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px'
              }}
            >
              <span style={{ color: '#EA4335', fontWeight: 'bold' }}>
                G
              </span>
              เข้าสู่ระบบ
            </button>
          )}
        </div>

        {/* Total Display */}
        <div className="total-display-sidebar">
          <small>ยอดรวมทั้งหมด</small>
          <div className="amount">
            {grandTotal.toLocaleString(undefined, {
              maximumFractionDigits: 0
            })} ฿
          </div>
        </div>

        {/* Reset Button */}
        <button
          onClick={handleClearBill}
          className="btn-reset-sidebar"
        >
          <RefreshCw size={14} />
          ล้างบิล
        </button>
      </div>
    </nav>


    {/* ============================
        🔸 MAIN CONTENT
    ============================ */}
    <main className="content-area">

      {renderContent()}

      {activeTab !== 'home' && (
        <div className="nav-buttons-container">
          <button
            onClick={goToPrev}
            disabled={currentIndex === 0}
            className="btn-nav prev"
            style={{
              visibility:
                currentIndex === 0 ? 'hidden' : 'visible'
            }}
          >
            <ChevronLeft size={20} />
            ย้อนกลับ
          </button>

          <button
            onClick={goToNext}
            disabled={currentIndex === menuOrder.length - 1}
            className="btn-nav next"
            style={{
              visibility:
                currentIndex === menuOrder.length - 1
                  ? 'hidden'
                  : 'visible'
            }}
          >
            ถัดไป
            <ChevronRight size={20} />
          </button>
        </div>
      )}

    </main>


    {/* ============================
        🔸 OVERLAY
    ============================ */}
    {isMobileMenuOpen && (
      <div
        className="overlay"
        onClick={() => setIsMobileMenuOpen(false)}
      />
    )}

    {/* ============================
        ✅ MODAL: SHARE ROOM
        ============================ */}
    {createdRoom && (
      <div className="modal-overlay" onClick={() => setCreatedRoom(null)}>
        <div className="share-modal-box animate-fade-in" onClick={e => e.stopPropagation()}>
          
          <div className="share-header">
            <div className="icon-wrapper">
              <Share2 size={32} color="white" />
            </div>
            <h3>ห้องพร้อมแล้ว!</h3>
            <p>ให้เพื่อนสแกน QR หรือส่งลิงก์นี้ให้เพื่อน</p>
          </div>

          <div className="share-body">
            {/* ส่วน QR Code สำหรับเข้าห้อง */}
            <div className="room-qr-wrapper">
              <QRCodeCanvas 
                value={createdRoom.link} 
                size={200}
                level="M"
                includeMargin={true}
              />
              <span className="qr-tag">Scan to Pay</span>
            </div>

            {/* ส่วน Link */}
            <div className="link-box-container">
              <label>ลิงก์สำหรับจ่ายเงิน</label>
              <div className="link-input-group">
                <input type="text" value={createdRoom.link} readOnly />
                <button onClick={handleCopyLink} className={isCopiedLink ? 'copied' : ''}>
                  {isCopiedLink ? <CheckCircle size={18}/> : <Copy size={18}/>}
                </button>
              </div>
            </div>
          </div>

          <div className="share-footer">
            <button 
              className="btn-full-primary" 
              onClick={() => setCreatedRoom(null)}
            >
              ตกลง
            </button>
            <button 
              className="btn-text-only"
              onClick={() => window.open(createdRoom.link, '_blank')}
            >
              เปิดหน้าเว็บดูเอง
            </button>
          </div>

        </div>
      </div>
    )}


    {/* ============================
        🔸 MODAL: BILL HISTORY VIEW
    ============================ */}
    {viewingBill && (
      <div
        className="modal-overlay"
        onClick={() => setViewingBill(null)}
      >
        <div
          className="bill-detail-modal"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="bill-receipt-header">
            <FileText size={40} className="receipt-icon" />
            <h3>ใบเสร็จรับเงิน</h3>
            <p className="receipt-date">
              {new Date(viewingBill.date.seconds * 1000)
                .toLocaleDateString('th-TH', {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                })} น.
            </p>
          </div>

          <div className="bill-receipt-body">
            {Object.entries(getMemberBreakdown(viewingBill)).map(([memberName, data]) => (
              <div
                key={memberName}
                className="receipt-member-section"
              >
                <div className="receipt-member-header">
                  <User size={16} />
                  <span className="member-name">
                    {memberName}
                  </span>
                </div>
                <div className="receipt-items-list">
                  {data.items.length === 0 ? (
                    <div className="receipt-empty">
                      ไม่มีรายการอาหาร
                    </div>
                  ) : (
                    data.items.map((item, idx) => (
                      <div
                        key={idx}
                        className="receipt-item-row"
                      >
                        <span className="item-name">
                          {item.name}
                        </span>
                        <span className="item-price">
                          {item.price.toLocaleString()} ฿
                        </span>
                      </div>
                    ))
                  )}
                </div>
                {data.extraCharge > 0 && (
                  <div className="receipt-extra-row">
                    <span>ค่าธรรมเนียม/ภาษี</span>
                    <span>
                      {data.extraCharge.toLocaleString(undefined, {
                        maximumFractionDigits: 2
                      })} ฿
                    </span>
                  </div>
                )}
                <div className="receipt-member-total">
                  <span>รวมสุทธิ</span>
                  <span className="highlight">
                    {data.netTotal.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2
                    })} ฿
                  </span>
                </div>
              </div>
            ))}
            <div className="receipt-divider-dashed"></div>
            <div className="receipt-grand-total">
              <span>ยอดรวมทั้งสิ้น</span>
              <span>
                {viewingBill.totalAmount?.toLocaleString()} ฿
              </span>
            </div>
          </div>
          <button
            onClick={() => setViewingBill(null)}
            className="btn-close-receipt"
          >
            ปิดหน้านี้
          </button>
        </div>
      </div>
    )}

    {/* ============================
        🔸 GLOBAL CONFIRM MODAL
        ============================ */}
        {confirmConfig.open && (
          <div className="confirm-overlay">
            <div className="confirm-box">
              <h3>{confirmConfig.title}</h3>
              <p>{confirmConfig.message}</p>
              <div className="confirm-actions">
                <button
                  className="btn-cancel"
                  onClick={closeConfirm}
                >
                  ยกเลิก
                </button>
                <button
                  className="btn-confirm"
                  onClick={() => confirmConfig.onConfirm?.()}
                >
                  ยืนยัน
                </button>
              </div>
            </div>
          </div>
        )}

  </div>
);
};

export default App;