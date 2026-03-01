import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import fs from "fs";

let db;
try {
  // Use the exact same file path that the main backend server processes use on the laptop
  const serviceAccount = JSON.parse(fs.readFileSync("/Users/universparty/AplicatieSuperParty/Superparty-App/server/superpartybyai-db3d8-firebase-adminsdk-vsws0-d29a584988.json", "utf8"));
  initializeApp({ credential: cert(serviceAccount) });
  db = getFirestore();
} catch(e) {
  console.error("Firebase Init err:", e);
  process.exit(1);
}

async function checkUser(email) {
  try {
    const employeesSnapshot = await db.collection("employees").where("email", "==", email).get();
    if (!employeesSnapshot.empty) {
      console.log("=== Employee Document ===");
      employeesSnapshot.forEach(doc => console.log(doc.id, "=>", doc.data()));
    } else {
      console.log(`No employee found with email: ${email}`);
    }

    const usersSnapshot = await db.collection("users").where("email", "==", email).get();
    if (!usersSnapshot.empty) {
      console.log("\n=== User Document ===");
      usersSnapshot.forEach(doc => console.log(doc.id, "=>", doc.data()));
    } else {
      console.log(`No user found with email: ${email}`);
    }
    process.exit(0);
  } catch (error) {
    console.error("Error fetching user data:", error);
    process.exit(1);
  }
}

checkUser("marius.alin2005@gmail.com");
