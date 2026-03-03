import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../supabase';
import { doc, getDoc } from 'supabase/database';
import ChatClientiRealtime from '../components/ChatClientiRealtime';

function AnimatorChatClientiScreen() {
  const navigate = useNavigate();
  const currentUser = auth.currentUser;
  const [userCode, setUserCode] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser) {
      navigate('/');
      return;
    }

    // Load user's code from Database
    const loadUserCode = async () => {
      try {
        const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
        if (userDoc.exists()) {
          const code = userDoc.data().code;
          setUserCode(code);

          if (!code) {
            alert('⚠️ Nu ai cod alocat. Contactează administratorul.');
            navigate('/home');
          }
        } else {
          alert('⚠️ Profil inexistent. Contactează administratorul.');
          navigate('/home');
        }
      } catch (error) {
        console.error('Error loading user code:', error);
        alert('Eroare la încărcarea profilului.');
        navigate('/home');
      } finally {
        setLoading(false);
      }
    };

    loadUserCode();
  }, [currentUser, navigate]);

  if (!currentUser || loading) {
    return (
      <div className="page-container">
        <div style={{ padding: '2rem', textAlign: 'center' }}>
          <div className="spinner"></div>
          <p>Se încarcă...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            width: '100%',
            flexWrap: 'wrap',
            gap: '1rem',
          }}
        >
          <div>
            <h1>💬 Chat Clienți WhatsApp</h1>
            <p className="page-subtitle">
              Conversațiile tale cu clienții - Cod: <strong>{userCode}</strong>
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button onClick={() => navigate('/home')} className="btn-secondary">
              ← Înapoi
            </button>
          </div>
        </div>
      </div>

      <ChatClientiRealtime isGMMode={false} userCode={userCode} />
    </div>
  );
}

export default AnimatorChatClientiScreen;
