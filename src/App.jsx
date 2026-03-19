import { useEffect, useMemo, useRef, useState } from 'react';
import {
  clearSavedDirectoryHandle,
  ensureReadPermission,
  getSavedDirectoryHandle,
  isFsAccessSupported,
  listTxtFiles,
  pickLibraryDirectory,
  readTxtFile,
} from './lib/fs';
import { extractChapters } from './lib/parser';
import './styles.css';

const LS_THEME = 'txt-reader-theme';
const LS_FONT_SIZE = 'txt-reader-font-size';
const LS_LAST_BOOK = 'txt-reader-last-book';
const LS_LAST_CHAPTER = 'txt-reader-last-chapter';
const LS_PAGE_WIDTH = 'txt-reader-page-width';
const LS_LINE_HEIGHT = 'txt-reader-line-height';

const PAGE_WIDTH_OPTIONS = {
  narrow: 720,
  medium: 820,
  wide: 920,
};

const LINE_HEIGHT_OPTIONS = {
  compact: 1.8,
  comfortable: 2,
  loose: 2.2,
};

export default function App() {
  const [supported] = useState(isFsAccessSupported());
  const [dirHandle, setDirHandle] = useState(null);
  const [books, setBooks] = useState([]);
  const [selectedBook, setSelectedBook] = useState(null);
  const [encoding, setEncoding] = useState('');
  const [chapters, setChapters] = useState([]);
  const [chapterIndex, setChapterIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [theme, setTheme] = useState(localStorage.getItem(LS_THEME) || 'light');
  const [fontSize, setFontSize] = useState(Number(localStorage.getItem(LS_FONT_SIZE) || 22));
  const [pageWidth, setPageWidth] = useState(localStorage.getItem(LS_PAGE_WIDTH) || 'medium');
  const [lineHeightMode, setLineHeightMode] = useState(
    localStorage.getItem(LS_LINE_HEIGHT) || 'comfortable'
  );

  const [tocOpen, setTocOpen] = useState(false);
  const [bookshelfOpen, setBookshelfOpen] = useState(false);
  const [styleOpen, setStyleOpen] = useState(false);
  const [fontPanelOpen, setFontPanelOpen] = useState(false);

  const readerRef = useRef(null);
  const activeChapterButtonRef = useRef(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(LS_THEME, theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(LS_FONT_SIZE, String(fontSize));
  }, [fontSize]);

  useEffect(() => {
    localStorage.setItem(LS_PAGE_WIDTH, pageWidth);
  }, [pageWidth]);

  useEffect(() => {
    localStorage.setItem(LS_LINE_HEIGHT, lineHeightMode);
  }, [lineHeightMode]);

  useEffect(() => {
    init();
  }, []);

  useEffect(() => {
    if (readerRef.current) {
      readerRef.current.scrollTo({ top: 0, behavior: 'auto' });
    }
  }, [chapterIndex, selectedBook]);

  useEffect(() => {
    if (tocOpen && activeChapterButtonRef.current) {
      activeChapterButtonRef.current.scrollIntoView({
        block: 'center',
        behavior: 'smooth',
      });
    }
  }, [tocOpen, chapterIndex]);

  async function init() {
    if (!supported) return;

    try {
      const savedHandle = await getSavedDirectoryHandle();
      if (!savedHandle) return;

      const ok = await ensureReadPermission(savedHandle);
      if (!ok) return;

      setDirHandle(savedHandle);
      await loadBooks(savedHandle);
    } catch (e) {
      console.error(e);
      setError('无法恢复上次书库，请重新选择文件夹。');
    }
  }

  async function handlePickFolder() {
    setError('');
    try {
      const handle = await pickLibraryDirectory();
      const ok = await ensureReadPermission(handle);
      if (!ok) {
        setError('未获得文件夹读取权限。');
        return;
      }

      setDirHandle(handle);
      await loadBooks(handle);
    } catch (e) {
      if (e?.name !== 'AbortError') {
        console.error(e);
        setError('选择文件夹失败。');
      }
    }
  }

  async function loadBooks(handle) {
    setLoading(true);
    try {
      const txtFiles = await listTxtFiles(handle);
      setBooks(txtFiles);

      const lastBookName = localStorage.getItem(LS_LAST_BOOK);
      const target = txtFiles.find((f) => f.name === lastBookName) || txtFiles[0];

      if (target) {
        await openBook(target, false);
      } else {
        setSelectedBook(null);
        setChapters([]);
        setChapterIndex(0);
      }
    } finally {
      setLoading(false);
    }
  }

  async function openBook(fileHandle, closeDrawer = true) {
    setLoading(true);
    setError('');

    try {
      const data = await readTxtFile(fileHandle);
      const parsed = extractChapters(data.text);

      setSelectedBook(fileHandle);
      setEncoding(data.encoding);
      setChapters(parsed);

      localStorage.setItem(LS_LAST_BOOK, fileHandle.name);

      const savedChapterIndex = Number(
        localStorage.getItem(`${LS_LAST_CHAPTER}:${fileHandle.name}`) || 0
      );
      const safeIndex = Math.min(savedChapterIndex, Math.max(parsed.length - 1, 0));
      setChapterIndex(safeIndex);

      if (closeDrawer) {
        setBookshelfOpen(false);
        setTocOpen(false);
      }
    } catch (e) {
      console.error(e);
      setError(`读取文件失败：${fileHandle.name}`);
    } finally {
      setLoading(false);
    }
  }

  function goToChapter(index, closeDrawer = false) {
    setChapterIndex(index);
    if (selectedBook) {
      localStorage.setItem(`${LS_LAST_CHAPTER}:${selectedBook.name}`, String(index));
    }
    if (closeDrawer) {
      setTocOpen(false);
    }
  }

  function goPrevChapter() {
    if (chapterIndex > 0) {
      goToChapter(chapterIndex - 1);
    }
  }

  function goNextChapter() {
    if (chapterIndex < chapters.length - 1) {
      goToChapter(chapterIndex + 1);
    }
  }

  async function handleResetLibrary() {
    await clearSavedDirectoryHandle();
    setDirHandle(null);
    setBooks([]);
    setSelectedBook(null);
    setChapters([]);
    setChapterIndex(0);
    setEncoding('');
    setBookshelfOpen(false);
    setTocOpen(false);
  }

  function closeAllFloatingPanels() {
    setStyleOpen(false);
    setFontPanelOpen(false);
  }

  function toggleToc() {
    closeAllFloatingPanels();
    setBookshelfOpen(false);
    setTocOpen((v) => !v);
  }

  function toggleBookshelf() {
    closeAllFloatingPanels();
    setTocOpen(false);
    setBookshelfOpen((v) => !v);
  }

  function toggleStylePanel() {
    setTocOpen(false);
    setBookshelfOpen(false);
    setFontPanelOpen(false);
    setStyleOpen((v) => !v);
  }

  function toggleFontPanel() {
    setTocOpen(false);
    setBookshelfOpen(false);
    setStyleOpen(false);
    setFontPanelOpen((v) => !v);
  }

  const currentChapter = useMemo(() => chapters[chapterIndex], [chapters, chapterIndex]);
  const currentPageWidth = PAGE_WIDTH_OPTIONS[pageWidth] || PAGE_WIDTH_OPTIONS.medium;
  const currentLineHeight = LINE_HEIGHT_OPTIONS[lineHeightMode] || LINE_HEIGHT_OPTIONS.comfortable;

  if (!supported) {
    return (
      <div className="unsupported">
        <h1>当前浏览器不支持该读取方式</h1>
        <p>请使用最新版 Chrome 或 Edge。</p>
      </div>
    );
  }

  return (
    <div className="reader-shell">
      <header className="topbar">
        <div className="topbar-left">
          <div className="book-dot" />
          <div className="topbar-title">
            {selectedBook?.name?.replace(/\.txt$/i, '') || '未打开书籍'}
          </div>
          {selectedBook && <div className="topbar-sub">（全集）</div>}
        </div>

        <div className="topbar-right">
          <button className="topbar-link" onClick={handlePickFolder}>
            选择书库
          </button>
          <button className="topbar-link" onClick={() => setBookshelfOpen(true)}>
            我的书架
          </button>
        </div>
      </header>

      <main className="reader-main">
        <div
          ref={readerRef}
          className="reader-scroll"
          onClick={() => {
            closeAllFloatingPanels();
          }}
        >
          {error && <div className="status-text error-text">{error}</div>}
          {loading && <div className="status-text">加载中…</div>}

          {!selectedBook || !currentChapter ? (
            <div className="empty-state">
              <h2>还没有打开书籍</h2>
              <p>先选择一个 txt 文件夹，然后从书架打开文件。</p>
              <div className="empty-actions">
                <button onClick={handlePickFolder}>选择书库文件夹</button>
                <button className="secondary" onClick={() => setBookshelfOpen(true)}>
                  打开书架
                </button>
              </div>
            </div>
          ) : (
            <article
              className="chapter-view"
              style={{
                maxWidth: `${currentPageWidth}px`,
              }}
            >
              <div className="chapter-prev-wrap">
                <button
                  className="chapter-prev-link"
                  onClick={goPrevChapter}
                  disabled={chapterIndex <= 0}
                >
                  上一章
                </button>
              </div>

              <div className="chapter-title-block">
                <div className="chapter-title-accent" />
                <div className="chapter-title-texts">
                  <div className="chapter-number">
                    {currentChapter.displayNumber || currentChapter.title}
                  </div>

                  {currentChapter.displayTitle ? (
                    <div className="chapter-name">{currentChapter.displayTitle}</div>
                  ) : null}
                </div>
              </div>

              <div
                className="chapter-body"
                style={{
                  fontSize: `${fontSize}px`,
                  lineHeight: currentLineHeight,
                }}
              >
                <pre>{currentChapter.content}</pre>
              </div>

              <div className="chapter-next-wrap">
                <button
                  className="chapter-next-button"
                  onClick={goNextChapter}
                  disabled={chapterIndex >= chapters.length - 1}
                >
                  下一章
                </button>
              </div>
            </article>
          )}
        </div>
      </main>

      <div className="floating-actions">
        <button
          className={`fab ${tocOpen ? 'active' : ''}`}
          onClick={toggleToc}
          title="目录"
        >
          ≡
        </button>

        <button
          className={`fab ${bookshelfOpen ? 'active' : ''}`}
          onClick={toggleBookshelf}
          title="书库"
        >
          ▤
        </button>

        <button
          className={`fab ${styleOpen ? 'active' : ''}`}
          onClick={toggleStylePanel}
          title="样式"
        >
          ◐
        </button>

        <button
          className={`fab ${fontPanelOpen ? 'active' : ''}`}
          onClick={toggleFontPanel}
          title="字号"
        >
          A
        </button>
      </div>

      {(tocOpen || bookshelfOpen) && (
        <div
          className="drawer-backdrop"
          onClick={() => {
            setTocOpen(false);
            setBookshelfOpen(false);
          }}
        />
      )}

      <aside className={`right-drawer ${tocOpen ? 'open' : ''}`}>
        <div className="drawer-header">
          <div className="drawer-title">目录</div>
          <button className="drawer-close" onClick={() => setTocOpen(false)}>
            ×
          </button>
        </div>

        <div className="drawer-search-placeholder">章节列表</div>

        <div className="drawer-list">
          {chapters.map((chapter, index) => (
            <button
              key={`${chapter.title}-${index}`}
              ref={index === chapterIndex ? activeChapterButtonRef : null}
              className={`drawer-item ${index === chapterIndex ? 'active' : ''}`}
              onClick={() => goToChapter(index, true)}
            >
              {chapter.title}
            </button>
          ))}
          {!chapters.length && <div className="drawer-empty">当前没有可显示的目录</div>}
        </div>
      </aside>

      <aside className={`right-drawer ${bookshelfOpen ? 'open' : ''}`}>
        <div className="drawer-header">
          <div className="drawer-title">书库</div>
          <button className="drawer-close" onClick={() => setBookshelfOpen(false)}>
            ×
          </button>
        </div>

        <div className="drawer-toolbar">
          <button onClick={handlePickFolder}>选择书库文件夹</button>
          <button className="secondary" onClick={handleResetLibrary}>
            清空记忆书库
          </button>
        </div>

        <div className="drawer-meta">
          {dirHandle ? `已连接：${dirHandle.name}` : '尚未选择文件夹'}
          {encoding ? ` · 编码：${encoding}` : ''}
        </div>

        <div className="drawer-list">
          {books.map((book) => (
            <button
              key={book.name}
              className={`drawer-item ${selectedBook?.name === book.name ? 'active' : ''}`}
              onClick={() => openBook(book)}
              title={book.name}
            >
              {book.name.replace(/\.txt$/i, '')}
            </button>
          ))}
          {!books.length && <div className="drawer-empty">文件夹中还没有 txt 文件</div>}
        </div>
      </aside>

      {styleOpen && (
        <div className="floating-panel style-panel">
          <div className="floating-panel-title">样式</div>

          <div className="option-group">
            <div className="option-label">主题</div>
            <div className="segmented">
              <button
                className={theme === 'light' ? 'active' : ''}
                onClick={() => setTheme('light')}
              >
                浅色
              </button>
              <button
                className={theme === 'dark' ? 'active' : ''}
                onClick={() => setTheme('dark')}
              >
                深色
              </button>
            </div>
          </div>

          <div className="option-group">
            <div className="option-label">版心宽度</div>
            <div className="segmented">
              <button
                className={pageWidth === 'narrow' ? 'active' : ''}
                onClick={() => setPageWidth('narrow')}
              >
                窄
              </button>
              <button
                className={pageWidth === 'medium' ? 'active' : ''}
                onClick={() => setPageWidth('medium')}
              >
                中
              </button>
              <button
                className={pageWidth === 'wide' ? 'active' : ''}
                onClick={() => setPageWidth('wide')}
              >
                宽
              </button>
            </div>
          </div>

          <div className="option-group">
            <div className="option-label">行距</div>
            <div className="segmented">
              <button
                className={lineHeightMode === 'compact' ? 'active' : ''}
                onClick={() => setLineHeightMode('compact')}
              >
                紧凑
              </button>
              <button
                className={lineHeightMode === 'comfortable' ? 'active' : ''}
                onClick={() => setLineHeightMode('comfortable')}
              >
                舒适
              </button>
              <button
                className={lineHeightMode === 'loose' ? 'active' : ''}
                onClick={() => setLineHeightMode('loose')}
              >
                宽松
              </button>
            </div>
          </div>
        </div>
      )}

      {fontPanelOpen && (
        <div className="floating-panel font-panel">
          <div className="floating-panel-title">字号</div>
          <div className="font-size-value">{fontSize}px</div>
          <input
            type="range"
            min="16"
            max="34"
            value={fontSize}
            onChange={(e) => setFontSize(Number(e.target.value))}
          />
          <div className="font-size-scale">
            <span>小</span>
            <span>大</span>
          </div>
        </div>
      )}
    </div>
  );
}