import { initializeApp, getApps, getApp } from "firebase/app"; // ✅ เพิ่ม getApps, getApp
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// 🔥 เอา Config ของคุณมาใส่ตรงนี้เหมือนเดิม
const firebaseConfig = {
  apiKey: "AIzaSyCnmn9iT6HqSl1tmFrCkYxi8f0R2IBk8V8",
  authDomain: "fair-split-app-c6b72.firebaseapp.com",
  projectId: "fair-split-app-c6b72",
  storageBucket: "fair-split-app-c6b72.firebasestorage.app",
  messagingSenderId: "273822038005",
  appId: "1:273822038005:web:f80734be52e270507392bc",
  measurementId: "G-8LVDXKBLV0"
};

// 🔥 แก้บรรทัดนี้: เช็คก่อนว่ามี App แล้วหรือยัง กัน Error "Already exists"
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();
const db = getFirestore(app);

export { auth, googleProvider, db };