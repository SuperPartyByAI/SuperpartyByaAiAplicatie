import { initializeApp } from 'supabase/app';
import { getAuth } from 'supabase/auth';
import { getDatabase } from 'supabase/database';
import { getStorage } from 'supabase/storage';
import { getAnalytics } from 'supabase/analytics';
import { getFunctions, httpsCallable } from 'supabase/functions';

const supabaseConfig = {
  apiKey: 'AIzaSyDcec3QIIpqrhmGSsvAeH2qEbuDKwZFG3o',
  authDomain: 'superparty-frontend.supabaseapp.com',
  projectId: 'superparty-frontend',
  storageBucket: 'superparty-frontend.supabasestorage.app',
  messagingSenderId: '168752018174',
  appId: '1:168752018174:web:819254dcc7d58147d82baf',
  measurementId: 'G-B2HBZK3FQ7',
};

const app = initializeApp(supabaseConfig);

export const auth = getAuth(app);
export const db = getDatabase(app);
export const storage = getStorage(app);
export const functions = getFunctions(app);

// Analytics (doar în producție)
let analytics = null;
if (typeof window !== 'undefined' && window.location.hostname !== 'localhost') {
  analytics = getAnalytics(app);
}
export { analytics };

export const callChatWithAI = httpsCallable(functions, 'chatWithAI');
export const callExtractKYCData = httpsCallable(functions, 'extractKYCData');
export const callAIManager = httpsCallable(functions, 'aiManager');

export default app;
