import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { askBot, getDocs, getDoc, getFileUrl, getPdfPageUrl, uploadFile, getUploadedDocs, deleteUploadedDoc, type DocItem, type UploadedDoc } from '../api/client'
import { ChatMessage, type Message } from '../components/ChatMessage'
import { MarkdownView } from '../components/MarkdownView'
import { useAuth } from '../auth/AuthContext'

const SUGGESTIONS = [
  'How many days of annual leave am I entitled to?',
  'What does the company cover under BPJS Kesehatan?',
  'What are the core working hours for remote employees?',
  'How is the Religious Holiday Allowance (THR) calculated?',
]

// Friendlier document names
function prettySource(file: string): string {
  const parts = file.split(/[\\/]/)
  const basename = parts[parts.length - 1]
  const cleanName = basename.replace(/\.(md|pdf|xlsx|xls|pptx|png|jpg|jpeg)$/i, '')
  return cleanName
    .replace(/^OPL-/, 'OPL: ')
    .replace(/[-_]+/g, ' ')
    .trim()
}

function getFileIcon(type: string): string {
  switch (type.toLowerCase()) {
    case 'pdf':
      return '📄'
    case 'png':
    case 'jpg':
    case 'jpeg':
      return '🖼️'
    case 'xlsx':
    case 'xls':
      return '📊'
    case 'pptx':
      return '📑'
    case 'md':
    default:
      return '📝'
  }
}

