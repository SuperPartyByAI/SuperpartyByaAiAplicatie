const token = "dummy.eyJlbWFpbCI6ImV4YW1wbGVAZ21haWwuY29tIn0.dummy";
const payload = token.split('.')[1];
const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
console.log(JSON.parse(Buffer.from(base64, 'base64').toString()));
