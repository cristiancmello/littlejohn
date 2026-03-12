import { useState, useRef, useEffect, useCallback } from "react";

const FONT_URL = "https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;1,400&family=JetBrains+Mono:wght@400;500&family=Lora:ital,wght@0,400;1,400&display=swap";

// ── Tipos semânticos da linguagem ────────────────────────────────────────────
// action  >    Ação ou comportamento (imperativo)
// implied =>   Ação obrigatoriamente implicada pela anterior
// concept -    Decomposição hierárquica (do composto ao simples)
// lateral -->  Associação lateral a outra ação (cria stub se não existe)
// comment      Texto livre explicativo (último elemento do tópico)
// ─────────────────────────────────────────────────────────────────────────────

const SYM = {
  action:  '>',
  implied: '=>',
  concept: '—',
  lateral: '→',
  comment: '//',
};

const CLR = {
  action:  '#a07840',
  implied: '#7a5a9a',
  concept: '#aaa098',
  lateral: '#4a9080',
  comment: '#c8c0b4',
};

// ── Utilitários de árvore ─────────────────────────────────────────────────────
let _uid = 100;
const uid = () => `nd${++_uid}`;

const mk = (type, text = '', extra = {}) => ({
  id: uid(), type, text, expanded: true,
  children: [], media: [], stub: false,
  impliedBy: null, targetId: null,
  ...extra,
});

const updateTree = (nodes, id, fn) =>
  nodes.map(n => n.id === id ? fn(n) : { ...n, children: updateTree(n.children, id, fn) });

const findNode = (nodes, id) => {
  for (const n of nodes) {
    if (n.id === id) return n;
    const f = findNode(n.children, id);
    if (f) return f;
  }
  return null;
};

const addChild = (nodes, parentId, child) =>
  updateTree(nodes, parentId, n => ({ ...n, expanded: true, stub: false, children: [...n.children, child] }));

const addAfterRoot = (nodes, targetId, child) => {
  const i = nodes.findIndex(n => n.id === targetId);
  if (i === -1) return nodes;
  const r = [...nodes];
  r.splice(i + 1, 0, child);
  return r;
};

const removeNode = (nodes, id) =>
  nodes.filter(n => n.id !== id).map(n => ({ ...n, children: removeNode(n.children, id) }));

// Move a child up or down within its parent's children list
function moveChild(nodes, id, dir) {
  // Try at this level first
  const idx = nodes.findIndex(n => n.id === id);
  if (idx !== -1) {
    const next = [...nodes];
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= next.length) return nodes;
    [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
    return next;
  }
  return nodes.map(n => {
    const moved = moveChild(n.children, id, dir);
    if (moved === n.children) return n;
    return { ...n, children: moved };
  });
}

const flatAll = (nodes, depth = 0) =>
  nodes.flatMap(n => [{ ...n, depth }, ...flatAll(n.children, depth + 1)]);

const collectMedia = (nodes) =>
  flatAll(nodes).flatMap(n => n.media.map(m => ({ ...m, nodeId: n.id, nodeText: n.text })));