export function Chat() {
  const { user, logout } = useAuth()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  // Sidebar & Document Preview States
  const [docsList, setDocsList] = useState<DocItem[]>([])
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [activePreviewPath, setActivePreviewPath] = useState<string | null>(null)
  const [activeDocInfo, setActiveDocInfo] = useState<DocItem | null>(null)
  const [previewContent, setPreviewContent] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  // PDF Visual Page State
  const [pdfPage, setPdfPage] = useState<number>(1)
  const [pdfTotalPages, setPdfTotalPages] = useState<number>(1)
  const [pdfViewMode, setPdfViewMode] = useState<'visual' | 'text'>('visual')

  // Lightbox Modal State
  const [lightbox, setLightbox] = useState<{ src: string; title: string } | null>(null)
  const [zoomLevel, setZoomLevel] = useState<number>(1)

  // Upload State
  const [uploadedDocs, setUploadedDocs] = useState<UploadedDoc[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const uploadInputRef = useRef<HTMLInputElement>(null)

  const scrollRef = useRef<HTMLDivElement>(null)

  // Keep the latest message in view
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, loading])

  // Load document list from backend on mount
  useEffect(() => {
    getDocs()
      .then(setDocsList)
      .catch((err) => console.error('Failed to load knowledge documents list:', err))
    getUploadedDocs()
      .then(setUploadedDocs)
      .catch((err) => console.error('Failed to load uploaded docs:', err))
  }, [])

  // Handle file upload (shared by file input and drag-and-drop)
  const handleFilesUpload = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files)
    if (fileArray.length === 0) return
    setUploadError(null)
    setUploading(true)
    const results: UploadedDoc[] = []
    const errors: string[] = []
    for (const file of fileArray) {
      try {
        const doc = await uploadFile(file)
        results.push(doc)
      } catch (err) {
        errors.push(err instanceof Error ? err.message : `Failed to upload ${file.name}`)
      }
    }
    if (results.length > 0) {
      setUploadedDocs((prev) => {
        const existingNames = new Set(prev.map((d) => d.filename))
        return [...prev, ...results.filter((r) => !existingNames.has(r.filename))]
      })
    }
    if (errors.length > 0) {
      setUploadError(errors.join(' | '))
    }
    setUploading(false)
  }, [])

  // Handle delete uploaded doc
  const handleDeleteUpload = useCallback(async (filename: string) => {
    try {
      await deleteUploadedDoc(filename)
      setUploadedDocs((prev) => prev.filter((d) => d.filename !== filename))
      if (activePreviewPath === filename) setActivePreviewPath(null)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Failed to delete file')
    }
  }, [activePreviewPath])

  // Listen for Escape key to close lightbox
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && lightbox) {
        setLightbox(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [lightbox])

  // Filtered & grouped documents
  const groupedDocs = useMemo(() => {
    const query = searchQuery.toLowerCase().trim()
    const filtered = docsList.filter(
      (d) =>
        d.name.toLowerCase().includes(query) ||
        d.equipment.toLowerCase().includes(query) ||
        d.filename.toLowerCase().includes(query)
    )

    const groups: Record<string, DocItem[]> = {}
    for (const doc of filtered) {
      const groupKey = doc.equipment || 'General Documents'
      if (!groups[groupKey]) {
        groups[groupKey] = []
      }
      groups[groupKey].push(doc)
    }
    return groups
  }, [docsList, searchQuery])

  async function send(question: string) {
    const trimmed = question.trim()
    if (!trimmed || loading) return

    setError(null)
    setInput('')
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'user', text: trimmed }])
    setLoading(true)

    try {
      const res = await askBot(trimmed)
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'bot',
          text: res.answer,
          sources: res.sources,
          status: res.status,
        },
      ])
      
      // Auto-preview first source chip if it is an answered message
      if (res.status === 'answered' && res.sources && res.sources.length > 0) {
        selectDoc(res.sources[0])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Is the backend running?')
    } finally {
      setLoading(false)
    }
  }

  // Fetch and display specific document content
  async function selectDoc(filepath: string) {
    setActivePreviewPath(filepath)
    setPdfPage(1)
    
    const existing = docsList.find((d) => d.filename === filepath)
    if (existing) {
      setActiveDocInfo(existing)
    } else {
      const ext = filepath.split('.').pop()?.toLowerCase() || 'md'
      const parts = filepath.split(/[\\/]/)
      setActiveDocInfo({
        filename: filepath,
        name: parts[parts.length - 1],
        file_type: ext,
        equipment: parts.length > 1 ? parts[0] : 'General',
      })
    }

    setPreviewLoading(true)
    setPreviewContent(null)
    try {
      const res = await getDoc(filepath)
      setPreviewContent(res.content)
      setPdfTotalPages(res.total_pages || 1)
    } catch (err) {
      console.error(`Failed to load content for ${filepath}:`, err)
      setPreviewContent(`Error: Failed to load document preview for **${prettySource(filepath)}**.`)
      setPdfTotalPages(1)
    } finally {
      setPreviewLoading(false)
    }
  }

  function openImageLightbox(src: string, title: string) {
    setLightbox({ src, title })
    setZoomLevel(1)
  }

  const isImageFile = activeDocInfo?.file_type && ['png', 'jpg', 'jpeg', 'webp'].includes(activeDocInfo.file_type.toLowerCase())
  const isPdfFile = activeDocInfo?.file_type && activeDocInfo.file_type.toLowerCase() === 'pdf'
  const empty = messages.length === 0

  return (
    <div className="layout-root">
      <header className="topbar">
        <div className="brand-section">
          <button 
            className={`sidebar-toggle ${sidebarOpen ? 'active' : ''}`} 
            onClick={() => setSidebarOpen(!sidebarOpen)}
            title="Toggle Knowledge Hub Sidebar"
          >
            📚 Knowledge Base ({docsList.length})
          </button>
          <div className="brand">
            <div className="brand-text">
              <span className="brand-name">HR Knowledge Hub</span>
              <span className="brand-sub">Company Policies &amp; Employee Assistant</span>
            </div>
          </div>
        </div>
        <div className="topbar-right">
          <span className="user-name">{user?.name || user?.email}</span>
          <button className="logout-btn" onClick={() => logout()}>Log out</button>
        </div>
      </header>

      <div className="layout-body">
        {/* Left Sidebar: List of files grouped by equipment */}
        <aside className={`sidebar ${sidebarOpen ? 'open' : 'collapsed'}`}>
          <div className="sidebar-header-search">
            <div className="sidebar-title">Policy Documents</div>
            <input
              type="search"
              className="sidebar-search-input"
              placeholder="Search policies or topics..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <nav className="sidebar-nav">
            {Object.keys(groupedDocs).length === 0 ? (
              <div className="sidebar-empty">No matching documents found.</div>
            ) : (
              Object.entries(groupedDocs).map(([group, items]) => (
                <div key={group} className="sidebar-group">
                  <div className="sidebar-group-title" title={group}>
                    {group.replace(/^Set_\d+_/, '')}
                    <span className="sidebar-group-count">{items.length}</span>
                  </div>
                  {items.map((doc) => (
                    <button
                      key={doc.filename}
                      className={`sidebar-item ${activePreviewPath === doc.filename ? 'active' : ''}`}
                      onClick={() => selectDoc(doc.filename)}
                      title={doc.filename}
                    >
                      <span className="doc-icon">{getFileIcon(doc.file_type)}</span>
                      <span className="doc-name">{prettySource(doc.name)}</span>
                      <span className="doc-badge">{doc.file_type.toUpperCase()}</span>
                    </button>
                  ))}
                </div>
              ))
            )}
          </nav>

          {/* Upload Section */}
          <div className="sidebar-upload-section">
            <div className="sidebar-upload-title">📎 My Uploads</div>

            {/* Drag-and-drop zone */}
            <div
              className={`upload-drop-zone ${dragActive ? 'drag-active' : ''} ${uploading ? 'uploading' : ''}`}
              onClick={() => !uploading && uploadInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragActive(true) }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragActive(false)
                if (!uploading && e.dataTransfer.files.length > 0) {
                  handleFilesUpload(e.dataTransfer.files)
                }
              }}
              role="button"
              tabIndex={0}
              aria-label="Upload documents"
              onKeyDown={(e) => e.key === 'Enter' && uploadInputRef.current?.click()}
            >
              <input
                ref={uploadInputRef}
                type="file"
                accept=".md,.pdf,.xlsx,.csv,.pptx"
                multiple
                style={{ display: 'none' }}
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    handleFilesUpload(e.target.files)
                    e.target.value = ''
                  }
                }}
              />
              {uploading ? (
                <div className="upload-drop-inner">
                  <div className="upload-spinner" />
                  <span>Processing…</span>
                </div>
              ) : (
                <div className="upload-drop-inner">
                  <span className="upload-drop-icon">⬆️</span>
                  <span className="upload-drop-label">Drop file or click to browse</span>
                  <span className="upload-drop-hint">PDF · MD · XLSX · CSV · PPTX · max 20 MB</span>
                </div>
              )}
            </div>

            {uploadError && (
              <div className="upload-error-msg">{uploadError}</div>
            )}

            {/* Uploaded doc list */}
            {uploadedDocs.length > 0 && (
              <div className="uploaded-doc-list">
                {uploadedDocs.map((doc) => (
                  <div
                    key={doc.filename}
                    className={`uploaded-doc-item ${activePreviewPath === doc.filename ? 'active' : ''}`}
                  >
                    <button
                      className="uploaded-doc-name"
                      onClick={() => selectDoc(doc.filename)}
                      title={`Preview ${doc.filename}`}
                    >
                      <span className="doc-icon">{getFileIcon(doc.file_type)}</span>
                      <span className="doc-name">{doc.filename}</span>
                      <span className="doc-badge">{doc.file_type.toUpperCase()}</span>
                    </button>
                    <button
                      className="uploaded-doc-delete"
                      onClick={() => handleDeleteUpload(doc.filename)}
                      title={`Remove ${doc.filename} from your knowledge context`}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>

        {/* Center Pane: Chat Area */}
        <div className="chat-container">
          <main className="scroll" ref={scrollRef}>
            <div className="thread">
              {empty && (
                <div className="welcome">
                  <p className="kicker">Your HR Assistant 🧑‍💼</p>
                  <h1 className="welcome-title">
                    Ask me anything about <em>Company Policies &amp; Benefits</em>.
                  </h1>
                  <p className="welcome-lede">
                    Leave entitlements, BPJS health &amp; social security, THR, remote work rules, and more — answers are grounded in official company documents.
                    Upload your own files below to ask questions about them too.
                  </p>
                  <div className="suggestions">
                    {SUGGESTIONS.map((s) => (
                      <button key={s} className="suggestion" onClick={() => send(s)}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((m) => (
                <ChatMessage 
                  key={m.id} 
                  message={m} 
                  onSelectSource={(sourceFile) => selectDoc(sourceFile)}
                  onImageClick={(src, alt) => openImageLightbox(src, alt || 'Image Preview')}
                />
              ))}

              {loading && (
                <div className="row row-bot">
                  <div className="avatar" aria-hidden="true">
                    <span>KB</span>
                  </div>
                  <div className="bubble bubble-bot typing" aria-label="Assistant is typing">
                    <span className="dot" />
                    <span className="dot" />
                    <span className="dot" />
                  </div>
                </div>
              )}
            </div>
          </main>

          <footer className="composer-wrap">
            {error && <div className="error-banner">{error}</div>}
            <form
              className="composer"
              onSubmit={(e) => {
                e.preventDefault()
                send(input)
              }}
            >
              <input
                className="composer-input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about leave, benefits, BPJS, WFH policy, or upload a document to ask about it…"
                aria-label="Your question"
                autoFocus
              />
              <button className="send" type="submit" disabled={loading || !input.trim()}>
                {loading ? 'Analyzing…' : 'Ask'}
              </button>
            </form>
            <p className="disclaimer">
              Answers are based on official company policy documents and any files you upload. For binding HR decisions, always confirm with your HR representative.
            </p>
          </footer>
        </div>

        {/* Right Drawer: Document, PDF & Image Preview Panel */}
        <aside className={`preview-drawer ${activePreviewPath ? 'open' : 'collapsed'}`}>
          <div className="preview-header">
            <div className="preview-title-wrap">
              <span className="preview-icon">
                {activeDocInfo ? getFileIcon(activeDocInfo.file_type) : '📄'}
              </span>
              <span className="preview-title">
                {activePreviewPath ? prettySource(activePreviewPath) : 'Document Preview'}
              </span>
            </div>
            <button 
              className="preview-close" 
              onClick={() => setActivePreviewPath(null)} 
              title="Close Preview"
            >
              ✕
            </button>
          </div>

          {activePreviewPath && (
            <div className="preview-actions">
              <span className="preview-path-badge">{activePreviewPath}</span>
              <a
                href={getFileUrl(activePreviewPath)}
                target="_blank"
                rel="noreferrer"
                className="preview-raw-link"
                title="Open original raw file in new tab"
              >
                🔗 Open Original File
              </a>
            </div>
          )}

          <div className="preview-content scroll">
            {previewLoading ? (
              <div className="preview-loading">
                <div className="spinner" />
                <span>Loading document content...</span>
              </div>
            ) : isImageFile && activePreviewPath ? (
              <div className="preview-image-container">
                <div className="preview-image-header">
                  P&ID Engineering Diagram
                </div>
                <div 
                  className="preview-image-clickable-wrapper"
                  onClick={() => openImageLightbox(getFileUrl(activePreviewPath), activeDocInfo?.name || prettySource(activePreviewPath))}
                  title="Click to expand full-screen"
                >
                  <img
                    src={getFileUrl(activePreviewPath)}
                    alt={activeDocInfo?.name || 'Technical Diagram'}
                    className="preview-image-element clickable"
                  />
                  <div className="preview-image-overlay">
                    <span>🔍 Click to expand full-screen</span>
                  </div>
                </div>
                <p className="preview-image-caption">
                  Click the diagram to open full-screen zoomable view, or use 'Open Original File' above.
                </p>
              </div>
            ) : isPdfFile && activePreviewPath ? (
              <div className="preview-pdf-container">
                <div className="preview-pdf-toolbar">
                  <div className="pdf-view-toggle">
                    <button
                      className={`pdf-toggle-btn ${pdfViewMode === 'visual' ? 'active' : ''}`}
                      onClick={() => setPdfViewMode('visual')}
                    >
                      🖼️ Visual Page
                    </button>
                    <button
                      className={`pdf-toggle-btn ${pdfViewMode === 'text' ? 'active' : ''}`}
                      onClick={() => setPdfViewMode('text')}
                    >
                      📝 Text View
                    </button>
                  </div>

                  {pdfTotalPages > 1 && (
                    <div className="pdf-page-nav">
                      <button
                        className="pdf-page-btn"
                        disabled={pdfPage <= 1}
                        onClick={() => setPdfPage((p) => Math.max(1, p - 1))}
                        title="Previous Page"
                      >
                        ◀
                      </button>
                      <span className="pdf-page-indicator">
                        {pdfPage} / {pdfTotalPages}
                      </span>
                      <button
                        className="pdf-page-btn"
                        disabled={pdfPage >= pdfTotalPages}
                        onClick={() => setPdfPage((p) => Math.min(pdfTotalPages, p + 1))}
                        title="Next Page"
                      >
                        ▶
                      </button>
                    </div>
                  )}
                </div>

                {pdfViewMode === 'visual' ? (
                  <div className="preview-pdf-visual">
                    <div
                      className="preview-image-clickable-wrapper pdf-page-wrapper"
                      onClick={() =>
                        openImageLightbox(
                          getPdfPageUrl(activePreviewPath, pdfPage, 250),
                          `${activeDocInfo?.name || prettySource(activePreviewPath)} (Page ${pdfPage})`
                        )
                      }
                      title="Click to expand full-screen drawing"
                    >
                      <img
                        key={`${activePreviewPath}-page-${pdfPage}`}
                        src={getPdfPageUrl(activePreviewPath, pdfPage, 160)}
                        alt={`${activeDocInfo?.name} Page ${pdfPage}`}
                        className="preview-image-element pdf-page-img clickable"
                      />
                      <div className="preview-image-overlay">
                        <span>🔍 Click to expand full-screen drawing</span>
                      </div>
                    </div>
                    <p className="preview-image-caption">
                      Click the drawing above for full-screen zoomable view, or use 'Open Original File' for the raw PDF.
                    </p>
                  </div>
                ) : (
                  <MarkdownView
                    content={previewContent || ''}
                    onImageClick={(src, alt) => openImageLightbox(src, alt || 'Diagram')}
                  />
                )}
              </div>
            ) : previewContent ? (
              <MarkdownView 
                content={previewContent} 
                onImageClick={(src, alt) => openImageLightbox(src, alt || 'Diagram')}
              />
            ) : (
              <div className="preview-empty">
                Select a document in the left sidebar, or click a source chip in the chat to preview technical specs and diagrams.
              </div>
            )}
          </div>
        </aside>
      </div>


      {/* Lightbox / Expanded Image Modal */}
      {lightbox && (
        <div 
          className="lightbox-backdrop" 
          onClick={() => setLightbox(null)}
          role="dialog"
          aria-modal="true"
        >
          <div className="lightbox-container" onClick={(e) => e.stopPropagation()}>
            <div className="lightbox-header">
              <span className="lightbox-title">🖼️ {lightbox.title}</span>
              <div className="lightbox-tools">
                <button 
                  className="lightbox-btn" 
                  onClick={() => setZoomLevel((z) => Math.max(0.5, z - 0.25))}
                  title="Zoom Out"
                >
                  −
                </button>
                <span className="lightbox-zoom-text">{Math.round(zoomLevel * 100)}%</span>
                <button 
                  className="lightbox-btn" 
                  onClick={() => setZoomLevel((z) => Math.min(3.0, z + 0.25))}
                  title="Zoom In"
                >
                  +
                </button>
                <button 
                  className="lightbox-btn" 
                  onClick={() => setZoomLevel(1)}
                  title="Reset Zoom"
                >
                  Reset
                </button>
                <a
                  href={lightbox.src}
                  target="_blank"
                  rel="noreferrer"
                  className="lightbox-btn lightbox-link"
                  title="Open image in new tab"
                >
                  🔗 Raw
                </a>
                <button 
                  className="lightbox-btn lightbox-close" 
                  onClick={() => setLightbox(null)}
                  title="Close (Esc)"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="lightbox-body">
              <img
                src={lightbox.src}
                alt={lightbox.title}
                className="lightbox-image"
                style={{ transform: `scale(${zoomLevel})` }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


