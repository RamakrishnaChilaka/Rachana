import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
} from 'react'
import { basicSetup, EditorView } from 'codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { Compartment } from '@codemirror/state'
import { Columns2, Code2, Eye } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { TIMING } from '../constants'
import { registerEditorContentFlusher } from '../lib/editorContentSync'
import { useStore } from '../store/useStore'
import type { MarkdownOpenTab } from '../types'

type MarkdownMode = 'edit' | 'preview' | 'split'

interface MarkdownPaneProps {
  tab: MarkdownOpenTab
  isActive: boolean
  theme: 'light' | 'dark'
  presentationMode: boolean
}

const editorTheme = (theme: 'light' | 'dark') => EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'var(--app-surface)',
    color: 'var(--app-text)',
    fontSize: '14px',
  },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: 'var(--code-font)',
    lineHeight: '1.6',
  },
  '.cm-content': {
    minHeight: '100%',
    padding: '28px clamp(24px, 5vw, 72px) 64px',
    caretColor: 'var(--app-accent)',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--app-surface)',
    color: 'var(--app-text-subtle)',
    borderRight: '1px solid var(--app-border-subtle)',
  },
  '.cm-activeLine, .cm-activeLineGutter': {
    backgroundColor: 'var(--app-surface-hover)',
  },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: theme === 'dark' ? '#34506f' : '#b9d8f5',
  },
  '&.cm-focused': { outline: 'none' },
})

const MarkdownPane = memo(function MarkdownPane({
  tab,
  isActive,
  theme,
  presentationMode,
}: MarkdownPaneProps) {
  const [mode, setMode] = useState<MarkdownMode>('split')
  const [previewContent, setPreviewContent] = useState(tab.cachedContent)
  const deferredPreviewContent = useDeferredValue(previewContent)
  const editorHostRef = useRef<HTMLDivElement>(null)
  const editorViewRef = useRef<EditorView | null>(null)
  const pendingContentRef = useRef<string | null>(null)
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const themeCompartmentRef = useRef(new Compartment())
  const initialContentRef = useRef(tab.cachedContent)
  const tabPathRef = useRef(tab.path)
  tabPathRef.current = tab.path
  const visibleMode: MarkdownMode = presentationMode ? 'preview' : mode

  const flushPendingContent = useCallback(() => {
    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current)
      syncTimerRef.current = null
    }
    const content = pendingContentRef.current
    if (content === null) return

    pendingContentRef.current = null
    useStore.getState().updateMarkdownContent(
      tab.tabId,
      tab.contentVersion,
      content
    )
  }, [tab.contentVersion, tab.tabId])

  const scheduleContentSync = useCallback(() => {
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
    syncTimerRef.current = setTimeout(
      flushPendingContent,
      TIMING.SCENE_SYNC_DELAY
    )
  }, [flushPendingContent])

  useEffect(() => {
    const unregister = registerEditorContentFlusher(
      tab.tabId,
      flushPendingContent
    )
    return () => {
      flushPendingContent()
      unregister()
    }
  }, [flushPendingContent, tab.tabId])

  useEffect(() => {
    if (!editorHostRef.current) return

    const view = new EditorView({
      doc: initialContentRef.current,
      parent: editorHostRef.current,
      extensions: [
        basicSetup,
        markdown(),
        EditorView.lineWrapping,
        themeCompartmentRef.current.of(editorTheme(theme)),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return

          const content = update.state.doc.toString()
          pendingContentRef.current = content
          setPreviewContent(content)
          scheduleContentSync()

          const store = useStore.getState()
          const currentTab = store.openTabs.find(
            (candidate) => candidate.tabId === tab.tabId
          )
          if (!currentTab?.modified) {
            store.markFileAsModified(tabPathRef.current, true, tab.tabId)
            store.markTreeNodeAsModified(tabPathRef.current, true)
          }
          if (store.activeFile?.tabId === tab.tabId && !store.isDirty) {
            store.setIsDirty(true)
          }
        }),
      ],
    })
    editorViewRef.current = view

    return () => {
      view.destroy()
      editorViewRef.current = null
    }
  }, [scheduleContentSync, tab.tabId])

  useEffect(() => {
    editorViewRef.current?.dispatch({
      effects: themeCompartmentRef.current.reconfigure(editorTheme(theme)),
    })
  }, [theme])

  useEffect(() => {
    if (!isActive) flushPendingContent()
  }, [flushPendingContent, isActive])

  useEffect(() => {
    if (!isActive || visibleMode === 'preview') return
    const frame = window.requestAnimationFrame(() => {
      editorViewRef.current?.requestMeasure()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [isActive, visibleMode])

  return (
    <div
      className={`markdown-pane ${isActive ? 'visible z-10' : 'hidden'}`}
      role="tabpanel"
      aria-label={tab.name}
      aria-hidden={!isActive}
    >
      <div
        className="markdown-toolbar"
        aria-label="Markdown view mode"
        hidden={presentationMode}
      >
        {([
          ['edit', Code2, 'Edit'],
          ['split', Columns2, 'Split'],
          ['preview', Eye, 'Preview'],
        ] as const).map(([value, Icon, label]) => (
          <button
            key={value}
            type="button"
            className={mode === value ? 'active' : ''}
            aria-pressed={mode === value}
            onClick={() => setMode(value)}
          >
            <Icon aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </div>
      <div className={`markdown-workspace mode-${visibleMode}`}>
        <section
          className="markdown-source"
          aria-label="Markdown source editor"
          hidden={visibleMode === 'preview'}
        >
          <div ref={editorHostRef} className="markdown-code-editor" />
        </section>
        <article
          className="markdown-preview custom-scrollbar"
          aria-label="Markdown preview"
          hidden={visibleMode === 'edit'}
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            skipHtml
            components={{
              a: ({ href, children, ...props }) => {
                const external = href?.startsWith('https://') || href?.startsWith('http://')
                return (
                  <a
                    {...props}
                    href={href}
                    target={external ? '_blank' : undefined}
                    rel={external ? 'noreferrer' : undefined}
                  >
                    {children}
                  </a>
                )
              },
            }}
          >
            {deferredPreviewContent}
          </ReactMarkdown>
        </article>
      </div>
    </div>
  )
}, (previous, current) => (
  previous.tab.tabId === current.tab.tabId &&
  previous.tab.path === current.tab.path &&
  previous.tab.name === current.tab.name &&
  previous.tab.contentVersion === current.tab.contentVersion &&
  previous.isActive === current.isActive &&
  previous.theme === current.theme &&
  previous.presentationMode === current.presentationMode
))

interface MarkdownEditorProps {
  theme: 'light' | 'dark'
  presentationMode: boolean
}

export function MarkdownEditor({
  theme,
  presentationMode,
}: MarkdownEditorProps) {
  const activeFile = useStore((state) => state.activeFile)
  const openTabs = useStore((state) => state.openTabs)
  const markdownTabs = openTabs.filter(
    (tab): tab is MarkdownOpenTab => tab.kind === 'markdown'
  )

  return (
    <main className="editor-region markdown-editor-region">
      {markdownTabs.map((tab) => (
        <MarkdownPane
          key={`${tab.tabId}:${tab.contentVersion}`}
          tab={tab}
          isActive={activeFile?.tabId === tab.tabId}
          theme={theme}
          presentationMode={presentationMode}
        />
      ))}
    </main>
  )
}