// ── Rich text renderer ────────────────────────────────────────────────────────
function renderText(text) {
  if (!text) return null;
  const lines = text.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].trimStart().startsWith('```')) {
      const lang = lines[i].trim().slice(3).trim();
      const block = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) { block.push(lines[i]); i++; }
      i++;
      out.push(
        <div key={`bl${i}`} className="code-block">
          {lang && <span className="code-lang">{lang}</span>}
          <pre>{block.join('\n')}</pre>
        </div>
      );
    } else {
      const parts = lines[i].split(/(`[^`]+`)/g);
      const line = parts.map((p, j) =>
        p.startsWith('`') && p.endsWith('`') && p.length > 2
          ? <code key={j} className="inline-code">{p.slice(1, -1)}</code>
          : p
      );
      out.push(<span key={`ln${i}`}>{line}</span>);
      if (i < lines.length - 1) out.push(<br key={`br${i}`} />);
      i++;
    }
  }
  return out;
}

// ── Dados iniciais ────────────────────────────────────────────────────────────
const INITIAL = [];

// ── NoteItem ──────────────────────────────────────────────────────────────────
function NoteItem({ node, depth, siblings, rootNodes, selected, focusId, handlers }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(node.text);
  const [hovered, setHovered] = useState(false);
  const ref = useRef();
  const isSelected = selected === node.id;
  const isActionLike = node.type === 'action' || node.type === 'implied';
  const hasToggle = isActionLike || node.type === 'concept';

  useEffect(() => {
    if (focusId === node.id) { setDraft(''); setEditing(true); }
  }, [focusId, node.id]);

  useEffect(() => {
    if (editing && ref.current) {
      ref.current.focus();
      autoResize(ref.current);
      const len = ref.current.value.length;
      ref.current.setSelectionRange(len, len);
    }
  }, [editing]);

  const autoResize = el => { if (!el) return; el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; };

  const commit = (text = draft) => {
    const trimmed = text.trim();
    if (trimmed) handlers.onEdit(node.id, trimmed, node.type);
    setEditing(false);
  };

  const handleKey = e => {
    if (e.key === 'Escape') {
      if (!draft.trim()) handlers.onDelete(node.id);
      else commit();
    }
  };

  // Find implier action text for implied nodes
  const implierNode = node.impliedBy ? findNode(rootNodes, node.impliedBy) : null;
  // Find all nodes this action has implied
  const impliedNodes = flatAll(rootNodes).filter(n => n.impliedBy === node.id);

  // Siblings context for move up/down (concepts only)
  const conceptSiblings = (siblings || []).filter(s => s.type === 'concept');
  const conceptIdx = conceptSiblings.findIndex(s => s.id === node.id);
  const canMoveUp   = node.type === 'concept' && conceptIdx > 0;
  const canMoveDown = node.type === 'concept' && conceptIdx < conceptSiblings.length - 1;
  // Find target node for lateral refs
  const targetNode = node.targetId ? findNode(rootNodes, node.targetId) : null;

  return (
    <div style={{ marginLeft: depth * 22 }}>
      <div
        className={`node node-${node.type}${isSelected ? ' selected' : ''}${node.stub ? ' stub' : ''}${editing ? ' editing' : ''}`}
        onClick={() => handlers.onSelect(node.id)}
        onDoubleClick={() => { setDraft(node.text); setEditing(true); }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* Row: toggle + symbol + text/input + badges */}
        <div className="node-row">
          {hasToggle ? (
            <button className="toggle-btn"
              style={{ opacity: node.children.length ? 1 : 0.12 }}
              onClick={e => { e.stopPropagation(); handlers.onToggle(node.id); }}>
              <span style={{ transform: node.expanded ? 'rotate(90deg)' : 'rotate(0)', display: 'inline-block', transition: 'transform .18s' }}>›</span>
            </button>
          ) : <span className="toggle-spacer" />}

          <span className={`sym sym-${node.type}`}>{SYM[node.type]}</span>

          {editing ? (
            <textarea
              ref={ref}
              className="node-input"
              value={draft}
              placeholder={placeholders[node.type]}
              rows={1}
              onChange={e => { setDraft(e.target.value); autoResize(e.target); }}
              onBlur={() => commit()}
              onKeyDown={handleKey}
              onClick={e => e.stopPropagation()}
            />
          ) : (
            <span className={`node-text node-text-${node.type}`}>
              {node.text ? renderText(node.text) : <em className="placeholder">…</em>}
            </span>
          )}

          {/* Badges */}
          {node.stub && !editing && <span className="badge badge-stub">stub</span>}
          {node.type === 'implied' && implierNode && !editing && (
            <span className="badge badge-implied" title={`Implicada por: ${implierNode.text}`}>
              ← {implierNode.text.split(' ').slice(0, 3).join(' ')}…
            </span>
          )}

          {node.media?.length > 0 && !editing && (
            <span className="badge badge-media">{node.media.length}</span>
          )}

          {/* Hover actions */}
          {!editing && (hovered || isSelected) && (
            <div className="node-actions" onClick={e => e.stopPropagation()}>
              {isActionLike && (
                <>
                  <button className="act act-concept" title="Adicionar conceito (—)"
                    onClick={() => handlers.onAddChild(node.id, 'concept')}
                    disabled={node.children.some(c => c.type === 'lateral')}>— conceito</button>
                  <button className="act act-lateral" title="Adicionar relação lateral (→)"
                    onClick={() => handlers.onAddChild(node.id, 'lateral')}
                    disabled={impliedNodes.length > 0}>→ relação</button>
                  <button className="act act-comment" title="Adicionar nota (//)"
                    onClick={() => handlers.onAddChild(node.id, 'comment')}>
                    // nota
                  </button>
                  <button className="act act-imply" title="Implicar ação obrigatória em sequência (=>)"
                    onClick={() => handlers.onImply(node.id)}
                    disabled={node.children.some(c => c.type === 'lateral')}>⟹ implicar</button>
                  <button className="act act-del" title="Deletar"
                    onClick={() => handlers.onDelete(node.id)}>×</button>
                </>
              )}
              {node.type === 'concept' && (
                <>
                  <button className="act act-move" title="Mover para cima" disabled={!canMoveUp}
                    onClick={() => handlers.onMove(node.id, -1)}>↑</button>
                  <button className="act act-move" title="Mover para baixo" disabled={!canMoveDown}
                    onClick={() => handlers.onMove(node.id, 1)}>↓</button>
                  <button className="act act-del" title="Deletar"
                    onClick={() => handlers.onDelete(node.id)}>×</button>
                </>
              )}
              {(node.type === 'comment' || node.type === 'lateral') && (
                <button className="act act-del" title="Deletar"
                  onClick={() => handlers.onDelete(node.id)}>×</button>
              )}
            </div>
          )}
        </div>

        {/* Lateral target link */}
        {node.type === 'lateral' && !editing && (
          <div className="lateral-link" onClick={e => { e.stopPropagation(); if (targetNode) handlers.onSelect(targetNode.id); }}>
            <span className="lateral-arrow">⟶</span>
            <span className={`lateral-target${targetNode?.stub ? ' lateral-stub' : ''}`}>
              {targetNode ? targetNode.text : node.text}
            </span>
            {targetNode?.stub && <span className="badge badge-stub">a definir</span>}
          </div>
        )}
      </div>

      {/* Children */}
      {hasToggle && node.expanded && node.children.length > 0 && (
        <div className="children">
          {node.children.map(child => (
            <NoteItem key={child.id} node={child} depth={depth + 1}
              siblings={node.children}
              rootNodes={rootNodes} selected={selected} focusId={focusId}
              handlers={handlers} />
          ))}
        </div>
      )}

      {/* Implied forward references — shown as sub-items */}
      {node.expanded && impliedNodes.length > 0 && (
        <div className="children">
          {impliedNodes.map(imp => (
            <div
              key={imp.id}
              className={`node node-implies-ref${selected === imp.id ? ' selected' : ''}`}
              style={{ marginLeft: 22 }}
              onClick={e => { e.stopPropagation(); handlers.onSelect(imp.id); }}
            >
              <div className="node-row">
                <span className="toggle-spacer" />
                <span className="sym sym-implied">⟹</span>
                <span className="node-text node-text-implies-ref">
                  {imp.text || <em className="placeholder">…</em>}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const placeholders = {
  action:  'Ação ou comportamento (imperativo)…',
  implied: 'Ação implicada…',
  concept: 'Conceito abstraído…',
  lateral: 'Ação referenciada…',
  comment: 'Comentário livre…',
};

// ── MediaCard ─────────────────────────────────────────────────────────────────
function MediaCard({ item, active }) {
  return (
    <div className={`media-card${active ? ' active' : ''}`}>
      {item.type === 'image' ? (
        <>
          <div className="media-img-wrap"><img src={item.url} alt={item.caption} loading="lazy" /></div>
          <div className="media-caption">
            <span className="caption-dot" />{item.caption}
            <span className="note-ref">← {item.nodeText}</span>
          </div>
        </>
      ) : (
        <div className="media-doc">
          <div className="doc-header">
            <span className="doc-icon">⌨</span>
            <span className="doc-title">{item.title}</span>
            <span className="note-ref">← {item.nodeText}</span>
          </div>
          <pre className="doc-preview">{item.preview}</pre>
        </div>
      )}
    </div>
  );
}

// ── Export ────────────────────────────────────────────────────────────────────
function exportNodes(nodes) {
  const lines = [];
  for (const node of nodes) {
    if (node.type === 'action' || node.type === 'implied') {
      if (lines.length > 0) lines.push('');
      const prefix = node.type === 'implied' ? '=>' : '>';
      lines.push(`${prefix} ${node.text}`);
      for (const child of node.children) {
        if (child.type === 'concept')  lines.push(`— ${child.text}`);
        if (child.type === 'lateral')  lines.push(`→ ${child.text}`);
        if (child.type === 'comment')  lines.push(`// ${child.text}`);
      }
    }
  }
  return lines.join('\n');
}

