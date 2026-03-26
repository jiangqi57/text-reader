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
const LS_BOOKMARKS = 'txt-reader-bookmarks';
const LS_HIGHLIGHTS = 'txt-reader-highlights-v2';

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
  const [viewMode, setViewMode] = useState('empty'); // empty | book-list | reader

  const [isNarrow, setIsNarrow] = useState(false); // 窗口是否窄屏，用于按钮布局

  const [bookSearch, setBookSearch] = useState('');

  const [showOnlyBookmarks, setShowOnlyBookmarks] = useState(false);

  const [bookmarks, setBookmarks] = useState(() => {
    try {
      const raw = localStorage.getItem(LS_BOOKMARKS);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });

  const [highlights, setHighlights] = useState(() => {
    try {
      const raw = localStorage.getItem(LS_HIGHLIGHTS);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  });

  const [highlightDraft, setHighlightDraft] = useState(null);
  const [highlightDraftNote, setHighlightDraftNote] = useState('');
  const [highlightJump, setHighlightJump] = useState(null);

  const readerRef = useRef(null);
  const activeChapterButtonRef = useRef(null);
  const chapterBodyRef = useRef(null);

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
    try {
      localStorage.setItem(LS_BOOKMARKS, JSON.stringify(bookmarks));
    } catch {
      // ignore
    }
  }, [bookmarks]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_HIGHLIGHTS, JSON.stringify(highlights));
    } catch {
      // ignore
    }
  }, [highlights]);

  useEffect(() => {
    if (!highlightDraft) {
      setHighlightDraftNote('');
    }
  }, [highlightDraft]);

  useEffect(() => {
    init();
  }, []);

  useEffect(() => {
    function handleResize() {
      if (typeof window !== 'undefined') {
        // 宽度小于 960（约占 MacBook Air 宽度的一半）视为窄屏
        setIsNarrow(window.innerWidth < 960);
      }
    }

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (readerRef.current) {
      readerRef.current.scrollTo({ top: 0, behavior: 'auto' });
    }
  }, [chapterIndex, selectedBook]);

  useEffect(() => {
    if (!highlightJump) return;
    if (highlightJump.chapterIndex !== chapterIndex) return;
    if (!readerRef.current || !chapterBodyRef.current) return;

    const para = chapterBodyRef.current.querySelector(
      `p[data-para-index="${highlightJump.paragraphIndex}"]`
    );
    if (!para) {
      setHighlightJump(null);
      return;
    }

    const containerRect = readerRef.current.getBoundingClientRect();
    const paraRect = para.getBoundingClientRect();
    const offset = paraRect.top - containerRect.top - 80;

    readerRef.current.scrollTo({
      top: readerRef.current.scrollTop + offset,
      behavior: 'smooth',
    });

    setHighlightJump(null);
  }, [highlightJump, chapterIndex]);

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
      await loadBooks(savedHandle, { autoOpenLast: true });
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
      await loadBooks(handle, { autoOpenLast: false });
    } catch (e) {
      if (e?.name !== 'AbortError') {
        console.error(e);
        setError('选择文件夹失败。');
      }
    }
  }

  async function loadBooks(handle, options = {}) {
    const { autoOpenLast = false } = options;
    setLoading(true);
    try {
      const txtFiles = await listTxtFiles(handle);
      setBooks(txtFiles);

      let opened = false;

      if (autoOpenLast) {
        const lastBookName = localStorage.getItem(LS_LAST_BOOK);
        if (lastBookName) {
          const target = txtFiles.find((f) => f.name === lastBookName);
          if (target) {
            await openBook(target, false);
            opened = true;
          }
        }
      }

      if (!opened) {
        setSelectedBook(null);
        setChapters([]);
        setChapterIndex(0);
        setEncoding('');
        setViewMode(txtFiles.length ? 'book-list' : 'empty');
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
      setViewMode('reader');

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
    setViewMode('empty');
  }

  function closeAllFloatingPanels() {
    setStyleOpen(false);
    setFontPanelOpen(false);
  }

  function toggleToc() {
    closeAllFloatingPanels();
    setBookshelfOpen(false);
    setShowOnlyBookmarks(false);
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

  const currentBookKey = selectedBook?.name || null;
  const currentBookBookmarks = useMemo(
    () => (currentBookKey && bookmarks[currentBookKey]) || [],
    [bookmarks, currentBookKey]
  );
  const isCurrentBookmarked =
    currentBookKey != null && currentBookBookmarks.includes(chapterIndex);

  const currentChapterHighlights = useMemo(() => {
    if (!currentBookKey) return {};
    const bookHighlights = highlights[currentBookKey] || {};
    const list = bookHighlights[chapterIndex] || [];
    if (!Array.isArray(list)) return {};

    const byParagraph = {};
    list.forEach((h) => {
      if (!h || typeof h !== 'object') return;
      const { paragraphIndex, start, end } = h;
      if (typeof paragraphIndex !== 'number') return;
      if (typeof start !== 'number' || typeof end !== 'number') return;
      if (!byParagraph[paragraphIndex]) byParagraph[paragraphIndex] = [];
      byParagraph[paragraphIndex].push({ start, end });
    });

    Object.values(byParagraph).forEach((arr) => {
      arr.sort((a, b) => a.start - b.start);
    });

    return byParagraph;
  }, [highlights, currentBookKey, chapterIndex]);

  const currentParagraphs = useMemo(() => {
    if (!currentChapter || !currentChapter.content) return [];
    return currentChapter.content.split(/\n+/);
  }, [currentChapter]);

  const filteredBooks = useMemo(() => {
    if (!bookSearch.trim()) return books;
    const keyword = bookSearch.trim().toLowerCase();
    return books.filter((book) => book.name.toLowerCase().includes(keyword));
  }, [books, bookSearch]);

  function toggleBookmarkForCurrentChapter() {
    if (!selectedBook || !chapters.length) return;
    const key = selectedBook.name;
    setBookmarks((prev) => {
      const prevList = prev[key] || [];
      let nextList;
      if (prevList.includes(chapterIndex)) {
        nextList = prevList.filter((i) => i !== chapterIndex);
      } else {
        nextList = [...prevList, chapterIndex].sort((a, b) => a - b);
      }
      return {
        ...prev,
        [key]: nextList,
      };
    });
  }

  function findParagraphElement(node) {
    let current = node;
    while (current && current !== chapterBodyRef.current) {
      if (
        current.nodeType === 1 &&
        current.tagName === 'P' &&
        current.classList.contains('chapter-paragraph')
      ) {
        return current;
      }
      current = current.parentNode;
    }
    return null;
  }

  function handleMouseUpInChapter() {
    if (!chapterBodyRef.current) return;
    if (!selectedBook || !chapters.length) return;

    const selection = window.getSelection ? window.getSelection() : null;
    if (!selection || selection.isCollapsed) return;

    const selectedText = selection.toString();
    if (!selectedText || !selectedText.trim()) return;

    if (selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    const { startContainer, endContainer } = range;

    if (
      !chapterBodyRef.current.contains(startContainer) ||
      !chapterBodyRef.current.contains(endContainer)
    ) {
      return;
    }

    const startParaEl = findParagraphElement(startContainer);
    const endParaEl = findParagraphElement(endContainer);
    if (!startParaEl || !endParaEl || startParaEl !== endParaEl) {
      // 暂时只支持在同一段内划线
      return;
    }

    const paraIndexAttr = startParaEl.getAttribute('data-para-index');
    if (paraIndexAttr == null) return;
    const paragraphIndex = Number(paraIndexAttr);
    if (Number.isNaN(paragraphIndex)) return;

    const paragraphText = startParaEl.textContent || '';
    const cleanSelected = selectedText.trim();
    const rawStart = paragraphText.indexOf(cleanSelected);
    if (rawStart === -1) return;
    const rawEnd = rawStart + cleanSelected.length;

    const key = selectedBook.name;
    const bookHighlights = highlights[key] || {};
    const prevList = bookHighlights[chapterIndex] || [];

    // 如果选中范围落在已有高亮内部，则视为编辑/查看该高亮
    let existingIndex = -1;
    for (let i = 0; i < prevList.length; i += 1) {
      const h = prevList[i];
      if (!h || typeof h !== 'object') continue;
      if (h.paragraphIndex !== paragraphIndex) continue;
      if (rawStart >= h.start && rawStart < h.end) {
        existingIndex = i;
        break;
      }
    }

    let start;
    let end;
    let displayText;
    let existing = null;

    if (existingIndex >= 0) {
      existing = prevList[existingIndex];
      start = existing.start;
      end = existing.end;
      displayText = paragraphText.slice(start, end);
    } else {
      start = rawStart;
      end = rawEnd;
      displayText = cleanSelected;
    }

    const rangeRect = range.getBoundingClientRect();
    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth || 0 : 0;
    const panelWidth = 320;
    let left = rangeRect.left + rangeRect.width / 2 - panelWidth / 2;
    if (viewportWidth) {
      left = Math.max(12, Math.min(left, viewportWidth - panelWidth - 12));
    }
    const top = rangeRect.bottom + 8;

    setHighlightDraft({
      bookKey: key,
      chapterIndex,
      paragraphIndex,
      start,
      end,
      text: displayText,
      existingIndex: existingIndex >= 0 ? existingIndex : null,
      panelLeft: left,
      panelTop: top,
    });
    setHighlightDraftNote((existing && existing.note) || '');

    selection.removeAllRanges();
  }

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
          {viewMode === 'reader' && (
            <button
              className="topbar-link"
              type="button"
              onClick={() => {
                setViewMode('book-list');
                closeAllFloatingPanels();
                setTocOpen(false);
                setBookshelfOpen(false);
              }}
            >
              返回书单
            </button>
          )}

          {isNarrow && (
            <div className="topbar-icon-group">
              <button
                className={`topbar-icon ${tocOpen ? 'active' : ''}`}
                type="button"
                onClick={toggleToc}
                title="目录"
              >
                ≡
              </button>
              <button
                className={`topbar-icon ${tocOpen && showOnlyBookmarks ? 'active' : ''}`}
                type="button"
                onClick={() => {
                  closeAllFloatingPanels();
                  setBookshelfOpen(false);
                  setShowOnlyBookmarks(true);
                  setTocOpen(true);
                }}
                title="书签"
              >
                ★
              </button>
              <button
                className={`topbar-icon ${styleOpen ? 'active' : ''}`}
                type="button"
                onClick={toggleStylePanel}
                title="样式"
              >
                ◐
              </button>
              <button
                className={`topbar-icon ${fontPanelOpen ? 'active' : ''}`}
                type="button"
                onClick={toggleFontPanel}
                title="字号"
              >
                A
              </button>
            </div>
          )}
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

          {viewMode === 'empty' && (
            <section className="empty-state ios-empty">
              <div className="ios-pill">TXT Reader</div>
              <h1 className="ios-title">开始阅读</h1>
              <p className="ios-sub">
                {dirHandle ? '当前书库暂无书籍' : '选择一个 txt 书库文件夹'}
              </p>

              <div className="ios-actions">
                <button className="ios-primary" onClick={handlePickFolder}>
                  选择书库
                </button>
              </div>
            </section>
          )}

          {viewMode === 'book-list' && (
            <section className="library-view">
              <div className="library-header">
                <div>
                  <div className="library-title">选择一本书开始阅读</div>
                  <div className="library-sub">
                    {dirHandle ? `当前书库：${dirHandle.name}` : '尚未选择文件夹'}
                    {books.length ? ` · 共 ${books.length} 本 TXT 书籍` : ''}
                  </div>
                </div>
                <div className="library-header-actions">
                  <button
                    className="library-action library-action-primary"
                    onClick={handlePickFolder}
                  >
                    更换书库
                  </button>
                  <button
                    type="button"
                    className="library-action library-action-secondary"
                    onClick={handleResetLibrary}
                  >
                    清空记忆
                  </button>
                </div>
              </div>

              {books.length ? (
                <>
                  <div className="library-search-row">
                    <input
                      className="library-search-input"
                      placeholder="搜索书名…"
                      value={bookSearch}
                      onChange={(e) => setBookSearch(e.target.value)}
                    />
                  </div>

                  <div className="library-list">
                    {filteredBooks.map((book) => (
                      <button
                        key={book.name}
                        className="library-book"
                        onClick={() => openBook(book)}
                        title={book.name}
                      >
                        <span className="library-book-name">
                          {book.name.replace(/\.txt$/i, '')}
                        </span>
                      </button>
                    ))}
                    {!filteredBooks.length && (
                      <div className="library-empty">没有匹配的书籍</div>
                    )}
                  </div>
                </>
              ) : (
                <div className="library-empty">文件夹中还没有 txt 文件</div>
              )}
            </section>
          )}

          {viewMode === 'reader' && selectedBook && currentChapter && (
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

                <button
                  className={`chapter-prev-link bookmark-toggle ${
                    isCurrentBookmarked ? 'active' : ''
                  }`}
                  type="button"
                  onClick={toggleBookmarkForCurrentChapter}
                >
                  {isCurrentBookmarked ? '★' : '☆'}
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
                ref={chapterBodyRef}
                onMouseUp={handleMouseUpInChapter}
                style={{
                  fontSize: `${fontSize}px`,
                  lineHeight: currentLineHeight,
                }}
              >
                {currentParagraphs.length ? (
                  currentParagraphs.map((para, idx) => {
                    const text = (para || '').replace(/\s+$/, '');
                    const ranges = currentChapterHighlights[idx] || [];

                    if (!text) {
                      return (
                        <p
                          key={idx}
                          data-para-index={idx}
                          className="chapter-paragraph empty-line"
                        >
                          \u00a0
                        </p>
                      );
                    }

                    if (!ranges.length) {
                      return (
                        <p
                          key={idx}
                          data-para-index={idx}
                          className="chapter-paragraph"
                        >
                          {text}
                        </p>
                      );
                    }

                    const parts = [];
                    let cursor = 0;
                    const len = text.length;

                    ranges.forEach(({ start, end }, i) => {
                      const safeStart = Math.max(0, Math.min(start, len));
                      const safeEnd = Math.max(safeStart, Math.min(end, len));

                      if (safeStart > cursor) {
                        parts.push({
                          key: `t-${i}-${cursor}`,
                          text: text.slice(cursor, safeStart),
                          highlighted: false,
                        });
                      }

                      if (safeEnd > safeStart) {
                        parts.push({
                          key: `h-${i}-${safeStart}`,
                          text: text.slice(safeStart, safeEnd),
                          highlighted: true,
                        });
                      }

                      cursor = safeEnd;
                    });

                    if (cursor < len) {
                      parts.push({
                        key: `t-end-${cursor}`,
                        text: text.slice(cursor),
                        highlighted: false,
                      });
                    }

                    return (
                      <p
                        key={idx}
                        data-para-index={idx}
                        className="chapter-paragraph"
                      >
                        {parts.map((part) =>
                          part.highlighted ? (
                            <span
                              key={part.key}
                              className="chapter-highlight-span"
                            >
                              {part.text}
                            </span>
                          ) : (
                            <span key={part.key}>{part.text}</span>
                          )
                        )}
                      </p>
                    );
                  })
                ) : (
                  <pre>{currentChapter.content}</pre>
                )}
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

      {highlightDraft && (
        <div
          className="highlight-popover"
          style={{ top: highlightDraft.panelTop, left: highlightDraft.panelLeft }}
        >
          <div className="highlight-popover-header">添加划线和笔记</div>
          <div className="highlight-popover-text">
            {`“${highlightDraft.text}”`}
          </div>
          <textarea
            className="highlight-popover-textarea"
            value={highlightDraftNote}
            onChange={(e) => setHighlightDraftNote(e.target.value)}
            placeholder="写一点你的想法…"
            rows={3}
          />
          <div className="highlight-popover-actions">
            {highlightDraft.existingIndex != null && highlightDraft.existingIndex >= 0 && (
              <button
                type="button"
                className="highlight-popover-button danger"
                onClick={() => {
                  const {
                    bookKey,
                    chapterIndex: draftChapterIndex,
                    existingIndex,
                  } = highlightDraft;
                  setHighlights((prev) => {
                    const byBook = prev[bookKey] || {};
                    const list = byBook[draftChapterIndex] || [];
                    if (
                      existingIndex == null ||
                      existingIndex < 0 ||
                      existingIndex >= list.length
                    ) {
                      return prev;
                    }
                    const nextList = list.slice();
                    nextList.splice(existingIndex, 1);
                    return {
                      ...prev,
                      [bookKey]: {
                        ...byBook,
                        [draftChapterIndex]: nextList,
                      },
                    };
                  });
                  setHighlightDraft(null);
                }}
              >
                删除高亮
              </button>
            )}
            <div className="highlight-popover-spacer" />
            <button
              type="button"
              className="highlight-popover-button secondary"
              onClick={() => setHighlightDraft(null)}
            >
              取消
            </button>
            <button
              type="button"
              className="highlight-popover-button primary"
              onClick={() => {
                const {
                  bookKey,
                  chapterIndex: draftChapterIndex,
                  paragraphIndex,
                  start,
                  end,
                  existingIndex,
                } = highlightDraft;
                const note = highlightDraftNote.trim();
                setHighlights((prev) => {
                  const byBook = prev[bookKey] || {};
                  const list = byBook[draftChapterIndex] || [];
                  const record = { paragraphIndex, start, end, note };
                  let nextList;
                  if (
                    existingIndex != null &&
                    existingIndex >= 0 &&
                    existingIndex < list.length
                  ) {
                    nextList = list.slice();
                    nextList[existingIndex] = { ...list[existingIndex], ...record };
                  } else {
                    nextList = [...list, record];
                  }
                  nextList.sort((a, b) => a.start - b.start);
                  return {
                    ...prev,
                    [bookKey]: {
                      ...byBook,
                      [draftChapterIndex]: nextList,
                    },
                  };
                });
                setHighlightDraft(null);
              }}
            >
              保存
            </button>
          </div>
        </div>
      )}

      {!isNarrow && viewMode === 'reader' && (
        <div
          className="floating-actions"
          style={{ right: `max(16px, calc((100vw - ${currentPageWidth}px) / 2 - 70px))` }}
        >
          <button
            className={`fab ${tocOpen ? 'active' : ''}`}
            onClick={toggleToc}
            title="目录"
          >
            ≡
          </button>

          <button
            className={`fab ${tocOpen && showOnlyBookmarks ? 'active' : ''}`}
            type="button"
            onClick={() => {
              closeAllFloatingPanels();
              setBookshelfOpen(false);
              setShowOnlyBookmarks(true);
              setTocOpen(true);
            }}
            title="书签"
          >
            ★
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
      )}

      {(tocOpen || bookshelfOpen) && (
        <div
          className="drawer-backdrop"
          onClick={() => {
            setTocOpen(false);
            setBookshelfOpen(false);
            setShowOnlyBookmarks(false);
          }}
        />
      )}

      <aside className={`right-drawer ${tocOpen ? 'open' : ''}`}>
        <div className="drawer-header">
          <div className="drawer-title">{showOnlyBookmarks ? '书签' : '目录'}</div>
          <button className="drawer-close" onClick={() => setTocOpen(false)}>
            ×
          </button>
        </div>

        <div className="drawer-search-placeholder">章节列表</div>

        <div className="drawer-list">
          {chapters.map((chapter, index) => (
            (() => {
              const isBookmarked =
                currentBookKey && currentBookBookmarks.includes(index);
              const bookHighlights =
                currentBookKey && highlights[currentBookKey]
                  ? highlights[currentBookKey][index] || []
                  : [];

              if (!showOnlyBookmarks) {
                return (
            <button
              key={`${chapter.title}-${index}`}
              ref={index === chapterIndex ? activeChapterButtonRef : null}
              className={`drawer-item ${index === chapterIndex ? 'active' : ''} ${
                isBookmarked ? 'bookmarked' : ''
              }`}
              onClick={() => goToChapter(index, true)}
            >
              <span className="drawer-item-text-group">
                <span className="drawer-item-text">{chapter.title}</span>
              </span>
              {isBookmarked && (
                <span className="drawer-bookmark-indicator">★</span>
              )}
            </button>
                );
              }

              const hasHighlights = Array.isArray(bookHighlights) && bookHighlights.length > 0;
              if (!isBookmarked && !hasHighlights) return null;

              const items = [];

              if (isBookmarked) {
                items.push(
            <button
              key={`${chapter.title}-${index}-chapter`}
              ref={index === chapterIndex ? activeChapterButtonRef : null}
              className={`drawer-item chapter-bookmark ${
                index === chapterIndex ? 'active' : ''
              } booked`}
              onClick={() => goToChapter(index, true)}
            >
              <span className="drawer-item-text-group">
                <span className="drawer-item-text">{chapter.title}</span>
              </span>
              <span className="drawer-bookmark-indicator">★</span>
            </button>
                );
              }

              if (hasHighlights) {
                const paragraphs = (chapter.content || '').split(/\n+/);
                bookHighlights.forEach((h, hi) => {
                  if (!h || typeof h !== 'object') return;
                  const { paragraphIndex, start, end, note } = h;
                  const paraText = paragraphs[paragraphIndex] || '';
                  const len = paraText.length;
                  const safeStart = Math.max(0, Math.min(start ?? 0, len));
                  const safeEnd = Math.max(safeStart, Math.min(end ?? len, len));
                  if (safeEnd <= safeStart) return;
                  const rawSnippet = paraText.slice(safeStart, safeEnd).trim();
                  if (!rawSnippet) return;
                  const snippet =
                    rawSnippet.length > 40 ? `${rawSnippet.slice(0, 40)}…` : rawSnippet;
                  const notePreview = note && note.trim()
                    ? note.trim().length > 40
                      ? `${note.trim().slice(0, 40)}…`
                      : note.trim()
                    : '';

                  items.push(
            <button
              key={`${chapter.title}-${index}-h-${hi}`}
              className="drawer-item highlight-item"
              onClick={() => {
                setHighlightJump({
                  chapterIndex: index,
                  paragraphIndex,
                });
                goToChapter(index, true);
              }}
            >
              <span className="drawer-item-text-group">
                <span className="drawer-item-text">{snippet}</span>
                {notePreview && (
                  <span className="drawer-item-note">{notePreview}</span>
                )}
              </span>
            </button>
                  );
                });
              }

              if (!items.length) return null;

              return (
            <div key={`group-${chapter.title}-${index}`}>{items}</div>
              );
            })()
          ))}
          {showOnlyBookmarks && (!currentBookKey || !chapters.length) && (
            <div className="drawer-empty">当前没有书签或笔记</div>
          )}
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
              <button
                className={theme === 'eye-care' ? 'active' : ''}
                onClick={() => setTheme('eye-care')}
              >
                护眼
              </button>
            </div>

            <div className="segmented" style={{ marginTop: 8 }}>
              <button
                className={theme === 'parchment' ? 'active' : ''}
                onClick={() => setTheme('parchment')}
              >
                羊皮纸
              </button>
              <button
                className={theme === 'black' ? 'active' : ''}
                onClick={() => setTheme('black')}
              >
                纯黑
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