import { initFirebase } from "./firebase-sync.js";

const db = initFirebase();

async function checkUser(email) {
  try {
    const employeesSnapshot = await db.collection("employees").where("email", "==", email).get();
    if (!employeesSnapshot.empty) {
      console.log("=== Employee Document ===");
      employeesSnapshot.forEach(doc => console.log(doc.id, "=>", doc.data()));
    } else {
      console.log("No employee found with email: " + email);
    }

    const usersSnapshot = await db.collection("users").where("email", "==", email).get();
    if (!usersSnapshot.empty) {
      console.log("\n=== User Document ===");
      usersSnapshot.forEach(doc => console.log(doc.id, "=>", doc.data()));
    } else {
      console.log("No user found with email: " + email);
    }
    process.exit(0);
  } catch (error) {
    console.error("Error fetching data:", error);
    process.exit(1);
  }
}
checkUser("marius.alin2005@gmail.com");