// ── Import ────────────────────────────────────────────────────────────────────
function importNodes(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const roots = [];
  let current = null; // current action node

  for (const line of lines) {
    if (line.startsWith('=> ') || line.startsWith('=>\t')) {
      const node = mk('implied', line.slice(3).trim(), { impliedBy: current?.id || null });
      roots.push(node);
      current = node;
    } else if (line.startsWith('> ') || line.startsWith('>\t')) {
      const node = mk('action', line.slice(2).trim());
      roots.push(node);
      current = node;
    } else if (line.startsWith('— ') || line.startsWith('—\t') || line.startsWith('- ')) {
      const text = line.replace(/^—\s*|-\s*/, '').trim();
      if (current) current.children.push(mk('concept', text));
    } else if (line.startsWith('→ ') || line.startsWith('→\t') || line.startsWith('--> ')) {
      const text = line.replace(/^→\s*|-->\s*/, '').trim();
      if (current) current.children.push(mk('lateral', text));
    } else if (line.startsWith('// ') || line.startsWith('//\t') || line.startsWith('//')) {
      const text = line.replace(/^\/\/\s*/, '').trim();
      if (current) current.children.push(mk('comment', text));
    }
  }
  return roots;
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [nodes, setNodes] = useState(INITIAL);
  const [selected, setSelected] = useState(null);
  const [focusId, setFocusId] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const rightRef = useRef();
  const cardRefs = useRef({});

  const handleExport = () => {
    const text = exportNodes(nodes);
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'analise.txt'; a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    const imported = importNodes(importText);
    if (imported.length > 0) { setNodes(imported); setSelected(null); }
    setImportOpen(false);
    setImportText('');
  };

  const allMedia = collectMedia(nodes);
  const focus = useCallback((id) => { setSelected(id); setFocusId(id); }, []);

  // ── Mutations ──
  const onToggle = useCallback(id =>
    setNodes(p => updateTree(p, id, n => ({ ...n, expanded: !n.expanded }))), []);

  const onSelect = useCallback(id => setSelected(id), []);

  const onEdit = useCallback((id, text, type) => {
    setNodes(p => {
      let next = updateTree(p, id, n => ({ ...n, text, stub: false }));
      // When committing a lateral ref, find or create the target action
      if (type === 'lateral') {
        const lateralNode = findNode(next, id);
        if (lateralNode && !lateralNode.targetId) {
          const existing = next.find(n =>
            (n.type === 'action' || n.type === 'implied') &&
            n.text.toLowerCase().includes(text.toLowerCase().slice(0, 10))
          );
          if (existing) {
            next = updateTree(next, id, n => ({ ...n, targetId: existing.id }));
          } else {
            const stub = mk('action', text, { stub: true });
            next = updateTree(next, id, n => ({ ...n, targetId: stub.id }));
            next = [...next, stub];
          }
        }
      }
      return next;
    });
  }, []);

  const onDelete = useCallback(id => {
    setNodes(p => removeNode(p, id));
    setSelected(s => s === id ? null : s);
  }, []);

  const onMove = useCallback((id, dir) => {
    setNodes(p => moveChild(p, id, dir));
  }, []);

  const onAddChild = useCallback((parentId, type) => {
    // For comment: insert last; for others: insert before existing comment if any
    const child = mk(type);
    setNodes(p => {
      const parent = findNode(p, parentId);
      if (!parent) return p;
      // insert before comment if it exists (comment must stay last)
      const commentIdx = parent.children.findIndex(c => c.type === 'comment');
      if (commentIdx !== -1 && type !== 'comment') {
        return updateTree(p, parentId, n => {
          const ch = [...n.children];
          ch.splice(commentIdx, 0, child);
          return { ...n, expanded: true, stub: false, children: ch };
        });
      }
      return addChild(p, parentId, child);
    });
    focus(child.id);
  }, [focus]);

  const onImply = useCallback(sourceId => {
    const implied = mk('implied', '', { impliedBy: sourceId });
    setNodes(p => addAfterRoot(p, sourceId, implied));
    focus(implied.id);
  }, [focus]);

  const onAddAction = useCallback(() => {
    const action = mk('action');
    setNodes(p => [...p, action]);
    focus(action.id);
  }, [focus]);

  useEffect(() => {
    if (focusId) { const t = setTimeout(() => setFocusId(null), 80); return () => clearTimeout(t); }
  }, [focusId]);

  useEffect(() => {
    const first = allMedia.find(m => m.nodeId === selected);
    if (!first) return;
    const key = `${first.nodeId}-${first.type}-${first.title || first.url}`;
    cardRefs.current[key]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [selected]);

  const handlers = { onToggle, onSelect, onEdit, onDelete, onAddChild, onImply, onMove };
  const getKey = m => `${m.nodeId}-${m.type}-${m.title || m.url}`;

  return (
    <>
      <style>{`
        @import url('${FONT_URL}');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        :root {
          --bg: #f7f4ef; --surface: #ffffff; --border: #e0d9d0;
          --accent: #a07840; --accent2: #4a9080; --purple: #7a5a9a;
          --text: #2a2420; --muted: #8a8078; --dim: #bab0a4;
          --radius: 5px;
        }
        body { background: var(--bg); color: var(--text); font-family: 'Lora', serif; }
        .app { display: flex; flex: 1; overflow: hidden; }

        /* ── Toolbar ── */
        .toolbar {
          display: flex; align-items: center; gap: 8px;
          padding: 9px 18px;
          border-bottom: 1px solid var(--border);
          background: var(--surface);
          position: relative; z-index: 10;
        }
        .toolbar-title { font-family: 'Playfair Display', serif; font-size: 14px; font-weight: 600; color: var(--text); flex: 1; letter-spacing: .02em; }
        .toolbar-btn {
          display: flex; align-items: center; gap: 5px;
          background: none; border: 1px solid var(--border);
          color: var(--muted); font-family: 'JetBrains Mono', monospace; font-size: 10px;
          border-radius: var(--radius); padding: 5px 12px; cursor: pointer;
          transition: background .15s, border-color .15s, color .15s;
        }
        .toolbar-btn:hover { background: rgba(0,0,0,.04); border-color: var(--muted); color: var(--text); }
        .toolbar-btn.primary { background: rgba(160,120,64,.08); border-color: rgba(160,120,64,.25); color: var(--accent); }
        .toolbar-btn.primary:hover { background: rgba(160,120,64,.15); border-color: var(--accent); }

        /* ── Import modal ── */
        .modal-overlay {
          position: fixed; inset: 0; background: rgba(40,35,30,.35);
          display: flex; align-items: center; justify-content: center;
          z-index: 100; backdrop-filter: blur(2px);
        }
        .modal {
          background: var(--surface); border: 1px solid var(--border);
          border-radius: 10px; padding: 24px; width: 540px; max-width: 92vw;
          box-shadow: 0 12px 40px rgba(0,0,0,.15);
          display: flex; flex-direction: column; gap: 14px;
        }
        .modal-title { font-family: 'Playfair Display', serif; font-size: 16px; font-weight: 600; color: var(--text); }
        .modal-hint { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; color: var(--muted); line-height: 1.7; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 10px 14px; }
        .modal-textarea {
          font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--text);
          background: var(--bg); border: 1px solid var(--border); border-radius: 6px;
          padding: 10px 14px; resize: vertical; min-height: 180px; outline: none;
          line-height: 1.65;
        }
        .modal-textarea:focus { border-color: var(--accent); }
        .modal-actions { display: flex; justify-content: flex-end; gap: 8px; }
        .modal-cancel { background: none; border: 1px solid var(--border); color: var(--muted); font-family: 'JetBrains Mono', monospace; font-size: 11px; border-radius: var(--radius); padding: 6px 14px; cursor: pointer; transition: background .12s; }
        .modal-cancel:hover { background: rgba(0,0,0,.04); }
        .modal-confirm { background: rgba(160,120,64,.1); border: 1px solid rgba(160,120,64,.3); color: var(--accent); font-family: 'JetBrains Mono', monospace; font-size: 11px; border-radius: var(--radius); padding: 6px 14px; cursor: pointer; transition: background .12s; }
        .modal-confirm:hover { background: rgba(160,120,64,.2); }
        .left { width: 46%; min-width: 340px; display: flex; flex-direction: column; border-right: 1px solid var(--border); background: var(--surface); }
        .panel-head { padding: 16px 18px 12px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 10px; }
        .panel-title { font-family: 'Playfair Display', serif; font-size: 16px; font-weight: 600; color: var(--text); flex: 1; }

        .btn-new-action {
          display: flex; align-items: center; gap: 5px;
          background: rgba(160,120,64,.08); border: 1px solid rgba(160,120,64,.2);
          color: var(--accent); font-family: 'JetBrains Mono', monospace; font-size: 10px;
          border-radius: var(--radius); padding: 4px 10px; cursor: pointer;
          transition: background .15s, border-color .15s;
        }
        .btn-new-action:hover { background: rgba(160,120,64,.15); border-color: var(--accent); }

        .nodes-scroll { flex: 1; overflow-y: auto; padding: 10px 10px 50px; scrollbar-width: thin; scrollbar-color: var(--border) transparent; }

        /* Legend bar */
        .legend { padding: 8px 16px; border-top: 1px solid var(--border); display: flex; gap: 16px; flex-wrap: wrap; }
        .leg-item { display: flex; align-items: center; gap: 5px; font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--muted); }
        .leg-sym { font-size: 10px; font-weight: 600; }

        /* ── Nodes ── */
        .node {
          border-radius: var(--radius);
          border-left: 2px solid transparent;
          cursor: pointer;
          transition: background .12s, border-color .12s;
          padding: 2px 6px 2px 2px;
          margin-bottom: 1px;
        }
        .node:hover { background: rgba(0,0,0,.02); }
        .node.selected { border-left-color: var(--accent); background: rgba(160,120,64,.05); }
        .node.stub { opacity: .55; }
        .node.editing { background: rgba(160,120,64,.04); border-left-color: var(--accent); cursor: default; }

        /* Per-type left border on selected */
        .node-implied.selected { border-left-color: var(--purple); background: rgba(122,90,154,.04); }
        .node-lateral.selected { border-left-color: var(--accent2); background: rgba(74,144,128,.04); }
        .node-comment.selected { border-left-color: var(--dim); }

        .node-row { display: flex; align-items: flex-start; gap: 5px; min-height: 28px; }

        .toggle-btn { background: none; border: none; cursor: pointer; color: var(--muted); font-size: 13px; width: 14px; height: 20px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; padding: 0; margin-top: 2px; transition: color .15s; }
        .toggle-btn:hover { color: var(--accent); }
        .toggle-spacer { width: 14px; flex-shrink: 0; }

        /* Symbols */
        .sym { font-family: 'JetBrains Mono', monospace; font-size: 13px; font-weight: 600; flex-shrink: 0; padding-top: 3px; line-height: 1; min-width: 24px; }
        .sym-action  { color: ${CLR.action};  }
        .sym-implied { color: ${CLR.implied}; }
        .sym-concept { color: ${CLR.concept}; }
        .sym-lateral { color: ${CLR.lateral}; }
        .sym-comment { color: ${CLR.comment}; }

        /* Node text */
        .node-text { font-family: 'Lora', serif; font-size: 15px; flex: 1; line-height: 1.6; white-space: pre-wrap; word-break: break-word; padding-top: 2px; }
        .node-text-action  { color: var(--text); }
        .node-text-implied { color: #5a3a7a; }
        .node-text-concept { color: #6a6258; font-size: 14.5px; }
        .node-text-lateral { color: var(--muted); font-size: 14px; }
        .node-text-comment { color: #b0a898; font-size: 14px; font-style: italic; }
        .placeholder { color: var(--dim); font-style: italic; }

        /* Textarea */
        .node-input {
          font-family: 'Lora', serif; font-size: 15px; color: var(--text);
          background: rgba(160,120,64,.05); border: 1px solid var(--accent);
          border-radius: 4px; padding: 4px 8px; width: 100%; outline: none;
          resize: none; overflow: hidden; line-height: 1.6; min-height: 32px; flex: 1;
        }
        .node-input::placeholder { color: var(--dim); font-style: italic; }

        /* Lateral link */
        .lateral-link {
          display: flex; align-items: center; gap: 8px;
          margin: 2px 0 4px 36px;
          cursor: pointer;
        }
        .lateral-link:hover .lateral-target { color: var(--accent2); }
        .lateral-arrow { color: var(--accent2); font-size: 13px; flex-shrink: 0; }
        .lateral-target { font-family: 'Lora', serif; font-size: 11.5px; color: #90b0a8; font-style: italic; }
        .lateral-stub { opacity: .6; }

        /* Badges */
        .badge { font-family: 'JetBrains Mono', monospace; font-size: 9px; border-radius: 3px; padding: 1px 5px; flex-shrink: 0; white-space: nowrap; }
        .badge-stub { background: rgba(0,0,0,.04); color: var(--muted); border: 1px solid var(--border); }
        .badge-implied { background: rgba(122,90,154,.08); color: #7a5a9a; max-width: 130px; overflow: hidden; text-overflow: ellipsis; }
        .badge-implies { background: rgba(122,90,154,.08); color: #7a5a9a; max-width: 150px; overflow: hidden; text-overflow: ellipsis; cursor: pointer; transition: background .12s; }
        .badge-implies:hover { background: rgba(122,90,154,.18); }
        .badge-media { background: rgba(160,120,64,.1); color: var(--accent); }

        .node-implies-ref {
          border-radius: var(--radius);
          border-left: 2px solid transparent;
          cursor: pointer;
          padding: 2px 6px 2px 2px;
          margin-bottom: 1px;
          transition: background .12s, border-color .12s;
          opacity: .65;
        }
        .node-implies-ref:hover { background: rgba(122,90,154,.05); opacity: 1; }
        .node-implies-ref.selected { border-left-color: var(--purple); background: rgba(122,90,154,.06); opacity: 1; }
        .node-text-implies-ref { font-family: 'Lora', serif; font-size: 14px; color: #7a5a9a; font-style: italic; flex: 1; white-space: pre-wrap; word-break: break-word; padding-top: 2px; }

        /* Hover actions */
        .node-actions { display: flex; align-items: center; gap: 2px; flex-shrink: 0; margin-left: 4px; flex-wrap: nowrap; }
        .act {
          background: none; border: 1px solid transparent; border-radius: 4px;
          cursor: pointer; font-family: 'JetBrains Mono', monospace; font-size: 9.5px;
          padding: 2px 6px; transition: background .12s, border-color .12s, color .12s;
          white-space: nowrap; line-height: 1.4;
        }
        .act:disabled { opacity: .25; cursor: default; }
        .act-concept { color: var(--muted); } .act-concept:hover:not(:disabled) { background: rgba(0,0,0,.05); border-color: var(--border); color: #5a5248; }
        .act-lateral { color: var(--accent2); } .act-lateral:hover { background: rgba(74,144,128,.08); border-color: rgba(74,144,128,.25); }
        .act-comment { color: var(--dim); } .act-comment:hover:not(:disabled) { background: rgba(0,0,0,.04); border-color: var(--border); color: var(--muted); }
        .act-imply   { color: var(--purple); } .act-imply:hover { background: rgba(122,90,154,.08); border-color: rgba(122,90,154,.25); }
        .act-move { color: var(--muted); font-size: 12px; padding: 1px 5px; } .act-move:hover:not(:disabled) { background: rgba(0,0,0,.06); border-color: var(--border); color: var(--text); }
        .act-del     { color: var(--dim); font-size: 13px; padding: 1px 5px; } .act-del:hover { background: rgba(180,60,60,.08); border-color: rgba(180,60,60,.2); color: #c05050; }

        /* Children connector */
        .children { position: relative; }
        .children::before { content: ''; position: absolute; left: 15px; top: 2px; bottom: 2px; width: 1px; background: var(--border); pointer-events: none; }

        /* Action-level separator */
        .action-sep { height: 1px; background: var(--border); margin: 6px 0 6px 0; opacity: .4; }

        /* Code */
        .code-block { margin: 4px 0; border: 1px solid rgba(74,144,128,.2); border-radius: 5px; overflow: hidden; background: #f0f4f2; }
        .code-block pre { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #2a4a40; line-height: 1.65; padding: 8px 12px; white-space: pre; overflow-x: auto; margin: 0; }
        .code-lang { display: block; font-family: 'JetBrains Mono', monospace; font-size: 9px; color: var(--accent2); background: rgba(74,144,128,.1); padding: 3px 10px; border-bottom: 1px solid rgba(74,144,128,.15); text-transform: uppercase; letter-spacing: .06em; }
        .inline-code { font-family: 'JetBrains Mono', monospace; font-size: 11px; background: rgba(74,144,128,.1); color: var(--accent2); border: 1px solid rgba(74,144,128,.2); border-radius: 3px; padding: 1px 4px; }

        /* ── Right panel ── */
        .right { flex: 1; display: flex; flex-direction: column; background: var(--bg); min-width: 0; }
        .right-head { padding: 16px 22px 12px; border-bottom: 1px solid var(--border); display: flex; align-items: baseline; gap: 10px; }
        .media-scroll { flex: 1; overflow-y: auto; padding: 20px 22px 60px; display: flex; flex-direction: column; gap: 16px; scrollbar-width: thin; scrollbar-color: var(--border) transparent; }

        .media-card { border: 1px solid var(--border); border-radius: 10px; overflow: hidden; background: var(--surface); transition: border-color .3s, box-shadow .3s; }
        .media-card.active { border-color: var(--accent); box-shadow: 0 0 0 1px rgba(160,120,64,.1), 0 6px 24px rgba(0,0,0,.1); }
        .media-img-wrap { width: 100%; max-height: 280px; overflow: hidden; }
        .media-img-wrap img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform .4s; }
        .media-card:hover .media-img-wrap img { transform: scale(1.02); }
        .media-caption { padding: 10px 14px; font-family: 'Lora', serif; font-style: italic; font-size: 12px; color: var(--muted); display: flex; align-items: center; gap: 8px; border-top: 1px solid var(--border); }
        .caption-dot { width: 4px; height: 4px; border-radius: 50%; background: var(--accent); flex-shrink: 0; }
        .note-ref { margin-left: auto; font-family: 'JetBrains Mono', monospace; font-style: normal; font-size: 10px; color: var(--dim); white-space: nowrap; }
        .media-doc { padding: 0; }
        .doc-header { padding: 10px 14px; display: flex; align-items: center; gap: 8px; border-bottom: 1px solid var(--border); background: rgba(74,144,128,.04); }
        .doc-icon { font-size: 12px; color: var(--accent2); }
        .doc-title { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--accent2); flex: 1; }
        .doc-preview { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--muted); line-height: 1.7; padding: 12px 14px; white-space: pre-wrap; word-break: break-word; }

        .empty-state { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; opacity: .25; }
        .empty-icon { font-size: 26px; }
        .empty-text { font-family: 'Playfair Display', serif; font-style: italic; font-size: 13px; color: var(--muted); }

        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
      `}</style>

      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
        {/* ── Toolbar ── */}
        <div className="toolbar">
          <span className="toolbar-title">Análise Lockiana</span>
          <button className="toolbar-btn" onClick={() => setImportOpen(true)}>
            ↑ importar
          </button>
          <button className="toolbar-btn primary" onClick={handleExport} disabled={nodes.length === 0}>
            ↓ exportar
          </button>
        </div>

        <div className="app">
        {/* ── Left ── */}
        <div className="left">
          <div className="panel-head">
            <span className="panel-title">Análise</span>
            <button className="btn-new-action" onClick={onAddAction}>
              <span style={{ fontSize: 14, lineHeight: 1 }}>+</span> nova ação
            </button>
          </div>

          <div className="nodes-scroll">
            {nodes.map((node, i) => (
              <div key={node.id}>
                {i > 0 && (node.type === 'action' || node.type === 'implied') && (
                  <div className="action-sep" />
                )}
                <NoteItem
                  node={node} depth={0}
                  siblings={nodes}
                  rootNodes={nodes}
                  selected={selected} focusId={focusId}
                  handlers={handlers}
                />
              </div>
            ))}
            {nodes.length === 0 && (
              <div style={{ padding: '40px 20px', textAlign: 'center', opacity: .3 }}>
                <div style={{ fontFamily: "'Playfair Display',serif", fontStyle: 'italic', fontSize: 13, color: 'var(--muted)' }}>
                  clique em "+ nova ação" para começar
                </div>
              </div>
            )}
          </div>

          {/* Legend */}
          <div className="legend">
            {Object.entries(SYM).map(([type, sym]) => (
              <span key={type} className="leg-item">
                <span className="leg-sym" style={{ color: CLR[type] }}>{sym}</span>
                <span>{type === 'action' ? 'ação' : type === 'implied' ? 'implicada' : type === 'concept' ? 'conceito' : type === 'lateral' ? 'relação' : 'nota'}</span>
              </span>
            ))}
          </div>
        </div>

        {/* ── Right ── */}
        <div className="right">
          <div className="right-head">
            <span style={{ fontFamily: "'Playfair Display',serif", fontSize: 16, fontWeight: 600, color: 'var(--text)', flex: 1 }}>Mídia</span>
            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: 'var(--dim)' }}>{allMedia.length} itens</span>
          </div>
          {allMedia.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">◻</div>
              <div className="empty-text">nenhuma mídia encontrada</div>
            </div>
          ) : (
            <div className="media-scroll" ref={rightRef}>
              {allMedia.map((item, i) => {
                const key = getKey(item);
                const prev = i > 0 ? allMedia[i - 1].nodeId : null;
                return (
                  <div key={key}>
                    {prev && prev !== item.nodeId && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, opacity: .3, fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: 'var(--muted)' }}>
                        <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                        {item.nodeText}
                        <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                      </div>
                    )}
                    <div ref={el => { cardRefs.current[key] = el; }}>
                      <MediaCard item={item} active={item.nodeId === selected} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        </div>
      </div>

        {/* ── Import Modal ── */}
        {importOpen && (
          <div className="modal-overlay" onClick={() => setImportOpen(false)}>
            <div className="modal" onClick={e => e.stopPropagation()}>
              <div className="modal-title">Importar anotação</div>
              <div className="modal-hint">
                {`> Ação ou comportamento\n— Conceito abstraído\n→ Relação lateral\n// Comentário livre\n=> Ação implicada obrigatória`}
              </div>
              <textarea
                className="modal-textarea"
                placeholder="Cole sua anotação aqui…"
                value={importText}
                onChange={e => setImportText(e.target.value)}
                autoFocus
              />
              <div className="modal-actions">
                <button className="modal-cancel" onClick={() => { setImportOpen(false); setImportText(''); }}>cancelar</button>
                <button className="modal-confirm" onClick={handleImport} disabled={!importText.trim()}>importar</button>
              </div>
            </div>
          </div>
        )}
    </>
  );
}
