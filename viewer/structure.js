/* Expand grouped observations into unit evidence; never construct a hierarchy. */
(function(root){
  'use strict';
  function create({document:doc,element,onInspect}){
    let idx=null,model=null,focus=null,type=null,connection=null,unitPage=40,edgePage=40;
    const el=(tag,text,id,cls)=>{const e=doc.createElement(tag);if(text!==undefined)e.textContent=String(text);if(id)e.id=id;if(cls)e.className=cls;return e;};
    const button=(text,action)=>{const b=el('button',text);b.type='button';b.addEventListener('click',action);return b;};
    const status=el('p','','structure-status'),scope=el('div',undefined,'structure-scope'),controls=el('div',undefined,undefined,'structure-controls');
    status.setAttribute('role','status');
    const mode=el('select',undefined,'structure-mode');
    for(const [value,label]of [['request','Activation requests'],['ordering','Ordering constraints'],['other','Other relationships'],['all','All categories']]){const o=el('option',label);o.value=value;mode.append(o);}mode.value='request';
    const targets=el('select',undefined,'structure-target'),search=el('input',undefined,'structure-search');search.type='search';search.placeholder='Related unit name or description…';
    const labeled=(text,input)=>{const label=el('label',text);label.append(input);return label;};
    controls.append(labeled('Relationship category',mode),labeled('Target to investigate (not a proven boot root)',targets),button('Whole system',()=>{focus=null;type=null;connection=null;targets.value='';search.value='';rebuild();}));
    const groups=el('div',undefined,'structure-groups','structure-groups'),links=el('div',undefined,'structure-connections','structure-links'),units=el('div',undefined,'structure-units'),edges=el('div',undefined,'structure-edges');
    const direction=el('p',undefined,'structure-direction','muted');
    const help=el('details');help.append(el('summary','How groups and arrows are interpreted'),el('p','Collapsed by unit type, not startup stages or ownership. Groups can share dependencies and are not a tree. Same-type links alone do not prove a unit cycle. Request arrows mean A requests B; ordering arrows mean earlier → later and do not start units. Counts are property observations, including inverse records of the same constraint. Effective manager data only; unknown provenance remains unknown.',undefined,'muted'));
    element.replaceChildren(controls,status,scope,direction,help,groups,labeled('Search expanded units / observations',search),units,el('h3','Connections between groups'),links,edges);
    function inspect(name){onInspect(name);}
    function focusOn(name){search.value='';focus=name;connection=null;unitPage=40;edgePage=40;targets.value=idx.units.get(name)?.unit_type==='target'?name:'';rebuild();}
    function renderUnits(){
      units.replaceChildren();if(!model||!type)return;
      const group=model.groups.find(g=>g.type===type),query=search.value.toLowerCase();
      const rows=(group?.units||[]).filter(u=>u.name.toLowerCase().includes(query)||String(u.description||'').toLowerCase().includes(query));
      units.append(el('h3',type+' · '+rows.length+' matching units'));
      for(const u of rows.slice(0,unitPage)){const row=el('div',undefined,undefined,'structure-unit');row.append(el('span',u.name),el('small',(u.active_state||'unknown')+(u.unresolved?' · unresolved':'')),button('Map connections',()=>focusOn(u.name)),button('Inspect unit',()=>inspect(u.name)));units.append(row);}
      if(rows.length>unitPage)units.append(button('Show more units',()=>{unitPage+=40;renderUnits();}));
      if(!rows.length)units.append(el('p','No units match in this group.'));
    }
    function renderEdges(){
      edges.replaceChildren();if(!connection)return;
      const query=search.value.toLowerCase();
      const rows=connection.records.filter(r=>[r.from,r.to,idx.units.get(r.from)?.description,idx.units.get(r.to)?.description].some(v=>String(v||'').toLowerCase().includes(query)));
      edges.append(el('h3',connection.fromType+' → '+connection.toType+' · '+connection.kind+' · '+rows.length+' records'));
      for(const r of rows.slice(0,edgePage)){const row=el('div',undefined,undefined,'relation');row.append(button(r.from,()=>inspect(r.from)),el('span',' → '),button(r.to,()=>inspect(r.to)));const evidence=el('details');evidence.append(el('summary','Original property evidence'),el('p',r.edge.from+' → '+r.edge.to+' · '+r.edge.kind),el('p',r.edge.source||'Source unknown'),el('p','Origin: '+(r.edge.origin||'undetermined')));row.append(evidence);edges.append(row);}
      if(rows.length>edgePage)edges.append(button('Show more observations',()=>{edgePage+=40;renderEdges();}));
      if(!rows.length)edges.append(el('p','No observations match this search.'));
    }
    function rebuild(){
      groups.replaceChildren();links.replaceChildren();scope.replaceChildren();
      if(!idx){model=null;connection=null;direction.textContent='';status.textContent='Open a snapshot to explore its structure.';units.replaceChildren();edges.replaceChildren();return;}
      model=root.ExplorerStructureData.summarize(idx,{category:mode.value,focus});
      direction.textContent=mode.value==='request'?'Request arrows: requester → requested unit. No ordering is implied.':mode.value==='ordering'?'Ordering arrows: earlier → later. Counts are original property records, not unique constraints. Ordering does not start a unit.':'Requests use requester → requested; ordering uses earlier → later; other kinds retain original property direction.';
      status.textContent=model.scopeUnits+' units · '+model.groups.length+' type groups · '+model.records+' effective property observations · '+model.connections.length+' grouped connections';
      scope.append(el('strong',focus?'Connections around '+focus+' (one hop)':'Whole system — all unit types'));
      if(focus)scope.append(button('Inspect '+focus,()=>inspect(focus)));
      for(const group of model.groups){const b=button(group.type+' · '+group.units.length+' units',()=>{type=type===group.type?null:group.type;unitPage=40;rebuild();});b.setAttribute('aria-pressed',String(type===group.type));groups.append(b);}
      for(const link of model.connections){const b=button(link.fromType+' → '+link.toType+' · '+link.kind+' · '+link.records.length+' records',()=>{connection=link;edgePage=40;renderEdges();});b.className=link.category;links.append(b);}
      if(connection)connection=model.connections.find(c=>c.key===connection.key)||null;
      if(!model.connections.length)links.append(el('p','No effective relationships observed for this category/scope. This is not proof of no dependencies.'));
      renderUnits();renderEdges();
    }
    mode.addEventListener('change',()=>{connection=null;rebuild();});targets.addEventListener('change',()=>{focus=targets.value||null;type=null;connection=null;search.value='';rebuild();});search.addEventListener('input',()=>{unitPage=40;edgePage=40;renderUnits();renderEdges();});
    rebuild();
    return {setSnapshot(index){idx=index;focus=null;type=null;connection=null;search.value='';mode.value='request';targets.replaceChildren();const all=el('option','Whole system');all.value='';targets.append(all);targets.value='';if(idx)for(const u of [...idx.units.values()].filter(u=>u.unit_type==='target').sort((a,b)=>a.name.localeCompare(b.name))){const option=el('option',u.name);option.value=u.name;targets.append(option);}for(const c of [mode,targets,search])c.disabled=!idx;rebuild();}};
  }
  root.ExplorerStructure={create};
})(typeof globalThis!=='undefined'?globalThis:this);
