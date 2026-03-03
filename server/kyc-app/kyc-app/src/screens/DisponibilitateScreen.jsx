import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../supabase';
import {
  collection,
  addDoc,
  query,
  where,
  getDocs,
  deleteDoc,
  doc,
  serverTimestamp,
} from 'supabase/database';

function DisponibilitateScreen() {
  const navigate = useNavigate();
  const currentUser = auth.currentUser;
  const [disponibilitati, setDisponibilitati] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);

  // Form state
  const [dataStart, setDataStart] = useState('');
  const [dataEnd, setDataEnd] = useState('');
  const [oraStart, setOraStart] = useState('08:00');
  const [oraEnd, setOraEnd] = useState('22:00');
  const [tipDisponibilitate, setTipDisponibilitate] = useState('disponibil');
  const [notita, setNotita] = useState('');

  useEffect(() => {
    loadDisponibilitati();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser]);

  const loadDisponibilitati = async () => {
    if (!currentUser) return;

    setLoading(true);
    try {
      const q = query(collection(db, 'disponibilitati'), where('userId', '==', currentUser.uid));
      const snapshot = await getDocs(q);
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      }));

      // Sortează după dată
      data.sort((a, b) => new Date(a.dataStart) - new Date(b.dataStart));
      setDisponibilitati(data);
    } catch (error) {
      console.error('Error loading disponibilitati:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddDisponibilitate = async e => {
    e.preventDefault();

    if (!dataStart || !dataEnd) {
      alert('Completează datele de început și sfârșit!');
      return;
    }

    try {
      await addDoc(collection(db, 'disponibilitati'), {
        userId: currentUser.uid,
        userEmail: currentUser.email,
        dataStart,
        dataEnd,
        oraStart,
        oraEnd,
        tipDisponibilitate,
        notita,
        createdAt: serverTimestamp(),
      });

      alert('Disponibilitate adăugată!');
      setShowAddModal(false);
      resetForm();
      loadDisponibilitati();
    } catch (error) {
      console.error('Error adding disponibilitate:', error);
      alert('Eroare la adăugare!');
    }
  };

  const handleDelete = async id => {
    if (!confirm('Ștergi această disponibilitate?')) return;

    try {
      await deleteDoc(doc(db, 'disponibilitati', id));
      alert('Disponibilitate ștearsă!');
      loadDisponibilitati();
    } catch (error) {
      console.error('Error deleting:', error);
      alert('Eroare la ștergere!');
    }
  };

  const resetForm = () => {
    setDataStart('');
    setDataEnd('');
    setOraStart('08:00');
    setOraEnd('22:00');
    setTipDisponibilitate('disponibil');
    setNotita('');
  };

  const getTipBadgeClass = tip => {
    switch (tip) {
      case 'disponibil':
        return 'badge-disponibil';
      case 'indisponibil':
        return 'badge-indisponibil';
      case 'preferinta':
        return 'badge-preferinta';
      default:
        return 'badge-disponibil';
    }
  };

  return (
    <div className="page-container">
      {/* Header */}
      <div className="page-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1>Disponibilitate</h1>
            <p className="page-subtitle">Marchează când ești disponibil pentru evenimente</p>
          </div>
          <div style={{ display: 'flex', gap: '1rem' }}>
            <button onClick={() => navigate('/home')} className="btn-secondary">
              ← Înapoi
            </button>
            <button onClick={() => setShowAddModal(true)} className="btn-refresh">
              + Adaugă Disponibilitate
            </button>
          </div>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="loading-container">
          <div className="spinner"></div>
          <p>Se încarcă disponibilitățile...</p>
        </div>
      )}

      {/* Lista disponibilități */}
      {!loading && (
        <div className="disponibilitati-list">
          {disponibilitati.length === 0 ? (
            <div className="empty-state">
              <p>Nu ai disponibilități marcate încă.</p>
              <button onClick={() => setShowAddModal(true)} className="btn-refresh">
                Adaugă Prima Disponibilitate
              </button>
            </div>
          ) : (
            disponibilitati.map(disp => (
              <div key={disp.id} className="disponibilitate-card">
                <div className="disp-header">
                  <div>
                    <span className={`badge ${getTipBadgeClass(disp.tipDisponibilitate)}`}>
                      {disp.tipDisponibilitate === 'disponibil' && '✓ Disponibil'}
                      {disp.tipDisponibilitate === 'indisponibil' && '✗ Indisponibil'}
                      {disp.tipDisponibilitate === 'preferinta' && '★ Preferință'}
                    </span>
                  </div>
                  <button onClick={() => handleDelete(disp.id)} className="btn-delete-small">
                    🗑️
                  </button>
                </div>
                <div className="disp-body">
                  <p>
                    <strong>Perioada:</strong> {disp.dataStart} → {disp.dataEnd}
                  </p>
                  <p>
                    <strong>Interval orar:</strong> {disp.oraStart} - {disp.oraEnd}
                  </p>
                  {disp.notita && (
                    <p>
                      <strong>Notiță:</strong> {disp.notita}
                    </p>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Modal Adăugare */}
      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Adaugă Disponibilitate</h2>
              <button onClick={() => setShowAddModal(false)} className="btn-close">
                ×
              </button>
            </div>
            <div className="modal-body">
              <form onSubmit={handleAddDisponibilitate}>
                <div className="form-group">
                  <label>Tip Disponibilitate</label>
                  <select
                    value={tipDisponibilitate}
                    onChange={e => setTipDisponibilitate(e.target.value)}
                    className="filter-input"
                  >
                    <option value="disponibil">✓ Disponibil</option>
                    <option value="indisponibil">✗ Indisponibil</option>
                    <option value="preferinta">★ Preferință (doresc să lucrez)</option>
                  </select>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Data Start *</label>
                    <input
                      type="date"
                      value={dataStart}
                      onChange={e => setDataStart(e.target.value)}
                      className="filter-input"
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Data End *</label>
                    <input
                      type="date"
                      value={dataEnd}
                      onChange={e => setDataEnd(e.target.value)}
                      className="filter-input"
                      required
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Ora Start</label>
                    <input
                      type="time"
                      value={oraStart}
                      onChange={e => setOraStart(e.target.value)}
                      className="filter-input"
                    />
                  </div>
                  <div className="form-group">
                    <label>Ora End</label>
                    <input
                      type="time"
                      value={oraEnd}
                      onChange={e => setOraEnd(e.target.value)}
                      className="filter-input"
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label>Notiță (opțional)</label>
                  <textarea
                    value={notita}
                    onChange={e => setNotita(e.target.value)}
                    className="filter-input"
                    rows="3"
                    placeholder="Ex: Prefer evenimente în București"
                  />
                </div>

                <div className="modal-actions">
                  <button
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="btn-secondary"
                  >
                    Anulează
                  </button>
                  <button type="submit" className="btn-refresh">
                    Adaugă
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default DisponibilitateScreen;
