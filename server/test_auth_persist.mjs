import { useMultiFileAuthState } from "@whiskeysockets/baileys";
import path from "path";
import fs from "fs";

const testPath = path.join(process.cwd(), "auth_info", "_test_auth");
console.log("Test auth path:", testPath);
const { state, saveCreds } = await useMultiFileAuthState(testPath);
console.log("State created, creds exist:", !!state.creds);
console.log("Has signedIdentityKey:", !!state.creds?.signedIdentityKey);
console.log("Creds keys:", Object.keys(state.creds || {}));

await saveCreds();
console.log("saveCreds called successfully");

const files = fs.readdirSync(testPath);
console.log("Files written:", files);

// Cleanup
fs.rmSync(testPath, { recursive: true, force: true });
console.log("Done - cleanup complete");
