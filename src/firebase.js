// src/firebase.js
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// ⚠️ ตรงนี้สำคัญ! ไปก๊อปปี้ firebaseConfig จากหน้าเว็บ Firebase Console ของคุณมาใส่แทนที่ตรงนี้นะครับ
// (ค่าที่คุณเคยทำไว้ตอน Phase 3)
const firebaseConfig = {
  apiKey: "AIzaSyArCyZXRrfIzxiPIKa6eorGsgOk4f0eIQI",
  authDomain: "fair-split-b76a2.firebaseapp.com",
  projectId: "fair-split-b76a2",
  storageBucket: "fair-split-b76a2.firebasestorage.app",
  messagingSenderId: "770320401946",
  appId: "1:770320401946:web:0ad539b30a6448952873a3",
  measurementId: "G-MZ4ZXS7J2R"
};

// เริ่มต้นระบบ Firebase
const app = initializeApp(firebaseConfig);

// ส่งออกตัวจัดการ (Auth & Database) ไปให้ไฟล์อื่นใช้
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);