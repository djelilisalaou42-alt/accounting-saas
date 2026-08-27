'use client';

import { useEffect, useState, FormEvent } from 'react';
import { AxiosError } from 'axios';
import { apiClient } from '../../lib/api-client';

type EntityType = 'accountingEntry' | 'invoice' | 'fixedAsset' | 'taxDeclaration' | 'budget';

interface AttachmentRow {
  id: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  category: string | null;
  description: string | null;
  createdAt: string;
  uploadedBy: { firstName: string; lastName: string };
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

/**
 * Composant réutilisable de pièces jointes (Étape 16) — connecté aux
 * vraies API `/companies/:companyId/attachments`. Un seul lien
 * (`entityType`/`entityId`) par instance, cohérent avec la conception
 * du modèle Attachment (un seul objet métier rattaché par fichier).
 */
export function AttachmentsPanel({ companyId, entityType, entityId }: { companyId: string; entityType: EntityType; entityId: string }) {
  const [attachments, setAttachments] = useState<AttachmentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');

  async function load() {
    try {
      const { data } = await apiClient.get(`/companies/${companyId}/attachments`, { params: { entityType, entityId } });
      setAttachments(data);
    } catch {
      setError('Impossible de charger les pièces jointes (permission ATTACHMENT.READ requise).');
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, entityType, entityId]);

  async function handleUpload(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setError(null);
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      if (description) formData.append('description', description);
      if (category) formData.append('category', category);
      formData.append(`${entityType}Id`, entityId);
      await apiClient.post(`/companies/${companyId}/attachments`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      setFile(null);
      setDescription('');
      setCategory('');
      load();
    } catch (err) {
      if (err instanceof AxiosError && err.response?.data?.message) {
        setError(Array.isArray(err.response.data.message) ? err.response.data.message.join(' ') : err.response.data.message);
      } else {
        setError('Une erreur est survenue lors du téléversement.');
      }
    } finally {
      setIsUploading(false);
    }
  }

  function handleDownload(id: string, fileName: string) {
    apiClient
      .get(`/companies/${companyId}/attachments/${id}/download`, { responseType: 'blob' })
      .then(({ data }) => {
        const url = window.URL.createObjectURL(data);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        window.URL.revokeObjectURL(url);
      })
      .catch(() => setError('Impossible de télécharger ce fichier.'));
  }

  async function handleDelete(id: string) {
    setError(null);
    try {
      await apiClient.delete(`/companies/${companyId}/attachments/${id}`);
      load();
    } catch {
      setError('Impossible de supprimer cette pièce jointe (permission ATTACHMENT.DELETE requise).');
    }
  }

  return (
    <div style={{ border: '1px solid #ddd', borderRadius: 6, padding: '1rem', marginTop: '1rem' }}>
      <h3 style={{ marginTop: 0 }}>Pièces jointes</h3>
      {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}

      {attachments === null ? (
        <p>Chargement…</p>
      ) : attachments.length === 0 ? (
        <p style={{ fontStyle: 'italic', color: '#666' }}>Aucune pièce jointe.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '1rem' }}>
          <thead>
            <tr>
              <th align="left">Nom</th>
              <th align="left">Type</th>
              <th align="right">Taille</th>
              <th align="left">Ajouté par</th>
              <th align="left">Date</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {attachments.map((a) => (
              <tr key={a.id}>
                <td>{a.fileName}{a.description ? ` — ${a.description}` : ''}</td>
                <td>{a.category ?? a.mimeType}</td>
                <td align="right">{fmtSize(a.fileSizeBytes)}</td>
                <td>{a.uploadedBy.firstName} {a.uploadedBy.lastName}</td>
                <td>{a.createdAt.slice(0, 10)}</td>
                <td>
                  <button type="button" onClick={() => handleDownload(a.id, a.fileName)}>Télécharger</button>{' '}
                  <button type="button" onClick={() => handleDelete(a.id)}>Supprimer</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <form onSubmit={handleUpload} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div>
          <label htmlFor={`file-${entityId}`}>Fichier</label>
          <br />
          <input id={`file-${entityId}`} type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required />
        </div>
        <div>
          <label htmlFor={`desc-${entityId}`}>Description</label>
          <br />
          <input id={`desc-${entityId}`} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div>
          <label htmlFor={`cat-${entityId}`}>Catégorie</label>
          <br />
          <input id={`cat-${entityId}`} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Facture, reçu…" />
        </div>
        <button type="submit" disabled={isUploading || !file}>
          {isUploading ? 'Envoi…' : 'Téléverser'}
        </button>
      </form>
    </div>
  );
}
