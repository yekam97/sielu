import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAnalytics } from "firebase/analytics";

const firebaseConfig = {
    apiKey: "AIzaSyCbdRfWrH41JqVs6bzeMykwjoIqumE0Tdg",
    authDomain: "sielu-438b8.firebaseapp.com",
    projectId: "sielu-438b8",
    storageBucket: "sielu-438b8.firebasestorage.app",
    messagingSenderId: "385992075499",
    appId: "1:385992075499:web:49d0570faa2420dba376ae",
    measurementId: "G-HG2RRHP0J0"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const analytics = getAnalytics(app);
