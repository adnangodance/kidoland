/* eslint-disable react/set-state-in-effect */
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from './auth-context'
import { useI18n } from './i18n/language-context'
import {
  listChildren,
  listDocuments,
  uploadDocument,
  verifyDocument,
  deleteDocument,
  type Child,
  type ChildDocument,
  type DocumentType,
  type DocumentSummaryStats,
} from './api'
import { compressImage, MAX_IMAGE_FILE_SIZE } from './utils/imageCompressor'

const DOC_TYPE_ICONS: Record<DocumentType, string> = {
  enrollment_contract: '📝',
  vaccination_record: '💉',
  birth_certificate: '📜',
  medical_clearance: '🩺',
  custody_legal: '⚖️',
  other: '📁',
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function Documents() {
  const { token, user } = useAuth()
  const { t } = useI18n()
  const alive = useRef(true)
  const docCameraRef = useRef<HTMLInputElement>(null)

  const [children, setChildren] = useState<Child[]>([])
  const [documents, setDocuments] = useState<ChildDocument[]>([])
  const [summary, setSummary] = useState<DocumentSummaryStats>({
    total: 0,
    verified: 0,
    pendingReview: 0,
    rejected: 0,
    expired: 0,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  // Filters
  const [selectedChildId, setSelectedChildId] = useState<string>('')
  const [selectedStatus, setSelectedStatus] = useState<string>('')
  const [selectedType, setSelectedType] = useState<string>('')

  // Upload modal state
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [uploadChildId, setUploadChildId] = useState<string>('')
  const [uploadDocType, setUploadDocType] = useState<DocumentType>('vaccination_record')
  const [uploadTitle, setUploadTitle] = useState('')
  const [uploadNotes, setUploadNotes] = useState('')
  const [uploadExpiry, setUploadExpiry] = useState('')
  const [uploadFileUrl, setUploadFileUrl] = useState('')
  const [uploadFileName, setUploadFileName] = useState('')
  const [uploadFileSize, setUploadFileSize] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  // Rejection modal
  const [rejectingDocId, setRejectingDocId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  const isDirector = user?.role === 'director'
  const isParent = user?.role === 'parent'

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  // Load children roster
  useEffect(() => {
    if (!token) return
    let active = true

    async function fetchChildren() {
      try {
        const res = await listChildren(token!)
        if (active && res.children.length > 0) {
          setChildren(res.children)
          setUploadChildId((prev) => prev || res.children[0].id)
        }
      } catch {
        if (active) setError(t.loadError)
      }
    }

    void fetchChildren()
    return () => {
      active = false
    }
  }, [token, t.loadError])

  // Load documents
  const loadDocs = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      const res = await listDocuments(token, {
        childId: selectedChildId || undefined,
        status: selectedStatus || undefined,
        type: selectedType || undefined,
      })
      if (alive.current) {
        setDocuments(res.documents)
        setSummary(res.summary)
      }
    } catch {
      if (alive.current) {
        setError(t.loadError)
      }
    } finally {
      if (alive.current) {
        setLoading(false)
      }
    }
  }, [token, selectedChildId, selectedStatus, selectedType, t.loadError])

  useEffect(() => {
    void loadDocs()
  }, [loadDocs])

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.size > MAX_IMAGE_FILE_SIZE) {
      setUploadError(t.imageTooLarge)
      return
    }

    setUploadError(null)
    setUploadFileName(file.name)
    setUploadFileSize(file.size)

    if (!uploadTitle) {
      setUploadTitle(file.name.replace(/\.[^/.]+$/, ''))
    }

    if (file.type.startsWith('image/')) {
      try {
        const result = await compressImage(file, {
          maxDimension: 1600,
          quality: 0.82,
          maxFileSize: MAX_IMAGE_FILE_SIZE,
        })
        if (alive.current) {
          setUploadFileUrl(result.dataUrl)
          setUploadFileSize(result.compressedSize)
        }
      } catch {
        if (alive.current) setUploadError(t.imageInvalid)
      }
    } else {
      const reader = new FileReader()
      reader.onload = () => {
        if (alive.current && typeof reader.result === 'string') {
          setUploadFileUrl(reader.result)
        }
      }
      reader.readAsDataURL(file)
    }
  }

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token || !uploadChildId || !uploadFileUrl) {
      setUploadError(t.imageInvalid)
      return
    }

    setUploading(true)
    setUploadError(null)

    try {
      await uploadDocument(token, {
        childId: uploadChildId,
        documentType: uploadDocType,
        title: uploadTitle.trim() || uploadFileName,
        fileUrl: uploadFileUrl,
        fileName: uploadFileName,
        fileSizeBytes: uploadFileSize,
        notes: uploadNotes.trim(),
        expirationDate: uploadExpiry || null,
      })

      if (alive.current) {
        setMessage(t.documentUploaded)
        setShowUploadModal(false)
        setUploadTitle('')
        setUploadNotes('')
        setUploadExpiry('')
        setUploadFileUrl('')
        setUploadFileName('')
        setUploadFileSize(0)
      }
      await loadDocs()
    } catch {
      if (alive.current) {
        setUploadError(t.saveError)
      }
    } finally {
      if (alive.current) {
        setUploading(false)
      }
    }
  }

  const handleVerify = async (docId: string, status: 'verified' | 'rejected', reason?: string) => {
    if (!token) return
    try {
      await verifyDocument(token, docId, status, reason)
      if (alive.current) {
        setMessage(status === 'verified' ? t.documentVerified : t.documentRejected)
        setRejectingDocId(null)
        setRejectReason('')
      }
      await loadDocs()
    } catch {
      if (alive.current) {
        setError(t.saveError)
      }
    }
  }

  const handleDelete = async (docId: string) => {
    if (!token) return
    try {
      await deleteDocument(token, docId)
      if (alive.current) {
        setMessage(t.documentDeleted)
      }
      await loadDocs()
    } catch {
      if (alive.current) {
        setError(t.saveError)
      }
    }
  }

  const getDocTypeLabel = (type: DocumentType) => {
    switch (type) {
      case 'enrollment_contract': return t.docTypeContract
      case 'vaccination_record': return t.docTypeVaccination
      case 'birth_certificate': return t.docTypeBirthCert
      case 'medical_clearance': return t.docTypeMedical
      case 'custody_legal': return t.docTypeCustody
      default: return t.docTypeOther
    }
  }

  return (
    <section className="panel documents-panel">
      <div className="panel-header-row">
        <div>
          <h1 tabIndex={-1}>{t.documentsTitle}</h1>
          <p className="panel-subtitle">
            {isParent ? t.documentsParentSubtitle : t.documentsSubtitle}
          </p>
        </div>
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            setShowUploadModal(true)
            setUploadError(null)
            setMessage(null)
          }}
        >
          {t.uploadDocumentBtn}
        </button>
      </div>

      {error && <div className="notice error">{error}</div>}
      {message && <div className="notice success">{message}</div>}

      {/* Summary Stat Cards */}
      <div className="doc-summary-grid">
        <div className="doc-summary-card total">
          <span className="summary-icon">📁</span>
          <div className="summary-info">
            <span className="summary-label">{t.statTotalDocs}</span>
            <strong className="summary-value">{summary.total}</strong>
          </div>
        </div>
        <div className="doc-summary-card verified">
          <span className="summary-icon">✓</span>
          <div className="summary-info">
            <span className="summary-label">{t.statVerifiedDocs}</span>
            <strong className="summary-value">{summary.verified}</strong>
          </div>
        </div>
        <div className="doc-summary-card pending">
          <span className="summary-icon">⏳</span>
          <div className="summary-info">
            <span className="summary-label">{t.statPendingDocs}</span>
            <strong className="summary-value">{summary.pendingReview}</strong>
          </div>
        </div>
        <div className="doc-summary-card expired">
          <span className="summary-icon">⚠️</span>
          <div className="summary-info">
            <span className="summary-label">{t.statusRejected}</span>
            <strong className="summary-value">{summary.rejected}</strong>
          </div>
        </div>
      </div>

      {/* Filter Row */}
      <div className="doc-filter-bar">
        {children.length > 1 && (
          <div className="filter-group">
            <label htmlFor="filter-child">{t.paymentsChild}:</label>
            <select
              id="filter-child"
              value={selectedChildId}
              onChange={(e) => setSelectedChildId(e.target.value)}
              className="input-select"
            >
              <option value="">{t.domainAll}</option>
              {children.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.groupName})
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="filter-group">
          <label htmlFor="filter-status">{t.paymentsStatus}:</label>
          <select
            id="filter-status"
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="input-select"
          >
            <option value="">{t.filterAllStatuses}</option>
            <option value="verified">{t.statusVerified}</option>
            <option value="pending_review">{t.statusPendingReview}</option>
            <option value="rejected">{t.statusRejected}</option>
            <option value="expired">{t.statusExpired}</option>
          </select>
        </div>

        <div className="filter-group">
          <label htmlFor="filter-type">{t.docTypeLabel}:</label>
          <select
            id="filter-type"
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="input-select"
          >
            <option value="">{t.filterAllTypes}</option>
            <option value="enrollment_contract">{t.docTypeContract}</option>
            <option value="vaccination_record">{t.docTypeVaccination}</option>
            <option value="birth_certificate">{t.docTypeBirthCert}</option>
            <option value="medical_clearance">{t.docTypeMedical}</option>
            <option value="custody_legal">{t.docTypeCustody}</option>
            <option value="other">{t.docTypeOther}</option>
          </select>
        </div>
      </div>

      {/* Documents List */}
      {loading ? (
        <div className="loading-state">{t.loading}</div>
      ) : documents.length === 0 ? (
        <p className="empty-notice">{t.noDocumentsFound}</p>
      ) : (
        <div className="documents-list">
          {documents.map((doc) => {
            const icon = DOC_TYPE_ICONS[doc.documentType] || '📄'

            return (
              <article key={doc.id} className={`doc-card status-${doc.status}`}>
                <div className="doc-card-header">
                  <div className="doc-header-main">
                    <span className="doc-icon-badge">{icon}</span>
                    <div>
                      <div className="doc-type-pill">{getDocTypeLabel(doc.documentType)}</div>
                      <h3 className="doc-title">{doc.title}</h3>
                      <span className="doc-child-badge">
                        👶 {doc.childName} · {doc.groupName}
                      </span>
                    </div>
                  </div>

                  <div className="doc-status-indicator">
                    {doc.status === 'verified' && (
                      <span className="badge badge-verified">✓ {t.statusVerified}</span>
                    )}
                    {doc.status === 'pending_review' && (
                      <span className="badge badge-pending">⏳ {t.statusPendingReview}</span>
                    )}
                    {doc.status === 'rejected' && (
                      <span className="badge badge-rejected">⚠️ {t.statusRejected}</span>
                    )}
                    {doc.status === 'expired' && (
                      <span className="badge badge-expired">⏰ {t.statusExpired}</span>
                    )}
                  </div>
                </div>

                {doc.rejectionReason && (
                  <div className="rejection-box">
                    <strong>⚠️ {t.statusRejected}:</strong> {doc.rejectionReason}
                  </div>
                )}

                {doc.notes && <p className="doc-notes">"{doc.notes}"</p>}

                <div className="doc-meta-footer">
                  <div className="doc-file-info">
                    <span>📄 {doc.fileName}</span>
                    {doc.fileSizeBytes > 0 && <span>({formatFileSize(doc.fileSizeBytes)})</span>}
                    {doc.expirationDate && (
                      <span>· ⏰ {t.docExpiryLabel}: <strong>{doc.expirationDate}</strong></span>
                    )}
                  </div>

                  <div className="doc-audit-info">
                    <span>{t.evaluatedBy}: {doc.uploadedByName}</span>
                    {doc.verifiedByName && (
                      <span> · ✓ {t.statusVerified}: {doc.verifiedByName}</span>
                    )}
                  </div>
                </div>

                <div className="doc-actions-row">
                  <a
                    href={doc.fileUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="btn ghost btn-view-file"
                    download={doc.fileName}
                  >
                    ⬇️ {t.downloadFile}
                  </a>

                  {isDirector && doc.status === 'pending_review' && (
                    <>
                      <button
                        type="button"
                        className="btn-verify"
                        onClick={() => handleVerify(doc.id, 'verified')}
                      >
                        ✓ {t.btnVerifyDoc}
                      </button>
                      <button
                        type="button"
                        className="btn-reject"
                        onClick={() => {
                          setRejectingDocId(doc.id)
                          setRejectReason('')
                        }}
                      >
                        ✕ {t.btnRejectDoc}
                      </button>
                    </>
                  )}

                  {(isDirector || (isParent && doc.status !== 'verified')) && (
                    <button
                      type="button"
                      className="btn-delete-doc"
                      onClick={() => handleDelete(doc.id)}
                      aria-label={t.removeFee}
                    >
                      🗑️
                    </button>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="modal-backdrop" onClick={() => setShowUploadModal(false)}>
          <div
            className="modal-content"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-labelledby="modal-doc-upload-title"
          >
            <div className="modal-header">
              <h2 id="modal-doc-upload-title">{t.uploadDocumentTitle}</h2>
              <button
                type="button"
                className="btn-close"
                onClick={() => setShowUploadModal(false)}
                aria-label={t.cancel}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleUploadSubmit} className="doc-upload-form">
              {uploadError && <div className="notice error">{uploadError}</div>}

              {children.length > 0 && (
                <div className="form-group">
                  <label htmlFor="upload-child-select" className="field-label">
                    {t.paymentsChild}:
                  </label>
                  <select
                    id="upload-child-select"
                    value={uploadChildId}
                    onChange={(e) => setUploadChildId(e.target.value)}
                    className="input-select"
                    required
                  >
                    {children.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.groupName})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="form-group">
                <label htmlFor="upload-doc-type" className="field-label">
                  {t.docTypeLabel}:
                </label>
                <select
                  id="upload-doc-type"
                  value={uploadDocType}
                  onChange={(e) => setUploadDocType(e.target.value as DocumentType)}
                  className="input-select"
                  required
                >
                  <option value="enrollment_contract">{t.docTypeContract}</option>
                  <option value="vaccination_record">{t.docTypeVaccination}</option>
                  <option value="birth_certificate">{t.docTypeBirthCert}</option>
                  <option value="medical_clearance">{t.docTypeMedical}</option>
                  <option value="custody_legal">{t.docTypeCustody}</option>
                  <option value="other">{t.docTypeOther}</option>
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="upload-doc-title" className="field-label">
                  {t.docTitleLabel}:
                </label>
                <input
                  id="upload-doc-title"
                  type="text"
                  value={uploadTitle}
                  onChange={(e) => setUploadTitle(e.target.value)}
                  placeholder={t.docTitlePlaceholder}
                  className="input-text"
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="upload-file-input" className="field-label">
                  {t.docFileLabel}:
                </label>
                <input
                  id="upload-file-input"
                  type="file"
                  accept=".pdf,image/png,image/jpeg,image/webp"
                  onChange={handleFileChange}
                  className="input-file"
                  required
                />
                <div style={{ marginTop: '6px' }}>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => docCameraRef.current?.click()}
                    style={{ fontSize: '13px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                  >
                    <span aria-hidden="true">📷</span>
                    <span>{t.takePhotoWithCamera}</span>
                  </button>
                  <input
                    ref={docCameraRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    style={{ display: 'none' }}
                    onChange={handleFileChange}
                    tabIndex={-1}
                    aria-hidden="true"
                  />
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="upload-doc-expiry" className="field-label">
                  {t.docExpiryLabel}:
                </label>
                <input
                  id="upload-doc-expiry"
                  type="date"
                  value={uploadExpiry}
                  onChange={(e) => setUploadExpiry(e.target.value)}
                  className="input-text"
                />
              </div>

              <div className="form-group">
                <label htmlFor="upload-doc-notes" className="field-label">
                  {t.docNotesLabel}:
                </label>
                <textarea
                  id="upload-doc-notes"
                  value={uploadNotes}
                  onChange={(e) => setUploadNotes(e.target.value)}
                  placeholder={t.docNotesPlaceholder}
                  rows={3}
                  className="input-textarea"
                />
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => setShowUploadModal(false)}
                  disabled={uploading}
                >
                  {t.cancel}
                </button>
                <button
                  type="submit"
                  className="btn primary"
                  disabled={uploading || !uploadFileUrl}
                >
                  {uploading ? t.loading : t.saveDocument}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reject Modal */}
      {rejectingDocId && (
        <div className="modal-backdrop" onClick={() => setRejectingDocId(null)}>
          <div
            className="modal-content"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-labelledby="modal-reject-title"
          >
            <div className="modal-header">
              <h2 id="modal-reject-title">{t.btnRejectDoc}</h2>
              <button
                type="button"
                className="btn-close"
                onClick={() => setRejectingDocId(null)}
                aria-label={t.cancel}
              >
                ✕
              </button>
            </div>

            <div className="reject-form-content">
              <label htmlFor="reject-reason-input" className="field-label">
                {t.rejectionReasonPrompt}
              </label>
              <textarea
                id="reject-reason-input"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="e.g. Incomplete vaccination schedule, illegible scan..."
                rows={3}
                className="input-textarea"
              />

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => setRejectingDocId(null)}
                >
                  {t.cancel}
                </button>
                <button
                  type="button"
                  className="btn-reject"
                  onClick={() => handleVerify(rejectingDocId, 'rejected', rejectReason)}
                >
                  {t.btnRejectDoc}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
export default Documents
