import { useState, useRef, useEffect, useCallback } from "react";

const FONT_URL = "https://fonts.googleapis.com/css2?family=JetBrains+Mono:ital,wght@0,400;0,500;0,600;1,400&family=Pinyon+Script&display=swap";

// ── Tipos semânticos da linguagem ────────────────────────────────────────────
// action  >    Ação ou comportamento (imperativo)
// implied =>   Ação obrigatoriamente implicada pela anterior
// concept -    Decomposição hierárquica (do composto ao simples)
// lateral ->   Associação lateral a outra ação (cria stub se não existe)
// comment      Texto livre (sem prefixo; múltiplos permitidos por ação)
// ─────────────────────────────────────────────────────────────────────────────

const SYM = {
  action:  '>',
  implied: '=>',
  concept: '-',
  lateral: '->',
  comment: '',
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

// ── Análise ───────────────────────────────────────────────────────────────────
const mkAnalysis = (tag) => ({
  id: uid(), name: `Análise ${tag}`, tag, nodes: [],
});

const mk = (type, text = '', extra = {}) => ({
  id: uid(), type, text, tag: '', expanded: true,
  children: [], media: [], stub: false,
  impliedBy: null, targetId: null,
  ...extra,
});

// ── Tag helpers ───────────────────────────────────────────────────────────────
// Extract [[tag]] from end of a line; returns { text, tag }
const parseTagFromText = (raw) => {
  const m = raw.match(/^(.*?)\s*\[\[([^\]]+)\]\]\s*$/s);
  if (m) return { text: m[1].trim(), tag: m[2].trim() };
  return { text: raw.trim(), tag: '' };
};

// Next Luhmann child tag given parent tag and already-used sibling tags
const nextLuhmannChild = (parentTag, usedTags) => {
  if (!parentTag) return '';
  const last = parentTag[parentTag.length - 1];
  if (/\d/.test(last)) {
    // ends with digit → append next letter
    const used = usedTags
      .filter(t => t.startsWith(parentTag) && t.length === parentTag.length + 1 && /[a-z]$/.test(t))
      .map(t => t[t.length - 1]);
    for (const l of 'abcdefghijklmnopqrstuvwxyz') {
      if (!used.includes(l)) return parentTag + l;
    }
    return parentTag + 'a';
  } else {
    // ends with letter → append next number
    const used = usedTags
      .filter(t => t.startsWith(parentTag) && /^\d+$/.test(t.slice(parentTag.length)))
      .map(t => parseInt(t.slice(parentTag.length)));
    let n = 1;
    while (used.includes(n)) n++;
    return parentTag + n;
  }
};

// Next root-level action tag (1, 2, 3…)
const nextRootTag = (usedTags) => {
  const nums = usedTags.filter(t => /^\d+$/.test(t)).map(Number);
  let n = 1;
  while (nums.includes(n)) n++;
  return String(n);
};

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

// Collect the id of a node plus all root-level implied descendants (recursively)
const collectImpliedIds = (nodes, id) => {
  const ids = [id];
  const implied = nodes.filter(n => n.impliedBy === id);
  for (const n of implied) ids.push(...collectImpliedIds(nodes, n.id));
  return ids;
};

