/* Clause-tree reading workflow. Source tokens remain immutable; revisions are clause-local. */
const ReadingClauses = (() => {
  const esc = escapeHtml;
  const clone = value => structuredClone(value);
  const uid = () => crypto.randomUUID();
  let selected = new Set(), target = null, split = null, edit = null, error = '', separate = false, anchor = null, rangeTarget = null, containerSelected = false;
  let undoStack = [], redoStack = [];
  let finishChoice = false, finishing = false;
  let collapsed = new Set(), showScaffold = false;
  const tree = () => state.game.clauseTree;
  const find = (id, node = tree().root) => node.id === id ? node : (node.children || []).map(n => find(id, n)).find(Boolean);
  const sequence = node => node.type === 'parallel' ? node.layout || [] : node.items;
  const wordTitle = item => item.originalSpans?.length ? `Original: ${item.originalSpans.map(s=>s.text).join(' ')}` : item.added ? 'Added for analysis' : '';
  const display = item => item.added ? `[${item.text}]` : item.text;
  const text = (node, subset = null) => sequence(node).filter(i=>!subset||subset.includes(i.id)).map(i=>i.text || text(find(i.child),members(i))).join(' ').replace(/\s+([,.;!?])/g, '$1');
  function parentOf(id, node = tree().root) {
    if (node.children.some(c => c.id === id)) return node;
    return node.children.map(c => parentOf(id,c)).find(Boolean);
  }
  function references(parent, id) { return sequence(parent).filter(i => i.child === id); }
  function members(ref) { return ref.members || sequence(find(ref.child)).map(i => i.id); }
  function restoreWords(node, revised) {
    if (!revised.trim()) return;
    const words = sentenceTranslationTokens(revised,'en').map(t=>t.text), old = node.items;
    let cursor = 0; const result = [];
    for (const item of old) {
      const expected = item.child ? sentenceTranslationTokens(text(find(item.child)),'en').map(t=>t.text) : [item.text];
      let at = cursor;
      while (at < words.length && !expected.every((w,j)=>words[at+j]===w)) at++;
      if (at === words.length) throw Error('Restore omitted words by adding text; keep the original words and their order.');
      while(cursor < at) result.push({id:uid(),text:words[cursor++],added:true});
      result.push(item); cursor += expected.length;
    }
    while(cursor < words.length) result.push({id:uid(),text:words[cursor++],added:true});
    node.items=result; delete node.revised;
  }
  function normalize(node = tree().root) {
    node.children.forEach(normalize);
    if(node.revised) { try {restoreWords(node,node.revised);} catch { /* Keep older free edits intact for review. */ } }
    if(node.type==='parallel' && !node.layout) node.layout=[node.children[0],node.children[2],node.children[1]].filter(Boolean).map(c=>({id:uid(),child:c.id,members:sequence(c).map(i=>i.id)}));
    if(node===tree().root) {
      // Connecting-device marks follow the visible span when grouping or moving it.
      // Also repairs older local drafts that still mark a span in its former owner.
      const nodes=[];const visit=n=>{nodes.push(n);n.children.forEach(visit);};visit(node);
      const marked=new Set(nodes.flatMap(n=>n.connectorIds||[]));
      for(const owner of nodes) owner.connectorIds=sequence(owner).filter(item=>marked.has(item.id)).map(item=>item.id);
    }

  }
  function invalidate(node) {
    if(node.resolution) {
      node.previousResolution ||= clone(node.resolution);
      node.resolution={status:'draft',stage:'roles',chunks:[],order:[],translation:node.resolution.translation,needsReview:true};
    }
  }
  function reconcile(parent) {
    for(const child of parent.children) {
      const all = references(parent,child.id).flatMap(r=>members(r));
      const byId = new Map(sequence(child).map(i=>[i.id,i]));
      const ordered=all.map(id=>byId.get(id)).filter(Boolean);
      if(child.type==='parallel') child.layout=ordered; else child.items=ordered;
      child.connectorIds=(child.connectorIds||[]).filter(id=>ordered.some(i=>i.id===id));
    }
  }
  function moveConnector(item, from, to) {
    if(from.connectorIds?.includes(item.id)) {
      to.connectorIds=[...new Set([...(to.connectorIds||[]),item.id])];
      from.connectorIds=from.connectorIds.filter(id=>id!==item.id);
    }
  }
  function moveNested(item, from, to) {
    if(!item.child) return;
    const nested=from.children.find(c=>c.id===item.child);
    // A linked clause must move with every one of its ranges.
    if(references(from,item.child).length) throw Error('Move the linked clause as a whole rather than separating its ranges.');
    from.children=from.children.filter(c=>c!==nested); to.children.push(nested);
  }
  function syncOuter(node, anchorId) {
    const parent=parentOf(node.id); if(!parent) return;
    const refs=references(parent,node.id), original=new Set(refs.flatMap(r=>members(r)));
    const active=refs.find(r=>members(r).includes(anchorId)) || refs[0];
    for(const ref of refs) { const old=new Set(members(ref)); ref.members=sequence(node).filter(i=>old.has(i.id)||(ref===active&&!original.has(i.id))).map(i=>i.id); }
  }
  function adjust(node, refId, direction, expand) {
    const parent=parentOf(node.id); if(!parent) throw Error('The sentence boundary has been reached.');
    let list=sequence(parent); const ref=list.find(i=>i.id===refId && i.child===node.id);
    if(!ref) throw Error('Select the range to adjust.');
    ref.members=[...members(ref)];
    let index=list.indexOf(ref), neighbor=list[index+direction];
    if(expand && !neighbor) {
      const grand=parentOf(parent.id); if(!grand) throw Error('The sentence boundary has been reached.');
      const outer=references(grand,parent.id).find(r=>members(r).includes(ref.id));
      adjust(parent,outer.id,direction,true); list=sequence(parent); index=list.indexOf(ref); neighbor=list[index+direction];
    }
    if(expand) {
      let item, donor=parent;
      if(neighbor.child && parent.type==='parallel') {
        if(neighbor.child===node.id) throw Error('These ranges already belong to the same clause.');
        donor=find(neighbor.child); neighbor.members=[...members(neighbor)];
        if(neighbor.members.length<=1) throw Error('A boundary change cannot empty another range.');
        const id=direction<0?neighbor.members.pop():neighbor.members.shift();
        item=sequence(donor).find(i=>i.id===id); sequence(donor).splice(sequence(donor).indexOf(item),1);
      } else { if(neighbor.child===node.id) throw Error('These ranges already belong to the same clause.'); item=neighbor; list.splice(list.indexOf(item),1); }
      moveConnector(item,donor,node);moveNested(item,donor,node);
      const own=sequence(node), edge=direction<0?ref.members[0]:ref.members.at(-1), at=own.findIndex(i=>i.id===edge);
      own.splice(at+(direction>0?1:0),0,item); direction<0?ref.members.unshift(item.id):ref.members.push(item.id); invalidate(donor);
    } else {
      if(ref.members.length<=1) throw Error('A boundary change cannot empty a range.');
      const id=direction<0?ref.members.shift():ref.members.pop(), own=sequence(node), item=own.find(i=>i.id===id);
      own.splice(own.indexOf(item),1); moveConnector(item,node,parent);moveNested(item,node,parent);
      list.splice(list.indexOf(ref)+(direction>0?1:0),0,item);
      // Retraction always returns the span to its parent, not a sibling clause.
      // A mixed parent now needs its own resolution so the returned word is included.
      if(parent.type==='parallel') { parent.type='clause';parent.items=list;delete parent.layout; }
    }
    reconcile(parent); syncOuter(parent,ref.id); invalidate(node); for(let p=parent;p;p=parentOf(p.id)) invalidate(p);
  }
  function create(sentence) {
    return {version: 1, step: 1, root: {id: uid(), type: 'clause', items: sentenceTranslationTokens(sentence, 'en').map(t => ({id: uid(), text: t.text})), children: [], resolution: null}};
  }
  const button = (label, action, value = '', disabled = false) => `<button type="button" class="ghost-button" data-clause-action="${action}" data-value="${esc(value)}" ${disabled ? 'disabled' : ''}>${label}</button>`;
  function notify() { normalize(); state.game.reading.onChange(readingSentenceState(), {autosave: false}); }
  function changedChildren(node) {
    return (node.resolution?.chunks || []).filter(c => c.child && find(c.child)?.resolution?.status === 'resolved' && c.source !== find(c.child).resolution.translation);
  }
  // Display-only scaffolds never rewrite the student's natural translation.
  function scaffold(node) {
    const entries=sequence(node), chunks=node.resolution?.chunks || [], claimed=new Set();
    const positioned=chunks.map(chunk=>{
      let positions=[];
      if(chunk.child) positions=entries.flatMap((item,index)=>item.child===chunk.child?[index]:[]);
      else if(chunk.unitIds) positions=entries.flatMap((item,index)=>chunk.unitIds.includes(item.id)?[index]:[]);
      else {
        // Older saved chunks have no source IDs. Match their English words in source order.
        const words=chunk.english.split(/\s+/).filter(Boolean);let cursor=0;
        entries.forEach((item,index)=>{if(!item.child&&!claimed.has(index)&&item.text===words[cursor]) {positions.push(index);cursor++;}});
        if(cursor!==words.length) positions=[];
      }
      positions.forEach(index=>claimed.add(index));
      return {positions, value:chunk.child?'...':chunk.translation.trim()||'...'};
    });
    const result=positioned.filter(c=>c.positions.length).map(c=>({at:c.positions[0],value:c.value}));
    const seen=new Set();
    entries.forEach((item,index)=>{
      if(claimed.has(index)) return;
      if(item.child) {if(seen.has(item.child)) return;seen.add(item.child);}
      result.push({at:index,value:item.child?'...':display(item)});
    });
    return result.sort((a,b)=>a.at-b.at).map(c=>c.value).join(' / ');
  }
  function translationView(node) {
    const translation=node.resolution?.translation || '...';
    return `<div class="clause-translation-view"><p class="clause-chinese" data-clause-natural>${esc(translation)}</p><p class="clause-chinese" data-clause-scaffold-text>${esc(scaffold(node))}</p></div>`;
  }
  const scaffoldControl = checked => `<label class="clause-scaffold-master"><input type="checkbox" data-clause-scaffold ${checked?'checked':''}><span>Show English scaffold</span></label>`;
  function toggleScaffold(input) {
    input.closest('.clause-scaffold-root').classList.toggle('show-english-scaffold',input.checked);
    if(input.closest('#review-activity')) showScaffold=input.checked;
  }
  function savedStructure(root) {
    const renderNode=(node,ref=null)=>{
      const subset=ref?.members;
      return `<section style="${appearanceStyle(node)}" class="clause-node ${node===root?'clause-scaffold-root':''} ${collapsed.has(node.id)?'clause-collapsed':''}">${node===root?'':collapseButton(node.id)}<div class="clause-words">${sequence(node).filter(i=>!subset||subset.includes(i.id)).map(i=>i.child?renderNode(node.children.find(c=>c.id===i.child),i):`<span class="sentence-token" title="${esc(wordTitle(i))}">${node.connectorIds?.includes(i.id)?`<strong><em>${esc(display(i))}</em></strong>`:esc(display(i))}</span>`).join(' ')}</div>${node===root?scaffoldControl(false):translationView(node)}</section>`;
    };
    return renderNode(root);
  }
  function mountSaved(container, clauseTree) {
    if(!clauseTree?.root) return;
    container.innerHTML=savedStructure(clauseTree.root);
    container.addEventListener('click',event=>{const el=event.target.closest('[data-collapse]');if(el) toggleCollapse(el);});
    container.addEventListener('change',event=>{if(event.target.matches('[data-clause-scaffold]')) toggleScaffold(event.target);});
  }
  const containerColors = {White:'#ffffff',Red:'#fde2e2',Yellow:'#fff4bf',Blue:'#dcecff',Green:'#dff2df',Grey:'#e8e8e8'};
  function containerBackground(value) {
    if(!/^#[0-9a-f]{6}$/i.test(value||'')) return containerColors.Green;
    const rgb=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
    const original=rgb(value);
    return Object.values(containerColors).reduce((best,color)=>{
      const distance=c=>rgb(c).reduce((sum,v,i)=>sum+(v-original[i])**2,0);
      return distance(color)<distance(best)?color:best;
    });
  }
  const appearanceStyle = node => {
    const a=node.appearance || {}, color=value=>/^#[0-9a-f]{6}$/i.test(value||'')?value:null;
    return `${color(a.background)?`background-color:${containerBackground(a.background)};`:''}${color(a.border)?`border-color:${a.border};`:''}${['solid','dashed','dotted'].includes(a.borderStyle)?`border-style:${a.borderStyle};border-width:${a.borderStyle==='solid'?'1px':'var(--clause-pattern-width)'};`:''}`;
  };
  const collapseIcon = isCollapsed => `<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="${isCollapsed?'M9 6l-6 6 6 6M15 6l6 6-6 6':'M3 6l6 6-6 6M21 6l-6 6 6 6'}"/></svg>`;
  const collapseButton = id => `<button type="button" class="ghost-button clause-collapse" data-collapse="${esc(id)}" aria-label="${collapsed.has(id)?'Expand':'Collapse'} container" title="${collapsed.has(id)?'Expand':'Collapse'} container" aria-expanded="${!collapsed.has(id)}">${collapseIcon(collapsed.has(id))}</button><span class="clause-collapsed-placeholder">...</span>`;
  function toggleCollapse(el) {
    const id=el.dataset.collapse;
    collapsed.has(id)?collapsed.delete(id):collapsed.add(id);
    document.querySelectorAll('[data-collapse]').forEach(button=>{if(button.dataset.collapse===id) {
      button.closest('.clause-node').classList.toggle('clause-collapsed',collapsed.has(id));
      button.innerHTML=collapseIcon(collapsed.has(id));button.setAttribute('aria-label',`${collapsed.has(id)?'Expand':'Collapse'} container`);button.title=button.getAttribute('aria-label');button.setAttribute('aria-expanded',String(!collapsed.has(id)));
    }});
  }
  function structure(node, nested = false, ref = null) {
    const subset=ref?new Set(members(ref)):null, entries=sequence(node).filter(i=>!subset||subset.has(i.id));
    const linked=ref&&references(parentOf(node.id),node.id).length>1;
    const r=nested?node.resolution:null, active=containerSelected && target===node.id && (!ref || rangeTarget===ref.id);
    return `<section style="${appearanceStyle(node)}" class="clause-node ${!nested?`clause-scaffold-root ${showScaffold?'show-english-scaffold':''}`:''} ${collapsed.has(node.id)?'clause-collapsed':''} ${active?'clause-active':''}" data-clause-node="${node.id}" data-clause-range="${ref?.id||''}" tabindex="0" aria-label="Clause container">
      ${nested?collapseButton(node.id):scaffoldControl(showScaffold)}
      ${linked?`<span class="clause-linked-label">Linked clause ${esc(node.id.slice(0,8))}</span>`:''}
      ${tree().step===1 && active && ref ? boundaryControls(node,ref) : ''}
      <div class="clause-words">${entries.map(i=>i.child ? structure(find(i.child),true,i) : `<button type="button" class="sentence-token ${target===node.id&&selected.has(i.id)?'selected':''}" title="${esc(wordTitle(i))}" data-clause-action="word" data-value="${node.id}|${i.id}|${ref?.id||''}" ${tree().step===2?'disabled':''}>${node.connectorIds?.includes(i.id)?`<strong><em>${esc(display(i))}</em></strong>`:esc(display(i))}</button>`).join(' ')}</div>
      ${r?.needsReview?'<p>Structure changed. Review the clause selections and translation.</p>':''}
      ${r?.status==='resolved'?translationView(node):r&&tree().step===2?'<p>Click to continue resolving the translation</p>':''}
      ${tree().step===2&&nested&&changedChildren(node).length?button('Revise','revise',node.id):''}</section>`;
  }
  function boundaryControls(node,ref) {
    const arrow=(label,glyph,dir,expand)=>`<button type="button" class="ghost-button" data-clause-action="boundary" data-value="${dir}|${expand}" aria-label="${label}" title="${label}">${glyph}</button>`;
    return `<div class="clause-boundary-left">${arrow('Expand left','&lt;',-1,true)}${arrow('Retract left','&gt;',-1,false)}</div><div class="clause-boundary-right">${arrow('Retract right','&lt;',1,false)}${arrow('Expand right','&gt;',1,true)}</div><button type="button" class="ghost-button clause-delete" data-clause-action="delete-split" data-value="${node.id}" aria-label="Delete split" title="Delete split"><svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg></button><div class="clause-appearance" data-appearance="${node.id}"><span class="clause-color-swatches">${Object.entries(containerColors).map(([name,color])=>`<button type="button" class="clause-color-swatch" style="background:${color}" data-container-color="${color}" data-node="${node.id}" aria-label="${name} background" title="${name}" aria-pressed="${color===containerBackground(node.appearance?.background)}"></button>`).join('')}</span>${['solid','dashed','dotted'].map(v=>`<button type="button" class="ghost-button" data-border-style="${v}" data-node="${node.id}" aria-label="${v} border" title="${v} border" aria-pressed="${v===(node.appearance?.borderStyle||'solid')}"><svg aria-hidden="true" width="38" height="16" viewBox="0 0 38 16"><line x1="3" y1="8" x2="35" y2="8" stroke="currentColor" stroke-width="2" ${v==='dashed'?'stroke-dasharray="7 5"':v==='dotted'?'stroke-dasharray="1 5" stroke-linecap="round"':''}/></svg></button>`).join('')}</div>${node.type==='clause'?`<button type="button" class="ghost-button clause-edit" data-clause-action="edit-container" data-value="${node.id}" aria-label="Revise clause wording" title="Revise clause wording"><svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 16l-1 5 5-1L21 7l-4-4L4 16zM14 6l4 4"/></svg></button>`:''}`;
  }
  function deleteSplit(node) {
    const parent=parentOf(node.id); if(!parent) return;
    const replacements=new Map(), list=sequence(parent);
    const next=list.flatMap(item=>{
      if(item.child!==node.id) return [item];
      const expanded=members(item).map(id=>sequence(node).find(i=>i.id===id));
      replacements.set(item.id,expanded.map(i=>i.id));return expanded;
    });
    parent.children=[...parent.children.filter(c=>c.id!==node.id),...node.children];
    parent.type='clause';parent.items=next;delete parent.layout;
    parent.connectorIds=[...new Set([...(parent.connectorIds||[]),...(node.connectorIds||[])])].filter(id=>next.some(i=>i.id===id));
    const grand=parentOf(parent.id);
    if(grand) for(const ref of references(grand,parent.id)) ref.members=members(ref).flatMap(id=>replacements.get(id)||[id]);
    for(let n=parent;n;n=parentOf(n.id)) invalidate(n);
    target=parent.id;rangeTarget=null;selected.clear();anchor=null;
  }
  function clearStructureSelection() { containerSelected=false; selected.clear(); anchor=null; target=null; rangeTarget=null; split=null; }
  function resetSplits() {
    const flatten=(node, ids=null)=>sequence(node).filter(i=>!ids||ids.includes(i.id)).flatMap(i=>i.child?flatten(find(i.child),members(i)):[clone(i)]);
    const root=tree().root, items=flatten(root);
    invalidate(root);root.type='clause';root.items=items;root.children=[];root.connectorIds=[];delete root.layout;delete root.revised;
    clearStructureSelection();
  }
  function restoreHistory(from,to) {
    if(!from.length) return;
    to.push(clone(tree().root));tree().root=from.pop();clearStructureSelection();
  }
  function toolbar() {
    return `<div class="clause-structure-toolbar"><div class="form-actions">${button('Create container','create-container',target||'',!selected.size)}${button(separate?'Separate ranges: on':'Select separate ranges','separate')}${button('Clear selection','clear-selection')}${button('Undo','undo','',!undoStack.length)}${button('Redo','redo','',!redoStack.length)}${button('Reset','reset-splits','',!tree().root.children.length)}</div>
      <p>${separate?'Select individual spans; separated ranges stay linked in their original positions.':'Select the first and last spans to include everything between them.'}</p>
      </div>`;
  }
  function modal(content, label = 'Clause editor') { return `<div class="modal-backdrop sentence-modal-backdrop"><div class="modal sentence-panel-modal clause-modal" data-clause-modal-key="${esc(edit ? `resolve:${edit.id}:${edit.data.stage}` : `split:${split?.node}`)}" role="dialog" aria-modal="true" aria-label="${esc(label)}">${content}<p role="alert">${esc(error)}</p></div></div>`; }
  const originalSpans = item => item.originalSpans || (item.added?[]:[{id:item.id,text:item.text}]);
  function originalItems(items) {
    return items.flatMap(item=>item.child?[clone(item)]:originalSpans(item).map(source=>({...source})));
  }
  function rewriteItems(chosen, revision) {
    const words=sentenceTranslationTokens(revision,'en').map(t=>t.text);
    if(!words.length) throw Error('Enter at least one word for the clause.');
    // Child containers are indivisible and must remain in their existing order.
    const revised=[];let cursor=0;
    for(const child of chosen.filter(i=>i.child)) {
      const expected=sentenceTranslationTokens(text(find(child.child)),'en').map(t=>t.text);
      let at=cursor;
      while(at<words.length&&!expected.every((word,j)=>words[at+j]===word)) at++;
      if(at===words.length) throw Error('Keep nested clause text intact. Edit that container separately.');
      revised.push(...words.slice(cursor,at).map(text=>({text})),clone(child));cursor=at+expected.length;
    }
    revised.push(...words.slice(cursor).map(text=>({text})));
    const n=chosen.length,m=revised.length;
    if(n*m>1000000) throw Error('Revise a smaller clause at a time.');
    const cost=Array.from({length:n+1},()=>Array(m+1).fill(Infinity));cost[n][m]=0;
    const same=(a,b)=>a.child||b.child?a.child===b.child:a.text===b.text;
    for(let i=n;i>=0;i--) for(let j=m;j>=0;j--) {
      if(i===n&&j===m) continue;
      if(i<n&&j<m&&(same(chosen[i],revised[j])||!chosen[i].child&&!revised[j].child)) cost[i][j]=cost[i+1][j+1]+(same(chosen[i],revised[j])?0:1);
      if(i<n&&!chosen[i].child) cost[i][j]=Math.min(cost[i][j],1+cost[i+1][j]);
      if(j<m&&!revised[j].child) cost[i][j]=Math.min(cost[i][j],1+cost[i][j+1]);
    }
    const result=[];let i=0,j=0,pending=[];
    while(i<n||j<m) {
      if(i<n&&j<m&&same(chosen[i],revised[j])&&cost[i][j]===cost[i+1][j+1]) {
        const item=clone(chosen[i++]);j++;
        if(pending.length) {if(item.child) throw Error('Keep an original word beside deleted text so it can be restored.');item.originalSpans=[...pending,...originalSpans(item)];item.added=true;pending=[];}
        result.push(item);
      } else if(j<m&&!revised[j].child&&cost[i][j]===1+cost[i][j+1]) {
        result.push({id:uid(),text:revised[j++].text,added:true,originalSpans:pending});pending=[];
      } else if(i<n&&j<m&&!chosen[i].child&&!revised[j].child&&cost[i][j]===1+cost[i+1][j+1]) {
        const old=chosen[i++], sources=[...pending,...originalSpans(old)];pending=[];
        const item={id:old.id,text:revised[j++].text,originalSpans:sources};
        item.added=!(sources.length===1&&sources[0].text===item.text);result.push(item);
      } else if(i<n&&!chosen[i].child) {pending.push(...originalSpans(chosen[i++]));}
      else throw Error('Keep nested clauses intact when revising the parent.');
    }
    if(pending.length) {
      const last=result.at(-1);if(last.child) throw Error('Keep an original word beside deleted text so it can be restored.');
      last.originalSpans=[...originalSpans(last),...pending];last.added=true;
    }
    return result;
  }
  function revisedSplitItems(chosen, strict = false) {
    let items,revisionError='';
    try {items=rewriteItems(split.restoring?originalItems(chosen):chosen,split.revised);} catch(e) {
      if(strict) throw e;revisionError=e.message;
      items=sentenceTranslationTokens(split.revised,'en').map(t=>({id:uid(),text:t.text,added:true}));
    }
    const pool=split.revisionItems||[], used=new Set(items.filter(i=>chosen.some(c=>c.id===i.id)).map(i=>i.id));
    for(const item of items) if(!chosen.some(c=>c.id===item.id)) {
      const match=pool.find(i=>!i.child&&i.text===item.text&&!used.has(i.id));if(match) item.id=match.id;
      used.add(item.id);
    }
    const previous=split.revisionItems||chosen;
    split.devices=split.devices.filter(id=>items.some(i=>i.id===id&&previous.some(p=>p.id===id&&p.text===i.text)));
    split.revisionItems=items;
    return {items,revisionError};
  }
  function assignRevisedRanges(refs, before, after) {
    const owner=new Map();for(const ref of refs) for(const id of members(ref)) owner.set(id,ref);
    const assignments=new Map(refs.map(ref=>[ref,[]]));
    after.forEach((item,index)=>{
      const sourceOwner=(item.originalSpans||[]).map(source=>owner.get(source.id)).find(Boolean);
      const next=after.slice(index+1).find(i=>owner.has(i.id));
      const ref=owner.get(item.id)||sourceOwner||(next?owner.get(next.id):refs.at(-1));
      assignments.get(ref).push(item.id);
    });
    if([...assignments.values()].some(ids=>!ids.length)) throw Error('Each linked range must retain at least one span.');
    for(const [ref,ids] of assignments) ref.members=ids;
  }
  function splitModal() {
    const node = find(split.node), chosen = node.items.filter(i => split.ids.includes(i.id));
    const words = items => items.map(i => esc(i.text || text(find(i.child)))).join(' ');
    const restored=revisedSplitItems(chosen), revisionError=restored.revisionError;
    const runs=[]; for(const item of node.items) { const picked=split.ids.includes(item.id); if(runs.at(-1)?.picked===picked) runs.at(-1).items.push(item); else runs.push({picked,items:[item]}); }
    const selectedRuns=runs.filter(r=>r.picked);
    const restoredRun = run => restored.items.filter((item,index)=>{
      if(run.items.some(i=>i.id===item.id)) return true;
      if(!item.added || chosen.some(i=>i.id===item.id)) return false;
      const next=restored.items.slice(index+1).find(i=>chosen.some(c=>c.id===i.id));
      return next?run.items.some(i=>i.id===next.id):run===selectedRuns.at(-1);
    }).map(i=>i.child?esc(text(find(i.child))):split.devices.includes(i.id)?`<strong><em>${esc(display(i))}</em></strong>`:esc(display(i))).join(' ');
    const preview = split.editing ? `<div class="clause-node clause-preview-child"><span data-clause-revision-preview>${restored.items.map(i=>i.child?esc(text(find(i.child))):esc(display(i))).join(' ')}</span></div>${revisionError?`<p>${esc(revisionError)}</p>`:''}` : `<div class="clause-node clause-preview-parent">${runs.map(run=>run.picked?`<div class="clause-node clause-preview-child"><span data-clause-revision-preview>${restoredRun(run)}</span></div>`:words(run.items)).join(' ')}</div>${revisionError?`<p>${esc(revisionError)}</p>`:''}`;
    return modal(`<h3>${split.editing?'Edit container':'Create container'}</h3><p>Select the connecting device (optional).</p><div class="clause-words" data-clause-devices>${restored.items.filter(i => !i.child).map(i => `<button type="button" class="sentence-token ${split.devices.includes(i.id) ? 'selected' : ''}" data-clause-action="device" data-value="${i.id}">${esc(display(i))}</button>`).join(' ')}</div>
      <label>Revise clause for analysis (optional)<textarea data-clause-input="revision">${esc(split.revised)}</textarea></label>
      <div class="form-actions">${button('Restore original wording','restore-wording')}</div>
      <h4>Preview</h4><div data-clause-split-preview>${preview}</div>
      <p>Add or rewrite words for analysis. Changes appear in brackets; the original passage is preserved. Edit nested clauses in their own containers.</p>
      ${button('Cancel', 'cancel-split')}${button(split.editing?'Save changes':'Create container', split.editing?'apply-container-edit':'apply-split')}`);
  }
  function units(node) {
    if (node.type === 'parallel') return [node.children[0],node.children[2],node.children[1]].filter(Boolean).map(c => ({id:`child:${c.id}`,child:c.id}));
    const seen=new Set();
    return node.items.filter(i=>!i.child || (!seen.has(i.child)&&seen.add(i.child)));
  }

  function syncTranslationParts(data) {
    for(const chunk of data.chunks) {
      const previous=chunk.parts || [{id:chunk.id,text:chunk.translation||'...',punctuation:chunk.punctuation||''}];
      const texts=chunk.translation.trim().split(/\s+/u).filter(Boolean);
      if(!texts.length) texts.push('...');
      const used=new Set();
      chunk.parts=texts.map((text,index)=>{
        let part=previous.find(p=>p.text===text&&!used.has(p.id));
        if(!part && previous[index] && !used.has(previous[index].id)) part=previous[index];
        const id=part?.id || (index===0&&!used.has(chunk.id)?chunk.id:uid());used.add(id);
        return {id,text,punctuation:part?.punctuation||''};
      });
    }
    const ids=new Set(data.chunks.flatMap(c=>c.parts.map(p=>p.id)));
    data.order=data.order.filter(id=>ids.has(id));
  }
  const translationPart = (data,id) => data.chunks.flatMap(c=>c.parts||[]).find(p=>p.id===id);
  function open(id, revise = false) {
    const node = find(id);
    edit = {id, data: clone(node.resolution || {status: 'draft', chunks: [], order: [], translation: '', stage: 'roles'}), selection: [], moving: null};
    if (revise) {
      let cursor = 0;
      const revisedChunks=new Set();
      for (const id of edit.data.order) {
        const c = edit.data.chunks.find(c => c.id === id || c.parts?.some(p=>p.id===id));
        if(!c || revisedChunks.has(c.id)) continue;revisedChunks.add(c.id);
        const old = c.translation || '...';
        const at = edit.data.translation.indexOf(old, cursor);
        const resolved = c.child && find(c.child)?.resolution;
        if (resolved?.status === 'resolved' && c.source !== resolved.translation) {
          const replacement = resolved.translation;
          if (at >= 0) {
            edit.data.translation = edit.data.translation.slice(0, at) + `  ${replacement}  ` + edit.data.translation.slice(at + old.length);
            cursor = at + replacement.length + 4;
          }
          c.translation = replacement; c.source = replacement;
        } else if (at >= 0) cursor = at + old.length;
      }
    }
    // A previously unresolved child becomes the editable default on reopening.
    for (const c of edit.data.chunks) {
      const child = c.child && find(c.child)?.resolution;
      if (child?.status === 'resolved' && (c.translation === '...' || !c.translation)) { c.translation = child.translation; c.source = child.translation; }
    }
    syncTranslationParts(edit.data);
    error = ''; render();
  }
  function sortPredicateChunks(node, data) {
    const spans=units(node);
    const firstSpan=chunk=>{
      const position=spans.findIndex((span,index)=>{
        if(chunk.unitIds?.length) return chunk.unitIds.includes(span.id);
        if(chunk.child) return span.child===chunk.child;
        // Saved answers from before source IDs were recorded retain English text.
        const words=sentenceTranslationTokens(chunk.english,'en').map(t=>t.text);
        return words.length&&words.every((word,offset)=>spans[index+offset]?.text===word);
      });
      return position<0?Infinity:position;
    };
    const predicates=data.chunks.filter(chunk=>chunk.role==='action').sort((a,b)=>firstSpan(a)-firstSpan(b));
    let index=0;data.chunks=data.chunks.map(chunk=>chunk.role==='action'?predicates[index++]:chunk);
  }
  function resolveModal() {
    const node = find(edit.id), d = edit.data; sortPredicateChunks(node,d);syncTranslationParts(d);
    const tokens = units(node);
    const chunkInput = c => c.child && find(c.child)?.resolution?.status !== 'resolved' ? button('...', 'descend', c.child) : `<textarea placeholder="Use spaces to create separately selectable translation parts" data-clause-input="chunk" data-id="${c.id}" aria-label="Chinese translation for ${esc(c.english)}">${esc(c.translation)}</textarea>`;
    let body = '';
    if (d.stage === 'roles') body = `<p>Select words or a whole nested clause, then assign a role.</p><div class="clause-words">${tokens.map(i => `<button type="button" class="sentence-token ${edit.selection.includes(i.id) ? 'selected' : ''}" data-clause-action="select-unit" data-value="${i.id}">${esc(i.text ? display(i) : text(find(i.child)))}</button>`).join(' ')}</div><div class="clause-role-rows">${['subject','action','modifier'].map((role,index) => `<div class="clause-role clause-role-row ${role}" data-clause-role="${role}">${button(['Subject','Predicate','Adverbial'][index], 'role', role, !edit.selection.length)}<div class="clause-role-chunks">${d.chunks.filter(c=>c.role===role).map(c=>`<div class="clause-role-chip"><span>${esc(c.english)}</span>${button('Remove','remove-chunk',c.id)}</div>`).join('') || '<span class="clause-role-empty">Select spans, then click the role title to add a chunk.</span>'}</div></div>`).join('')}</div>`;
    if (d.stage === 'translate') body = `<table class="reading-chunk-table"><thead><tr><th>English chunk</th><th>Chinese translation</th></tr></thead><tbody>${d.chunks.map(c => `<tr class="${c.role}"><th>${esc(c.english)}</th><td>${chunkInput(c)}</td></tr>`).join('')}</tbody></table>`;
    if (d.stage === 'order') body = `<p>Pick each chunk in Chinese sentence order.</p><table class="reading-chunk-table clause-order-table"><thead><tr><th scope="col">English chunk</th><th scope="col">Chinese translation / order</th></tr></thead><tbody>${d.chunks.map(c => `<tr class="${c.role}"><th scope="row">${esc(c.english)}</th><td>${c.parts.map(part=>`<div class="reading-order-container">${button(`<span class="clause-order-number">${d.order.indexOf(part.id) + 1 || '+'}</span> <span>${esc(part.text)}</span>`, 'pick', part.id)}${['，','。'].map(mark => button(mark + (part.punctuation === mark ? ' ✓' : ''), 'punctuation', `${part.id}|${mark}`)).join('')}${button('Reposition', 'move', part.id, !d.order.includes(part.id))}</div>`).join('')}</td></tr>`).join('')}</tbody></table>${edit.moving ? `<div class="reading-order-sequence">${d.order.filter(id => id !== edit.moving).map((id,index) => `${button('+','gap',String(index))}<span>${esc(translationPart(d,id)?.text||'...')}</span>`).join('')}${button('+','gap',String(d.order.length - 1))}${button('Cancel reposition','stop-move')}</div>` : ''}<label>Natural Chinese translation<textarea data-clause-input="natural">${esc(d.translation)}</textarea></label>`;
    const tabs=`<div class="clause-workflow-tabs clause-resolve-tabs" role="tablist" aria-label="Resolve clause stages">${[['roles','1. Select roles'],['translate','2. Translate chunks'],['order','3. Order / Natural translation']].map(([stage,label])=>`<button type="button" id="clause-resolve-tab-${stage}" role="tab" aria-selected="${d.stage===stage}" aria-controls="clause-resolve-panel" tabindex="${d.stage===stage?0:-1}" data-clause-action="${stage}" ${stage!=='roles'&&!d.chunks.length?'disabled':''}>${label}</button>`).join('')}</div>`;
    return modal(`<h3>Resolve clause</h3><p>${esc(text(node))}</p>${tabs}<div role="tabpanel" id="clause-resolve-panel" aria-labelledby="clause-resolve-tab-${d.stage}">${body}</div><div class="form-actions clause-close">${button('Cancel edit','cancel-edit')}${button('Save draft','save-draft')}${button('Mark as resolved','resolved','', !d.translation.trim())}</div>`);
  }
  function sentenceTranslation() {
    const seen=new Set();
    const composed=sequence(tree().root).map(item=>{
      if(!item.child) return item.text;
      if(seen.has(item.child)) return '';seen.add(item.child);
      const child=find(item.child);
      return child.resolution?.status==='resolved'?child.resolution.translation:'...';
    }).filter(Boolean).reduce((sentence,part)=>sentence + (!sentence || (/^[,.;!?，。！？；：]$/.test(part) && !sentence.endsWith('...')) ? '' : ' ') + part,'');
    if(tree().sentenceComposition!==composed) {
      if(tree().sentenceComposition!==undefined || !state.game.translationDraft.trim()) state.game.translationDraft=composed;
      tree().sentenceComposition=composed;
    }
    return `<div class="panel clause-sentence-translation"><label for="clause-sentence-translation">Sentence translation</label><p>Translate any remaining English spans and revise the combined translation, then click Finish sentence. Unresolved containers appear as ... .</p><textarea id="clause-sentence-translation" data-clause-input="sentence" rows="4">${esc(state.game.translationDraft)}</textarea></div>`;
  }
  function render() {
    const previousModal=document.querySelector('.clause-modal');
    const previousKey=previousModal?.dataset.clauseModalKey;
    const scrollTop=previousModal?.scrollTop || 0, backdropTop=previousModal?.parentElement.scrollTop || 0;
    const focused=previousModal?.contains(document.activeElement) ? document.activeElement : null;
    const focusedAction=focused?.dataset.clauseAction, focusedValue=focused?.dataset.value;
    const game = state.game; normalize();
    document.querySelector('#review-activity').innerHTML = `<section class="sentence-comic-activity">${renderSentenceTranslationTop(currentSentencePrompt())}<div class="clause-workflow-tabs" role="tablist" aria-label="Sentence practice">${[1,2].map(step=>`<button type="button" id="clause-tab-${step}" role="tab" aria-selected="${tree().step===step}" aria-controls="clause-workflow-panel" tabindex="${tree().step===step?0:-1}" data-clause-action="step${step}">${step===1?'1. Structure':'2. Resolve clauses / Translation'}</button>`).join('')}</div><div role="tabpanel" id="clause-workflow-panel" aria-labelledby="clause-tab-${tree().step}"><h3>${tree().step === 1 ? '1. Analyze sentence structure' : '2. Resolve and translate clauses'}</h3><p>${tree().step === 1 ? 'Select spans, then create a container. Group each clause or connecting word separately as needed.' : 'Click a clause container to resolve or edit its translation. You can start with any nested level. The outer yellow container holds the sentence.'}</p>${tree().step===1?toolbar():''}${structure(tree().root)}${tree().step===2?sentenceTranslation():''}<div class="form-actions">${button('Back to passage','back')}${tree().step === 2 ? button('Finish sentence','finish') : ''}</div></div>${split ? splitModal() : ''}${edit ? resolveModal() : ''}${finishChoice ? modal(`<h3>Sentence saved</h3><p>${game.reading.position < game.reading.total ? 'Continue to the next sentence or return to the passage?' : 'You have reached the last sentence. Return to the passage to review your progress.'}</p><div class="form-actions">${game.reading.position < game.reading.total ? button('Next sentence','finish-next') : ''}${button('Back to passage','finish-back')}</div>`, 'Sentence saved') : ''}<p role="status">${esc(error)}</p></section>`;
    const nextModal=document.querySelector('.clause-modal');
    if(nextModal && nextModal.dataset.clauseModalKey===previousKey) {
      if(focusedAction) [...nextModal.querySelectorAll('[data-clause-action]')].find(el=>el.dataset.clauseAction===focusedAction&&el.dataset.value===focusedValue)?.focus({preventScroll:true});
      nextModal.scrollTop=scrollTop;nextModal.parentElement.scrollTop=backdropTop;
    }
    if(!finishChoice) notify();
  }
  function compose() { const d = edit.data; d.translation = d.order.map(id => { const part = translationPart(d,id); return part.text + (part.punctuation || ''); }).join(''); }
  async function save(status) { if(status==='resolved') delete edit.data.needsReview; find(edit.id).resolution = {...clone(edit.data), status}; notify(); await state.game.reading.onCheckpoint(); edit = null; undoStack=[];redoStack=[]; }
  async function click(event) {
    if(!event.target.closest('#review-activity')) return;
    const swatch=event.target.closest('[data-container-color]');if(swatch) {
      const node=find(swatch.dataset.node);node.appearance={...node.appearance,background:swatch.dataset.containerColor};
      document.querySelectorAll('[data-clause-node]').forEach(container=>{if(container.dataset.clauseNode===node.id) container.style.cssText=appearanceStyle(node);});
      swatch.parentElement.querySelectorAll('[data-container-color]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.containerColor===node.appearance.background)));notify();return;
    }
    const border=event.target.closest('[data-border-style]');if(border) {
      const node=find(border.dataset.node);node.appearance={...node.appearance,borderStyle:border.dataset.borderStyle};
      document.querySelectorAll('[data-clause-node]').forEach(container=>{if(container.dataset.clauseNode===node.id) container.style.cssText=appearanceStyle(node);});
      border.parentElement.querySelectorAll('[data-border-style]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.borderStyle===node.appearance.borderStyle)));notify();return;
    }
    if(event.target.closest('.clause-translation-view, .clause-appearance, .clause-scaffold-master')) return;
    const collapse=event.target.closest('[data-collapse]');if(collapse) {toggleCollapse(collapse);return;}
    if(finishing) return;
    if(finishChoice && !event.target.closest('[data-clause-action="finish-next"], [data-clause-action="finish-back"]')) return;
    const el = event.target.closest('[data-clause-action]'); if (!el) {
      const container=event.target.closest('[data-clause-node]');
      if(container&&!edit&&!split) {
        if(tree().step===2) { if(container.dataset.clauseNode!==tree().root.id) return open(container.dataset.clauseNode); return; }
        containerSelected=true;target=container.dataset.clauseNode;rangeTarget=container.dataset.clauseRange;selected.clear();anchor=null;render();
      } return;
    }
    const a = el.dataset.clauseAction, value = el.dataset.value; error = '';
    const structural=['apply-split','apply-container-edit','boundary','delete-split','reset-splits'].includes(a);
    const beforeStructure=structural?clone(tree().root):null;
    try {
      if(a==='undo') restoreHistory(undoStack,redoStack);
      if(a==='redo') restoreHistory(redoStack,undoStack);
      if(a==='reset-splits') {
        if(!window.confirm('Remove all splits and return every span to the sentence level? Restored words will be kept. Clause selections and translations may need review. You can undo this reset.')) return;
        resetSplits();
      }
      if(a==='delete-split') deleteSplit(find(value));
      if(a==='container') { containerSelected=true; [target,rangeTarget]=value.split('|'); selected.clear(); anchor=null; }
      if(a==='clear-selection') {selected.clear();anchor=null;}
      if(a==='separate') {separate=!separate;selected.clear();anchor=null;}
      if(a==='boundary') {
        const before=clone(tree().root); const [dir,expand]=value.split('|');
        try {adjust(find(target),rangeTarget,Number(dir),expand==='true');selected.clear();anchor=null;}
        catch(e) {tree().root=before;throw e;}
      }
      if (a === 'word') {
        containerSelected=false;
        const [node,id,range]=value.split('|'); if(target!==node) {selected.clear();anchor=null;}
        target=node;rangeTarget=range;
        if(separate) selected.has(id)?selected.delete(id):selected.add(id);
        else {
          const list=sequence(find(node)); if(!anchor) anchor=id;
          const bounds=[list.findIndex(i=>i.id===anchor),list.findIndex(i=>i.id===id)].sort((a,b)=>a-b);
          selected=new Set(list.slice(bounds[0],bounds[1]+1).map(i=>i.id));
        }
      }
      if(a==='edit-container') {
        const node=find(value);
        split={node:value,editing:true,ids:node.items.map(i=>i.id),devices:[...(node.connectorIds||[])],revised:node.items.map(i=>i.text||text(find(i.child))).join(' ')};
      }
      if(a==='apply-container-edit') {
        const node=find(split.node), parent=parentOf(node.id), old=[...node.items];
        const revised=revisedSplitItems(old,true);
        if(parent) {
          assignRevisedRanges(references(parent,node.id),old,revised.items);
        }
        node.items=revised.items;node.connectorIds=split.devices.filter(id=>node.items.some(i=>i.id===id));
        for(let n=node;n;n=parentOf(n.id)) invalidate(n);
        split=null;selected.clear();anchor=null;
      }
      if (a === 'create-container') split = {node:value,ids:[...selected],devices:[],revised:find(value).items.filter(i=>selected.has(i.id)).map(i=>i.text||text(find(i.child))).join(' ')};
      if(a==='restore-wording') {const node=find(split.node), chosen=node.items.filter(i=>split.ids.includes(i.id));split.restoring=true;split.revised=originalItems(chosen).map(i=>i.text||text(find(i.child))).join(' ');split.revisionItems=[];}
      if (a === 'device') split.devices.includes(value) ? split.devices.splice(split.devices.indexOf(value),1) : split.devices.push(value);
      if (a === 'cancel-split') split = null;
      if (a === 'apply-split') {
        const n = find(split.node), picked = n.items.filter(i => split.ids.includes(i.id));
        if (!picked.length) throw Error('Select at least one span to create a container.');
        const make = items => ({id:uid(),type:'clause',items,children:n.children.filter(c => items.some(i => i.child === c.id)),resolution:null});
        for(const child of n.children) {
          const refs=references(n,child.id), count=refs.filter(r=>split.ids.includes(r.id)).length;
          if(count && count!==refs.length) throw Error('Select all linked ranges of a nested clause before moving it.');
        }
        const original=[...n.items];
        const layout = groups => {
          const result=[];
          for(const item of original) {
            const child=groups.find(c=>c.items.some(i=>i.id===item.id));
            if(!child) {result.push(item);continue;}
            const previous=result.at(-1);
            if(previous?.child===child.id) previous.members.push(item.id);
            else result.push({id:uid(),child:child.id,members:[item.id]});
          }
          return result;
        };
        {
          const child=make(picked); child.connectorIds=split.devices.filter(id=>picked.some(i=>i.id===id));
          // Build linked references before inserting restored words.
          const arranged=layout([child]);
          child.items=revisedSplitItems(picked,true).items;
          child.connectorIds=split.devices.filter(id=>child.items.some(i=>i.id===id));
          const inherited=(n.connectorIds||[]).filter(id=>picked.some(old=>old.id===id&&child.items.some(item=>item.id===id&&item.text===old.text)));
          child.connectorIds=[...new Set([...child.connectorIds,...inherited])];
          n.connectorIds=(n.connectorIds||[]).filter(id=>!picked.some(item=>item.id===id));
          assignRevisedRanges(arranged.filter(ref=>ref.child===child.id),picked,child.items);
          n.items=arranged;n.children=[...n.children.filter(c=>!child.children.includes(c)),child];invalidate(n);
        }
        // Ancestor range references follow the replacement units, preserving their place.
        const parent=parentOf(n.id);
        if(parent) for(const ref of references(parent,n.id)) {
          const old=new Set(members(ref));
          ref.members=sequence(n).filter(i=>old.has(i.id)||i.child&&members(i).some(id=>old.has(id))).map(i=>i.id);
        }
        split = null; selected.clear(); anchor=null; target=null; rangeTarget=null;
      }
      if (a === 'step2') tree().step = 2;
      if (a === 'step1') tree().step = 1;
      if (a === 'resolve' || a === 'revise') return open(value,a === 'revise');
      if (a === 'select-unit') edit.selection.includes(value) ? edit.selection.splice(edit.selection.indexOf(value),1) : edit.selection.push(value);
      if (a === 'role') {
        const list = units(find(edit.id)).filter(i => edit.selection.includes(i.id));
        // Nested clauses stay atomic even when selected alongside ordinary words.
        let words = [];
        const add = (english, child, unitIds) => { const resolved = child && find(child).resolution; edit.data.chunks.push({id:uid(),role:value,english,unitIds,child:child || null,translation:child ? resolved?.status === 'resolved' ? resolved.translation : '...' : '',source:child && resolved?.status === 'resolved' ? resolved.translation : '...'}); };
        for (const i of list) { if (i.child) { if(words.length) add(words.map(i=>i.text).join(' '),null,words.map(i=>i.id)); words=[]; add(text(find(i.child)),i.child,[i.id]); } else words.push(i); }
        if(words.length) add(words.map(i=>i.text).join(' '),null,words.map(i=>i.id)); edit.selection=[];
      }
      if (a === 'remove-chunk') { edit.data.chunks = edit.data.chunks.filter(c => c.id !== value); syncTranslationParts(edit.data); }
      if (['roles','translate','order'].includes(a)) edit.data.stage = a;
      if (a === 'pick') { const order=edit.data.order; order.includes(value) ? order.splice(order.indexOf(value),1) : order.push(value); compose(); }
      if (a === 'punctuation') { const [id,mark]=value.split('|'),c=translationPart(edit.data,id); c.punctuation=c.punctuation===mark?'':mark; compose(); }
      if (a === 'move') edit.moving=value;
      if (a === 'stop-move') edit.moving=null;
      if (a === 'gap') { edit.data.order=edit.data.order.filter(id=>id!==edit.moving); edit.data.order.splice(Number(value),0,edit.moving);edit.moving=null;compose(); }
      if (a === 'descend') { await save('draft'); return open(value); }
      if (a === 'save-draft') await save('draft');
      if (a === 'resolved') { if (!edit.data.translation.trim()) throw Error('Enter a translation first.'); await save('resolved'); }
      if (a === 'cancel-edit') { if (!window.confirm('All edits made since opening this clause will not be saved. Cancel edit?')) return; edit=null; }
      if (a === 'finish-next') { await state.game.reading.onNext(); return; }
      if (a === 'back' || a === 'finish-back') { await state.game.reading.onBack(); return; }
      if (a === 'finish') {
        if(!state.game.translationDraft.trim()) throw Error('Enter the sentence translation before finishing.');
        finishing=true;el.disabled=true;el.textContent='Saving…';
        try { await state.game.reading.onFinish(readingSentenceState()); finishChoice=true; }
        finally { finishing=false; }
      }
      if(structural && JSON.stringify(beforeStructure)!==JSON.stringify(tree().root)) {
        undoStack.push(beforeStructure);if(undoStack.length>50) undoStack.shift();redoStack=[];
      }
    } catch(e) { if(beforeStructure) tree().root=beforeStructure; error=e.message; }
    render();
    if(['roles','translate','order'].includes(a)) document.querySelector(`#clause-resolve-tab-${a}`)?.focus({preventScroll:true});
    if(a==='step1'||a==='step2') document.querySelector(`#clause-tab-${tree().step}`)?.focus({preventScroll:true});
  }
  function input(event) {
    const el=event.target, kind=el.dataset.clauseInput;
    if(['background','border','borderStyle'].includes(kind)) {
      const node=find(el.dataset.node);node.appearance={...node.appearance,[kind]:el.value};
      document.querySelectorAll('[data-clause-node]').forEach(container=>{if(container.dataset.clauseNode===node.id) container.style.cssText=appearanceStyle(node);});notify();return;
    }
    if(el.matches('[data-clause-scaffold]')) { toggleScaffold(el);return; }
    if(kind==='revision') {
      split.revised=el.value;
      const template=document.createElement('template');template.innerHTML=splitModal();
      document.querySelector('[data-clause-split-preview]').innerHTML=template.content.querySelector('[data-clause-split-preview]').innerHTML;
      document.querySelector('[data-clause-devices]').innerHTML=template.content.querySelector('[data-clause-devices]').innerHTML;
    }
    if(kind==='sentence') {state.game.translationDraft=el.value;notify();}
    if(kind==='natural') edit.data.translation=el.value;
    if(kind==='chunk') {edit.data.chunks.find(c=>c.id===el.dataset.id).translation=el.value;syncTranslationParts(edit.data);}
    // Modal edits are transactional; only Save draft/Resolved/descending commits them.
    if(kind==='natural') document.querySelector('[data-clause-action="resolved"]').disabled=!el.value.trim();
  }
  document.addEventListener('keydown',event=>{
    const tab=event.target.closest('.clause-workflow-tabs [role="tab"]');
    if(tab&&['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) {
      event.preventDefault();
      const tabs=[...tab.closest('[role="tablist"]').querySelectorAll('[role="tab"]:not(:disabled)')],index=tabs.indexOf(tab);
      const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
      tabs[next]?.click();
    } else if(event.target.matches('[data-clause-node]:not(.clause-scaffold-root)')&&tree().step===2&&['Enter',' '].includes(event.key)) {
      event.preventDefault();event.target.click();
    }
  });
  return {create,render,click,input,mountSaved,scaffold,reset(){showScaffold=false;collapsed=new Set();finishChoice=false;finishing=false;undoStack=[];redoStack=[];selected=new Set();target=null;split=null;edit=null;error='';separate=false;anchor=null;rangeTarget=null;containerSelected=false;}};
})();
