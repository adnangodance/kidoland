/* Direct messaging and inquiries module between parents and kindergarten staff */
/* eslint-disable react/set-state-in-effect, react-hooks/exhaustive-deps */
import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  listConversations,
  createConversation,
  getConversationMessages,
  sendChatMessage,
  listChildren,
  type Conversation,
  type ChatMessage,
  type Child,
  type ConversationInput,
} from './api'
import { useAuth } from './auth-context'
import { useI18n } from './i18n/language-context'
import { useAlive } from './pilot-utils'
import ChildAvatar from './ChildAvatar'

export default function Messages() {
  const { token, user } = useAuth()
  const { t } = useI18n()
  const alive = useAlive()

  const [conversations, setConversations] = useState<Conversation[]>([])
  const [children, setChildren] = useState<Child[]>([])
  const [selectedConv, setSelectedConv] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [threadLoading, setThreadLoading] = useState(false)
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)

  const [showNewModal, setShowNewModal] = useState(false)
  const [newDraft, setNewDraft] = useState<ConversationInput>({ childId: '', subject: '', message: '' })
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  const [replyText, setReplyText] = useState('')
  const [sending, setSending] = useState(false)
  const [replyNotice, setReplyNotice] = useState('')

  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    if (!token) return

    Promise.all([
      listConversations(token),
      listChildren(token).catch(() => ({ children: [] })),
    ])
      .then(([convRes, childRes]) => {
        if (!cancelled && alive.current) {
          setConversations(convRes.conversations)
          setChildren(childRes.children)
          if (childRes.children.length > 0 && !newDraft.childId) {
            setNewDraft((prev) => ({ ...prev, childId: childRes.children[0].id }))
          }
        }
      })
      .catch(() => {
        if (!cancelled && alive.current) setError(true)
      })
      .finally(() => {
        if (!cancelled && alive.current) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [token, retry])

  function openConversation(conv: Conversation) {
    setSelectedConv(conv)
    setReplyText('')
    setReplyNotice('')
    setThreadLoading(true)
    if (!token) return

    getConversationMessages(token, conv.id)
      .then((res) => {
        if (alive.current) {
          setMessages(res.messages)
          // Clear unread count locally for this conversation
          setConversations((prev) =>
            prev.map((c) => (c.id === conv.id ? { ...c, unreadCount: 0 } : c)),
          )
        }
      })
      .catch(() => {})
      .finally(() => {
        if (alive.current) setThreadLoading(false)
      })
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    if (!token || creating || !newDraft.childId || !newDraft.subject.trim() || !newDraft.message.trim()) return
    setCreating(true)
    setCreateError('')

    try {
      const res = await createConversation(token, {
        childId: newDraft.childId,
        subject: newDraft.subject.trim(),
        message: newDraft.message.trim(),
      })
      if (alive.current) {
        setConversations((prev) => [res.conversation, ...prev])
        setShowNewModal(false)
        setNewDraft({ childId: children[0]?.id || '', subject: '', message: '' })
        openConversation(res.conversation)
      }
    } catch {
      if (alive.current) setCreateError(t.saveError)
    } finally {
      if (alive.current) setCreating(false)
    }
  }

  async function handleSendReply(e: FormEvent) {
    e.preventDefault()
    if (!token || sending || !selectedConv || !replyText.trim()) return
    setSending(true)
    setReplyNotice('')

    try {
      const res = await sendChatMessage(token, selectedConv.id, replyText.trim())
      if (alive.current) {
        setMessages((prev) => [...prev, res.message])
        setReplyText('')
        setReplyNotice(t.replySent)
        // Update last message in the thread list
        setConversations((prev) =>
          prev.map((c) =>
            c.id === selectedConv.id
              ? {
                  ...c,
                  lastMessage: res.message.content,
                  lastMessageAt: res.message.createdAt,
                  lastSenderName: res.message.senderName,
                }
              : c,
          ),
        )
      }
    } catch {
      // quiet fallback
    } finally {
      if (alive.current) setSending(false)
    }
  }

  return (
    <section className="panel messages-panel">
      <div className="panel-header-row">
        <div>
          <h1>{t.messagesTitle}</h1>
          <p className="card-subtitle">{t.messagesSubtitle}</p>
        </div>
        {!selectedConv && (
          <button
            type="button"
            className="btn primary small-btn"
            onClick={() => {
              setShowNewModal(!showNewModal)
              setCreateError('')
            }}
          >
            {showNewModal ? t.cancel : `+ ${t.newMessage}`}
          </button>
        )}
      </div>

      {loading && <p role="status">{t.loading}</p>}
      {error && (
        <p role="alert" className="form-error">
          {t.loadError}{' '}
          <button type="button" onClick={() => setRetry((v) => v + 1)}>
            {t.attendanceRetry}
          </button>
        </p>
      )}

      {/* New Conversation Form */}
      {showNewModal && (
        <form className="login-form new-conversation-form" onSubmit={handleCreate}>
          <h2>{t.newMessage}</h2>
          <fieldset disabled={creating}>
            <label>
              {t.selectChildToMessage}
              <select
                required
                value={newDraft.childId}
                onChange={(e) => setNewDraft({ ...newDraft, childId: e.target.value })}
              >
                {children.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.groupName})
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t.messageSubject}
              <input
                required
                maxLength={200}
                placeholder={t.messageSubjectPlaceholder}
                value={newDraft.subject}
                onChange={(e) => setNewDraft({ ...newDraft, subject: e.target.value })}
              />
            </label>
            <label>
              {t.messageContent}
              <textarea
                required
                rows={3}
                placeholder={t.messageContentPlaceholder}
                value={newDraft.message}
                onChange={(e) => setNewDraft({ ...newDraft, message: e.target.value })}
              />
            </label>
            {createError && <p role="alert" className="form-error">{createError}</p>}
            <div className="actions">
              <button className="btn primary">
                {creating ? t.attendanceSaving : t.startConversation}
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={() => setShowNewModal(false)}
              >
                {t.cancel}
              </button>
            </div>
          </fieldset>
        </form>
      )}

      {/* Thread Detail View */}
      {selectedConv ? (
        <div className="chat-thread-container">
          <div className="chat-thread-header">
            <button
              type="button"
              className="btn ghost small-btn"
              onClick={() => setSelectedConv(null)}
            >
              ← {t.backToConversations}
            </button>
            <div className="chat-recipient-info">
              <ChildAvatar name={selectedConv.childName} size={36} />
              <div>
                <strong>{selectedConv.subject}</strong>
                <p className="card-subtitle">
                  {selectedConv.childName} · {selectedConv.groupName} · {selectedConv.parentName}
                </p>
              </div>
            </div>
          </div>

          {threadLoading ? (
            <p role="status">{t.loading}</p>
          ) : (
            <div className="chat-message-stream">
              {messages.map((m) => {
                const isMine = m.senderUserId === user?.id
                return (
                  <div
                    key={m.id}
                    className={`chat-bubble-row ${isMine ? 'mine' : 'theirs'}`}
                  >
                    <div className="chat-bubble">
                      <div className="chat-bubble-meta">
                        <span className="sender-name">{m.senderName}</span>
                        <span className="sender-role badge">{m.senderRole}</span>
                      </div>
                      <p className="chat-text">{m.content}</p>
                      <span className="chat-time">
                        {m.createdAt.slice(11, 16)}
                      </span>
                    </div>
                  </div>
                )
              })}
              <div ref={messagesEndRef} />
            </div>
          )}

          {/* Reply Box */}
          <form className="chat-reply-form" onSubmit={handleSendReply}>
            {replyNotice && <p role="status" className="notice">{replyNotice}</p>}
            <div className="chat-input-row">
              <input
                required
                maxLength={5000}
                placeholder={t.typeReplyPlaceholder}
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                disabled={sending}
              />
              <button className="btn primary" disabled={sending || !replyText.trim()}>
                {sending ? '...' : t.sendMessage}
              </button>
            </div>
          </form>
        </div>
      ) : (
        /* Conversation Threads List */
        !loading && (
          <div className="conversations-list">
            {conversations.length === 0 ? (
              <p className="empty-hint">{t.noMessages}</p>
            ) : (
              conversations.map((conv) => (
                <article
                  key={conv.id}
                  className="roster-card conversation-card"
                  onClick={() => openConversation(conv)}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="card-avatar-heading">
                    <ChildAvatar name={conv.childName} size={42} />
                    <div className="conversation-header-info">
                      <div className="conv-title-row">
                        <h2>{conv.subject}</h2>
                        {conv.unreadCount > 0 && (
                          <span className="badge unread-badge">
                            {conv.unreadCount} {t.unreadBadge}
                          </span>
                        )}
                      </div>
                      <p className="card-subtitle">
                        {conv.childName} ({conv.groupName}) · {conv.parentName}
                      </p>
                    </div>
                  </div>
                  {conv.lastMessage && (
                    <p className="conv-preview-text">
                      <strong>{conv.lastSenderName}:</strong> {conv.lastMessage}
                    </p>
                  )}
                  <div className="conv-card-footer">
                    <span className="conv-date">
                      {conv.lastMessageAt ? conv.lastMessageAt.slice(0, 10) : conv.createdAt.slice(0, 10)}
                    </span>
                    <button
                      type="button"
                      className="btn ghost small-btn"
                      onClick={(e) => {
                        e.stopPropagation()
                        openConversation(conv)
                      }}
                    >
                      {t.dashRead}
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        )
      )}
    </section>
  )
}