function moveChild(nodes, id, dir) {
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

// ── NoteItem ──────────────────────────────────────────────────────────────────
function NoteItem({ node, depth, siblings, rootNodes, selected, focusId, tagFocusId, handlers }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(node.text);
  const [editingTag, setEditingTag] = useState(false);
  const [tagDraft, setTagDraft] = useState(node.tag || '');
  const [hovered, setHovered] = useState(false);
  const ref = useRef();
  const tagRef = useRef();
  const isSelected = selected === node.id;
  const isActionLike = node.type === 'action' || node.type === 'implied';
  const hasToggle = isActionLike || node.type === 'concept';

  useEffect(() => {
    if (focusId === node.id) { setDraft(''); setEditing(true); }
  }, [focusId, node.id]);

  useEffect(() => {
    if (tagFocusId === node.id) { setTagDraft(node.tag || ''); setEditingTag(true); }
  }, [tagFocusId, node.id]);

  useEffect(() => {
    if (editing && ref.current) {
      ref.current.focus();
      autoResize(ref.current);
      const len = ref.current.value.length;
      ref.current.setSelectionRange(len, len);
    }
  }, [editing]);

  useEffect(() => {
    if (editingTag && tagRef.current) {
      tagRef.current.focus();
      tagRef.current.select();
    }
  }, [editingTag]);

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

  const commitTag = () => {
    handlers.onEditTag(node.id, tagDraft);
    setEditingTag(false);
  };
  const implierNode = node.impliedBy ? findNode(rootNodes, node.impliedBy) : null;
  const impliedNodes = flatAll(rootNodes).filter(n => n.impliedBy === node.id);

  const conceptSiblings = (siblings || []).filter(s => s.type === 'concept');
  const conceptIdx = conceptSiblings.findIndex(s => s.id === node.id);
  const canMoveUp   = node.type === 'concept' && conceptIdx > 0;
  const canMoveDown = node.type === 'concept' && conceptIdx < conceptSiblings.length - 1;
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

          {node.stub && !editing && <span className="badge badge-stub">stub</span>}

          {/* Tag display / edit */}
          {!editing && (
            editingTag ? (
              <input
                ref={tagRef}
                className="tag-input"
                value={tagDraft}
                placeholder="tag"
                onClick={e => e.stopPropagation()}
                onChange={e => setTagDraft(e.target.value)}
                onBlur={commitTag}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); commitTag(); } }}
              />
            ) : (
              <span
                className={`node-tag${node.tag ? ' node-tag-set' : ' node-tag-empty'}`}
                title="Clique para editar tag"
                onClick={e => { e.stopPropagation(); setTagDraft(node.tag || ''); setEditingTag(true); }}
              >
                {node.tag ? `[[${node.tag}]]` : '[[+]]'}
              </span>
            )
          )}
          {node.type === 'implied' && implierNode && !editing && (
            <span className="badge badge-implied" title={`Implicada por: ${implierNode.text}`}>
              ← {implierNode.text.split(' ').slice(0, 3).join(' ')}…
            </span>
          )}
          {node.media?.length > 0 && !editing && (
            <span className="badge badge-media">{node.media.length}</span>
          )}

          {!editing && (hovered || isSelected) && (
            <div className="node-actions" onClick={e => e.stopPropagation()}>
              {isActionLike && (
                <>
                  <button className="act act-concept" title="Adicionar conceito (-)"
                    onClick={() => handlers.onAddChild(node.id, 'concept')}
                    disabled={node.children.some(c => c.type === 'lateral')}>-</button>
                  <button className="act act-lateral" title="Adicionar relação lateral (->)"
                    onClick={() => handlers.onAddChild(node.id, 'lateral')}
                    disabled={impliedNodes.length > 0}>-&gt;</button>
                  <button className="act act-comment" title="Adicionar nota (texto livre)"
                    onClick={() => handlers.onAddChild(node.id, 'comment')}>
                    ¶
                  </button>
                  <button className="act act-imply" title="Implicar ação obrigatória em sequência (=>)"
                    onClick={() => handlers.onImply(node.id)}
                    disabled={node.children.some(c => c.type === 'lateral') || impliedNodes.length > 0}>=&gt;</button>
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

      {hasToggle && node.expanded && node.children.length > 0 && (
        <div className="children">
          {node.children.map(child => (
            <NoteItem key={child.id} node={child} depth={depth + 1}
              siblings={node.children}
              rootNodes={rootNodes} selected={selected} focusId={focusId} tagFocusId={tagFocusId}
              handlers={handlers} />
          ))}
        </div>
      )}

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
                <span className="sym sym-implied">=&gt;</span>
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
const withTag = (text, tag) => tag ? `${text} [[${tag}]]` : text;

function exportNodes(nodes) {
  const lines = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.type === 'action' || node.type === 'implied') {
      if (i > 0) lines.push('---');
      const prefix = node.type === 'implied' ? '=>' : '>';
      lines.push(`${prefix} ${withTag(node.text, node.tag)}`);
      for (const child of node.children) {
        if (child.type === 'concept')  lines.push(`- ${withTag(child.text, child.tag)}`);
        if (child.type === 'lateral')  lines.push(`-> ${withTag(child.text, child.tag)}`);
        if (child.type === 'comment')  lines.push(withTag(child.text, child.tag));
      }
    }
  }
  return lines.join('\n');
}

// ── Import ────────────────────────────────────────────────────────────────────
function importNodes(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l !== '---' && l !== '');
  const roots = [];
  let current = null;

  for (const line of lines) {
    if (/^=>\s+/.test(line) || line === '=>') {
      const { text: t, tag } = parseTagFromText(line.replace(/^=>\s*/, ''));
      const node = mk('implied', t, { impliedBy: current?.id || null, tag });
      roots.push(node);
      current = node;
    } else if (/^>\s+/.test(line) || line === '>') {
      const { text: t, tag } = parseTagFromText(line.replace(/^>\s*/, ''));
      const node = mk('action', t, { tag });
      roots.push(node);
      current = node;
    } else if (/^->\s*/.test(line)) {
      const { text: t, tag } = parseTagFromText(line.replace(/^->\s*/, ''));
      if (current) current.children.push(mk('lateral', t, { tag }));
    } else if (/^-\s+/.test(line) || line === '-') {
      const { text: t, tag } = parseTagFromText(line.replace(/^-\s*/, ''));
      if (current) current.children.push(mk('concept', t, { tag }));
    } else if (line && current) {
      const { text: t, tag } = parseTagFromText(line);
      current.children.push(mk('comment', t, { tag }));
    }
  }
  return roots;
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [analyses, setAnalyses] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [editingAnalysisId, setEditingAnalysisId] = useState(null);
  const [analysisDraft, setAnalysisDraft] = useState('');
  const [selected, setSelected] = useState(null);
  const [focusId, setFocusId] = useState(null);
  const [tagFocusId, setTagFocusId] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const analysisNameRef = useRef();
  const rightRef = useRef();
  const cardRefs = useRef({});

  const active = analyses.find(a => a.id === activeId) ?? null;
  const nodes = active?.nodes ?? [];

  // All node mutations operate on the active analysis's nodes
  const setNodes = useCallback(fn => {
    setAnalyses(p => p.map(a => a.id === activeId ? { ...a, nodes: fn(a.nodes) } : a));
  }, [activeId]);

  // ── Analysis handlers ──
  const onAddAnalysis = useCallback(() => {
    setAnalyses(p => {
      const usedTags = p.map(a => a.tag).filter(Boolean);
      const tag = nextRootTag(usedTags);
      const a = mkAnalysis(tag);
      setActiveId(a.id);
      setEditingAnalysisId(a.id);
      setAnalysisDraft(a.name);
      setSelected(null);
      return [...p, a];
    });
  }, []);

  const onSelectAnalysis = useCallback(id => {
    setActiveId(id);
    setSelected(null);
  }, []);

  const onDeleteAnalysis = useCallback(id => {
    setAnalyses(p => {
      const next = p.filter(a => a.id !== id);
      if (activeId === id) {
        setActiveId(next.length ? next[next.length - 1].id : null);
        setSelected(null);
      }
      return next;
    });
  }, [activeId]);

  const commitAnalysisName = useCallback(() => {
    const trimmed = analysisDraft.trim();
    if (trimmed) setAnalyses(p => p.map(a => a.id === editingAnalysisId ? { ...a, name: trimmed } : a));
    setEditingAnalysisId(null);
  }, [analysisDraft, editingAnalysisId]);

  useEffect(() => {
    if (editingAnalysisId && analysisNameRef.current) {
      analysisNameRef.current.focus();
      analysisNameRef.current.select();
    }
  }, [editingAnalysisId]);

  // ── Export / Import ──
  const handleExport = () => {
    const text = exportNodes(nodes);
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${active?.name ?? 'analise'}.txt`; a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    const imported = importNodes(importText);
    if (imported.length > 0) { setNodes(() => imported); setSelected(null); }
    setImportOpen(false);
    setImportText('');
  };

  const allMedia = collectMedia(nodes);
  const focus = useCallback((id, focusTag = false) => {
    setSelected(id);
    setFocusId(id);
    if (focusTag) setTagFocusId(id);
  }, []);

  // ── Node handlers ──
  const onToggle = useCallback(id =>
    setNodes(p => updateTree(p, id, n => ({ ...n, expanded: !n.expanded }))), [setNodes]);

  const onSelect = useCallback(id => setSelected(id), []);

  const onEdit = useCallback((id, text, type) => {
    setNodes(p => {
      let next = updateTree(p, id, n => ({ ...n, text, stub: false }));
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
  }, [setNodes]);

  const onEditTag = useCallback((id, tag) => {
    setNodes(p => updateTree(p, id, n => ({ ...n, tag: tag.trim() })));
  }, [setNodes]);

  const onDelete = useCallback(id => {
    setNodes(p => {
      const ids = collectImpliedIds(p, id);
      return ids.reduce((acc, rmId) => removeNode(acc, rmId), p);
    });
    setSelected(s => s === id ? null : s);
  }, [setNodes]);

  const onMove = useCallback((id, dir) => {
    setNodes(p => moveChild(p, id, dir));
  }, [setNodes]);

  const onAddChild = useCallback((parentId, type) => {
    setNodes(p => {
      const parent = findNode(p, parentId);
      if (!parent) return p;
      const allTags = flatAll(p).map(n => n.tag).filter(Boolean);
      const siblingTags = (parent.children || []).map(n => n.tag).filter(Boolean);
      const suggestedTag = parent.tag ? nextLuhmannChild(parent.tag, [...allTags, ...siblingTags]) : '';
      const child = mk(type, '', { tag: suggestedTag });
      const commentIdx = parent.children.findIndex(c => c.type === 'comment');
      let next;
      if (commentIdx !== -1 && type !== 'comment') {
        next = updateTree(p, parentId, n => {
          const ch = [...n.children];
          ch.splice(commentIdx, 0, child);
          return { ...n, expanded: true, stub: false, children: ch };
        });
      } else {
        next = addChild(p, parentId, child);
      }
      setSelected(child.id);
      setFocusId(child.id);
      return next;
    });
  }, [setNodes]);

  const onImply = useCallback(sourceId => {
    setNodes(p => {
      const source = findNode(p, sourceId);
      const allTags = flatAll(p).map(n => n.tag).filter(Boolean);
      const suggestedTag = source?.tag ? nextLuhmannChild(source.tag, allTags) : '';
      const implied = mk('implied', '', { impliedBy: sourceId, tag: suggestedTag });
      const next = addAfterRoot(p, sourceId, implied);
      setSelected(implied.id);
      setFocusId(implied.id);
      return next;
    });
  }, [setNodes]);

  const onAddAction = useCallback(() => {
    if (!active) return;
    setNodes(p => {
      // Root actions inside an analysis are children of the analysis tag
      // e.g. analysis [[2]] → actions [[2a]], [[2b]]…
      const allTags = flatAll(p).map(n => n.tag).filter(Boolean);
      const tag = active.tag ? nextLuhmannChild(active.tag, allTags) : nextRootTag(allTags);
      const action = mk('action', '', { tag });
      setSelected(action.id);
      setFocusId(action.id);
      return [...p, action];
    });
  }, [setNodes, active]);

  useEffect(() => {
    if (focusId) { const t = setTimeout(() => { setFocusId(null); setTagFocusId(null); }, 80); return () => clearTimeout(t); }
  }, [focusId]);

  useEffect(() => {
    const first = allMedia.find(m => m.nodeId === selected);
    if (!first) return;
    const key = `${first.nodeId}-${first.type}-${first.title || first.url}`;
    cardRefs.current[key]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [selected]);

  const handlers = { onToggle, onSelect, onEdit, onEditTag, onDelete, onAddChild, onImply, onMove };
  const getKey = m => `${m.nodeId}-${m.type}-${m.title || m.url}`;

  return (
    <>
      <style>{`
        @import url('${FONT_URL}');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        :root {
          --bg: #f7f4ef; --surface: #ffffff; --border: #e0d9d0;
          --accent: #a07840; --accent2: #4a9080; --purple: #7a5a9a;
          --text: #000000; --muted: #444444; --dim: #888888;
          --mono: 'JetBrains Mono', monospace;
          --radius: 5px;
        }
        body { background: var(--bg); color: var(--text); font-family: var(--mono); }
        .app { display: flex; flex: 1; overflow: hidden; }

        /* ── Toolbar ── */
        .toolbar {
          display: flex; align-items: center; gap: 8px;
          padding: 9px 18px;
          border-bottom: 1px solid var(--border);
          background: var(--surface);
          position: relative; z-index: 10;
        }
        .toolbar-title { font-family: 'Pinyon Script', cursive; font-size: 32px; font-weight: 400; color: var(--text); flex: 1; letter-spacing: .01em; line-height: 1; }
        .toolbar-btn {
          display: flex; align-items: center; gap: 5px;
          background: none; border: 1px solid var(--border);
          color: var(--muted); font-family: var(--mono); font-size: 12px;
          border-radius: var(--radius); padding: 5px 12px; cursor: pointer;
          transition: background .15s, border-color .15s, color .15s;
        }
        .toolbar-btn:hover { background: rgba(0,0,0,.04); border-color: var(--muted); color: var(--text); }
        .toolbar-btn.primary { background: rgba(160,120,64,.08); border-color: rgba(160,120,64,.25); color: var(--accent); }
        .toolbar-btn.primary:hover { background: rgba(160,120,64,.15); border-color: var(--accent); }
        .toolbar-btn:disabled { opacity: .3; cursor: default; pointer-events: none; }

        /* ── Analyses sidebar ── */
        .analyses-sidebar {
          width: 190px; flex-shrink: 0;
          display: flex; flex-direction: column;
          border-right: 1px solid var(--border);
          background: #f2efe9;
        }
        .analyses-head {
          padding: 14px 14px 10px;
          border-bottom: 1px solid var(--border);
          display: flex; align-items: center; gap: 8px;
        }
        .analyses-head-title { font-family: var(--mono); font-size: 12px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .08em; flex: 1; }
        .btn-new-analysis {
          background: none; border: 1px solid var(--border);
          color: var(--muted); font-family: var(--mono); font-size: 14px;
          border-radius: var(--radius); width: 22px; height: 22px;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; transition: background .12s, color .12s, border-color .12s;
          flex-shrink: 0; line-height: 1;
        }
        .btn-new-analysis:hover { background: rgba(160,120,64,.1); border-color: var(--accent); color: var(--accent); }
        .analyses-list { flex: 1; overflow-y: auto; padding: 6px 0; scrollbar-width: thin; scrollbar-color: var(--border) transparent; }
        .analysis-item {
          display: flex; align-items: center; gap: 6px;
          padding: 7px 14px; cursor: pointer;
          border-left: 2px solid transparent;
          transition: background .12s, border-color .12s;
          position: relative;
        }
        .analysis-item:hover { background: rgba(0,0,0,.03); }
        .analysis-item:hover .analysis-del { opacity: 1; }
        .analysis-item.active { border-left-color: var(--accent); background: rgba(160,120,64,.07); }
        .analysis-tag { font-family: var(--mono); font-size: 10px; color: var(--accent); background: rgba(160,120,64,.1); border: 1px solid rgba(160,120,64,.2); border-radius: 3px; padding: 1px 4px; flex-shrink: 0; }
        .analysis-name { font-family: var(--mono); font-size: 13px; color: var(--text); flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .analysis-name-input {
          font-family: var(--mono); font-size: 13px; color: var(--text);
          background: var(--surface); border: 1px solid var(--accent);
          border-radius: 3px; padding: 1px 5px; outline: none; flex: 1; min-width: 0;
        }
        .analysis-del {
          background: none; border: none; cursor: pointer; color: var(--dim);
          font-size: 14px; line-height: 1; padding: 0 2px; opacity: 0;
          transition: color .12s, opacity .12s; flex-shrink: 0;
        }
        .analysis-del:hover { color: #c05050; }

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
        .modal-title { font-family: var(--mono); font-size: 18px; font-weight: 600; color: var(--text); }
        .modal-hint { font-family: var(--mono); font-size: 13px; color: var(--muted); line-height: 1.7; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 10px 14px; white-space: pre; }
        .modal-textarea {
          font-family: var(--mono); font-size: 14px; color: var(--text);
          background: var(--bg); border: 1px solid var(--border); border-radius: 6px;
          padding: 10px 14px; resize: vertical; min-height: 180px; outline: none;
          line-height: 1.65;
        }
        .modal-textarea:focus { border-color: var(--accent); }
        .modal-actions { display: flex; justify-content: flex-end; gap: 8px; }
        .modal-cancel { background: none; border: 1px solid var(--border); color: var(--muted); font-family: var(--mono); font-size: 13px; border-radius: var(--radius); padding: 6px 14px; cursor: pointer; transition: background .12s; }
        .modal-cancel:hover { background: rgba(0,0,0,.04); }
        .modal-confirm { background: rgba(160,120,64,.1); border: 1px solid rgba(160,120,64,.3); color: var(--accent); font-family: var(--mono); font-size: 13px; border-radius: var(--radius); padding: 6px 14px; cursor: pointer; transition: background .12s; }
        .modal-confirm:hover { background: rgba(160,120,64,.2); }

        .left { width: 44%; min-width: 300px; display: flex; flex-direction: column; border-right: 1px solid var(--border); background: var(--surface); }
        .panel-head { padding: 16px 18px 12px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 10px; }
        .panel-title { font-family: var(--mono); font-size: 18px; font-weight: 600; color: var(--text); flex: 1; }

        .btn-new-action {
          display: flex; align-items: center; gap: 5px;
          background: rgba(160,120,64,.08); border: 1px solid rgba(160,120,64,.2);
          color: var(--accent); font-family: var(--mono); font-size: 12px;
          border-radius: var(--radius); padding: 4px 10px; cursor: pointer;
          transition: background .15s, border-color .15s;
        }
        .btn-new-action:hover { background: rgba(160,120,64,.15); border-color: var(--accent); }
        .btn-new-action:disabled { opacity: .3; cursor: default; pointer-events: none; }

        .nodes-scroll { flex: 1; overflow-y: auto; padding: 10px 10px 50px; scrollbar-width: thin; scrollbar-color: var(--border) transparent; }

        /* Legend bar */
        .legend { padding: 8px 16px; border-top: 1px solid var(--border); display: flex; gap: 16px; flex-wrap: wrap; }
        .leg-item { display: flex; align-items: center; gap: 5px; font-family: var(--mono); font-size: 12px; color: var(--muted); }
        .leg-sym { font-size: 12px; font-weight: 600; }

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

        .node-implied.selected { border-left-color: var(--purple); background: rgba(122,90,154,.04); }
        .node-lateral.selected { border-left-color: var(--accent2); background: rgba(74,144,128,.04); }
        .node-comment.selected { border-left-color: var(--dim); }

        .node-row { display: flex; align-items: flex-start; gap: 5px; min-height: 28px; }

        .toggle-btn { background: none; border: none; cursor: pointer; color: var(--muted); font-size: 15px; width: 16px; height: 22px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; padding: 0; margin-top: 2px; transition: color .15s; }
        .toggle-btn:hover { color: var(--accent); }
        .toggle-spacer { width: 16px; flex-shrink: 0; }

        /* Symbols */
        .sym { font-family: var(--mono); font-size: 14px; font-weight: 600; flex-shrink: 0; padding-top: 3px; line-height: 1; min-width: 30px; }
        .sym-action  { color: ${CLR.action};  }
        .sym-implied { color: ${CLR.implied}; }
        .sym-concept { color: ${CLR.concept}; }
        .sym-lateral { color: ${CLR.lateral}; }
        .sym-comment { color: ${CLR.comment}; min-width: 0; width: 0; overflow: hidden; }

        /* Node text */
        .node-text { font-family: var(--mono); font-size: 17px; flex: 1; line-height: 1.6; white-space: pre-wrap; word-break: break-word; padding-top: 2px; }
        .node-text-action  { color: #000; }
        .node-text-implied { color: #000; }
        .node-text-concept { color: #000; font-size: 16px; }
        .node-text-lateral { color: #000; font-size: 16px; }
        .node-text-comment { color: #000; font-size: 16px; font-style: italic; }
        .placeholder { color: var(--dim); font-style: italic; }

        /* Textarea */
        .node-input {
          font-family: var(--mono); font-size: 17px; color: #000;
          background: rgba(160,120,64,.05); border: 1px solid var(--accent);
          border-radius: 4px; padding: 4px 8px; width: 100%; outline: none;
          resize: none; overflow: hidden; line-height: 1.6; min-height: 34px; flex: 1;
        }
        .node-input::placeholder { color: var(--dim); font-style: italic; }

        /* Tags */
        .node-tag { font-family: var(--mono); font-size: 11px; border-radius: 3px; padding: 1px 5px; flex-shrink: 0; cursor: pointer; white-space: nowrap; transition: background .12s, color .12s; user-select: none; }
        .node-tag-set { color: var(--accent); background: rgba(160,120,64,.08); border: 1px solid rgba(160,120,64,.2); }
        .node-tag-set:hover { background: rgba(160,120,64,.18); border-color: var(--accent); }
        .node-tag-empty { color: var(--dim); background: transparent; border: 1px dashed var(--border); opacity: 0; }
        .node:hover .node-tag-empty, .node.selected .node-tag-empty { opacity: 1; }
        .node-tag-empty:hover { color: var(--muted); border-color: var(--muted); background: rgba(0,0,0,.03); }
        .tag-input { font-family: var(--mono); font-size: 11px; color: var(--accent); background: rgba(160,120,64,.07); border: 1px solid var(--accent); border-radius: 3px; padding: 1px 5px; outline: none; width: 80px; flex-shrink: 0; }

        /* Badges */
        .badge { font-family: var(--mono); font-size: 11px; border-radius: 3px; padding: 1px 5px; flex-shrink: 0; white-space: nowrap; }
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
        .node-text-implies-ref { font-family: var(--mono); font-size: 16px; color: #000; font-style: italic; flex: 1; white-space: pre-wrap; word-break: break-word; padding-top: 2px; }

        /* Lateral link */
        .lateral-link {
          display: flex; align-items: center; gap: 8px;
          margin: 2px 0 4px 36px;
          cursor: pointer;
        }
        .lateral-link:hover .lateral-target { color: var(--accent2); }
        .lateral-arrow { color: var(--accent2); font-size: 15px; flex-shrink: 0; }
        .lateral-target { font-family: var(--mono); font-size: 14px; color: #000; font-style: italic; }
        .lateral-stub { opacity: .6; }

        /* Hover actions */
        .node-actions { display: flex; align-items: center; gap: 2px; flex-shrink: 0; margin-left: 4px; flex-wrap: nowrap; }
        .act {
          background: none; border: 1px solid transparent; border-radius: 4px;
          cursor: pointer; font-family: var(--mono); font-size: 11.5px;
          padding: 2px 6px; transition: background .12s, border-color .12s, color .12s;
          white-space: nowrap; line-height: 1.4;
        }
        .act:disabled { opacity: .25; cursor: default; }
        .act-concept { color: var(--muted); } .act-concept:hover:not(:disabled) { background: rgba(0,0,0,.05); border-color: var(--border); color: #333; }
        .act-lateral { color: var(--accent2); } .act-lateral:hover { background: rgba(74,144,128,.08); border-color: rgba(74,144,128,.25); }
        .act-comment { color: var(--dim); } .act-comment:hover:not(:disabled) { background: rgba(0,0,0,.04); border-color: var(--border); color: var(--muted); }
        .act-imply   { color: var(--purple); } .act-imply:hover { background: rgba(122,90,154,.08); border-color: rgba(122,90,154,.25); }
        .act-move { color: var(--muted); font-size: 14px; padding: 1px 5px; } .act-move:hover:not(:disabled) { background: rgba(0,0,0,.06); border-color: var(--border); color: var(--text); }
        .act-del     { color: var(--dim); font-size: 15px; padding: 1px 5px; } .act-del:hover { background: rgba(180,60,60,.08); border-color: rgba(180,60,60,.2); color: #c05050; }

        /* Children connector */
        .children { position: relative; }
        .children::before { content: ''; position: absolute; left: 15px; top: 2px; bottom: 2px; width: 1px; background: var(--border); pointer-events: none; }

        /* Action-level separator */
        .action-sep { height: 1px; background: var(--border); margin: 6px 0 6px 0; opacity: .4; }

        /* Code */
        .code-block { margin: 4px 0; border: 1px solid rgba(74,144,128,.2); border-radius: 5px; overflow: hidden; background: #f0f4f2; }
        .code-block pre { font-family: var(--mono); font-size: 13px; color: #000; line-height: 1.65; padding: 8px 12px; white-space: pre; overflow-x: auto; margin: 0; }
        .code-lang { display: block; font-family: var(--mono); font-size: 11px; color: var(--accent2); background: rgba(74,144,128,.1); padding: 3px 10px; border-bottom: 1px solid rgba(74,144,128,.15); text-transform: uppercase; letter-spacing: .06em; }
        .inline-code { font-family: var(--mono); font-size: 13px; background: rgba(74,144,128,.1); color: var(--accent2); border: 1px solid rgba(74,144,128,.2); border-radius: 3px; padding: 1px 4px; }

        /* ── Right panel ── */
        .right { flex: 1; display: flex; flex-direction: column; background: var(--bg); min-width: 0; }
        .right-head { padding: 16px 22px 12px; border-bottom: 1px solid var(--border); display: flex; align-items: baseline; gap: 10px; }
        .media-scroll { flex: 1; overflow-y: auto; padding: 20px 22px 60px; display: flex; flex-direction: column; gap: 16px; scrollbar-width: thin; scrollbar-color: var(--border) transparent; }

        .media-card { border: 1px solid var(--border); border-radius: 10px; overflow: hidden; background: var(--surface); transition: border-color .3s, box-shadow .3s; }
        .media-card.active { border-color: var(--accent); box-shadow: 0 0 0 1px rgba(160,120,64,.1), 0 6px 24px rgba(0,0,0,.1); }
        .media-img-wrap { width: 100%; max-height: 280px; overflow: hidden; }
        .media-img-wrap img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform .4s; }
        .media-card:hover .media-img-wrap img { transform: scale(1.02); }
        .media-caption { padding: 10px 14px; font-family: var(--mono); font-style: italic; font-size: 14px; color: #000; display: flex; align-items: center; gap: 8px; border-top: 1px solid var(--border); }
        .caption-dot { width: 4px; height: 4px; border-radius: 50%; background: var(--accent); flex-shrink: 0; }
        .note-ref { margin-left: auto; font-family: var(--mono); font-style: normal; font-size: 12px; color: var(--muted); white-space: nowrap; }
        .media-doc { padding: 0; }
        .doc-header { padding: 10px 14px; display: flex; align-items: center; gap: 8px; border-bottom: 1px solid var(--border); background: rgba(74,144,128,.04); }
        .doc-icon { font-size: 14px; color: var(--accent2); }
        .doc-title { font-family: var(--mono); font-size: 13px; color: var(--accent2); flex: 1; }
        .doc-preview { font-family: var(--mono); font-size: 13px; color: #000; line-height: 1.7; padding: 12px 14px; white-space: pre-wrap; word-break: break-word; }

        .empty-state { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; opacity: .25; }
        .empty-icon { font-size: 26px; }
        .empty-text { font-family: var(--mono); font-style: italic; font-size: 15px; color: var(--muted); }

        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
      `}</style>

      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
        {/* ── Toolbar ── */}
        <div className="toolbar">
          <span className="toolbar-title">Little John</span>
          <button className="toolbar-btn" onClick={() => setImportOpen(true)} disabled={!active}>
            ↑ importar
          </button>
          <button className="toolbar-btn primary" onClick={handleExport} disabled={!active || nodes.length === 0}>
            ↓ exportar
          </button>
        </div>

        <div className="app">

          {/* ── Analyses sidebar ── */}
          <div className="analyses-sidebar">
            <div className="analyses-head">
              <span className="analyses-head-title">Análises</span>
              <button className="btn-new-analysis" title="Nova análise" onClick={onAddAnalysis}>+</button>
            </div>
            <div className="analyses-list">
              {analyses.length === 0 && (
                <div style={{ padding: '20px 14px', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--dim)', fontStyle: 'italic' }}>
                  nenhuma análise
                </div>
              )}
              {analyses.map(a => (
                <div
                  key={a.id}
                  className={`analysis-item${a.id === activeId ? ' active' : ''}`}
                  onClick={() => onSelectAnalysis(a.id)}
                >
                  <span className="analysis-tag">[[{a.tag}]]</span>
                  {editingAnalysisId === a.id ? (
                    <input
                      ref={analysisNameRef}
                      className="analysis-name-input"
                      value={analysisDraft}
                      onChange={e => setAnalysisDraft(e.target.value)}
                      onBlur={commitAnalysisName}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); commitAnalysisName(); } }}
                      onClick={e => e.stopPropagation()}
                    />
                  ) : (
                    <span
                      className="analysis-name"
                      onDoubleClick={e => { e.stopPropagation(); setAnalysisDraft(a.name); setEditingAnalysisId(a.id); }}
                    >{a.name}</span>
                  )}
                  <button
                    className="analysis-del"
                    title="Deletar análise"
                    onClick={e => { e.stopPropagation(); onDeleteAnalysis(a.id); }}
                  >×</button>
                </div>
              ))}
            </div>
          </div>

          {/* ── Notes panel ── */}
          <div className="left">
            <div className="panel-head">
              <span className="panel-title">{active ? active.name : 'Análise'}</span>
              <button className="btn-new-action" onClick={onAddAction} disabled={!active}>
                <span style={{ fontSize: 16, lineHeight: 1 }}>+</span> nova ação
              </button>
            </div>

            <div className="nodes-scroll">
              {!active && (
                <div style={{ padding: '40px 20px', textAlign: 'center', opacity: .3 }}>
                  <div style={{ fontFamily: "'JetBrains Mono',monospace", fontStyle: 'italic', fontSize: 15, color: 'var(--muted)' }}>
                    selecione ou crie uma análise
                  </div>
                </div>
              )}
              {active && nodes.map((node, i) => (
                <div key={node.id}>
                  {i > 0 && (node.type === 'action' || node.type === 'implied') && (
                    <div className="action-sep" />
                  )}
                  <NoteItem
                    node={node} depth={0}
                    siblings={nodes}
                    rootNodes={nodes}
                    selected={selected} focusId={focusId} tagFocusId={tagFocusId}
                    handlers={handlers}
                  />
                </div>
              ))}
              {active && nodes.length === 0 && (
                <div style={{ padding: '40px 20px', textAlign: 'center', opacity: .3 }}>
                  <div style={{ fontFamily: "'JetBrains Mono',monospace", fontStyle: 'italic', fontSize: 15, color: 'var(--muted)' }}>
                    clique em "+ nova ação" para começar
                  </div>
                </div>
              )}
            </div>

            {/* Legend */}
            <div className="legend">
              <span className="leg-item"><span className="leg-sym" style={{ color: CLR.action }}>{'>'}</span><span>ação</span></span>
              <span className="leg-item"><span className="leg-sym" style={{ color: CLR.implied }}>{'=>'}</span><span>implicada</span></span>
              <span className="leg-item"><span className="leg-sym" style={{ color: CLR.concept }}>{'-'}</span><span>conceito</span></span>
              <span className="leg-item"><span className="leg-sym" style={{ color: CLR.lateral }}>{'->'}</span><span>relação</span></span>
              <span className="leg-item"><span className="leg-sym" style={{ color: CLR.comment }}>{'¶'}</span><span>nota</span></span>
            </div>
          </div>

          {/* ── Media panel ── */}
          <div className="right">
            <div className="right-head">
              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 18, fontWeight: 600, color: '#000', flex: 1 }}>Mídia</span>
              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: 'var(--muted)' }}>{allMedia.length} itens</span>
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
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, opacity: .3, fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: 'var(--muted)' }}>
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
            <div className="modal-hint">{`> Ação ou comportamento\n- Conceito abstraído\n-> Relação lateral\n=> Ação implicada obrigatória\nTexto livre é uma nota\n---`}</div>
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

