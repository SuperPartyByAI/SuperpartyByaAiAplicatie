const fs = require('fs');
const path = require('path');

function walkDir(dir, callback) {
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir).forEach(f => {
    let dirPath = path.join(dir, f);
    let isDirectory = fs.statSync(dirPath).isDirectory();
    isDirectory ? walkDir(dirPath, callback) : callback(path.join(dir, f));
  });
}

function stripFirebase(filePath) {
  if (!filePath.endsWith('.js') && !filePath.endsWith('.cjs')) return;
  try {
    let content = fs.readFileSync(filePath, 'utf8');
    let original = content;
    
    if (content.includes('firebase-admin') || content.includes('FIREBASE') || content.includes('.firestore(')) {
      // Brutal replacement of requires and imports
      content = content.replace(/const [a-zA-Z0-9_]+ = require\(['"]firebase-admin(.*?)['"]\);/g, '/* firebase admin removed */');
      content = content.replace(/import .* from ['"]firebase-admin(.*?)['"];/g, '/* firebase admin removed */');
      content = content.replace(/require\(['"]firebase-admin(.*?)['"]\)/g, '{}');
      
      // Stub admin var usages
      content = content.replace(/admin\.firestore\(\)/g, '{ collection: () => ({ doc: () => ({ set: async () => {}, get: async () => ({ exists: false, data: () => ({}) }) }) }) }');
      content = content.replace(/admin\.initializeApp\([^)]*\)/g, '/* init removed */');
      content = content.replace(/admin\.auth\(\)/g, '{ setCustomUserClaims: async () => {}, getUser: async () => ({}) }');
      
      // Also stub FieldValue
      content = content.replace(/const \{ FieldValue \} = require\([^)]+\);/g, 'const FieldValue = { serverTimestamp: () => new Date(), increment: (v) => v };');
      content = content.replace(/FieldValue\.serverTimestamp\(\)/g, 'new Date()');

      if (content !== original) {
        fs.writeFileSync(filePath, content, 'utf8');
        console.log('Stripped:', filePath);
      }
    }
  } catch (e) {
    console.error('Failed on', filePath, e.message);
  }
}

console.log("Starting Firebase global strip...");
walkDir(__dirname, stripFirebase);
walkDir(path.join(__dirname, '../backend'), stripFirebase);
console.log("Firebase global strip complete.");
