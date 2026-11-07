/* Expand grouped observations into unit evidence; never construct a hierarchy. */
(function(root){
  'use strict';
  function create({document:doc,element,onInspect}){
    let selection=null,location=null;
    let idx=null,model=null,focus=null,type=null,connection=null,unitPage=40,edgePage=40;
    const el=(tag,text,id,cls)=>{const e=doc.createElement(tag);if(text!==undefined)e.textContent=String(text);if(id)e.id=id;if(cls)e.className=cls;return e;};
    const button=(text,action)=>{const b=el('button',text);b.type='button';b.addEventListener('click',action);return b;};
    const status=el('p','','structure-status'),scope=el('div',undefined,'structure-scope'),controls=el('div',undefined,undefined,'structure-controls');
    status.setAttribute('role','status');
    const mode=el('select',undefined,'structure-mode');
    for(const [value,label]of [['request','Activation requests'],['ordering','Ordering constraints'],['other','Other relationships'],['all','All categories']]){const o=el('option',label);o.value=value;mode.append(o);}mode.value='request';
    let history=[],cardPage=12,bundleUnits=null;
    const grouping=el('select',undefined,'structure-grouping');for(const [value,label]of [['target','Individual targets'],['type','Unit types']]){const o=el('option',label);o.value=value;grouping.append(o);}grouping.value='target';
    const back=button('Back to previous scope',()=>{const old=history.pop();if(!old)return;focus=old.focus;type=old.type;search.value=old.query;mode.value=old.mode;grouping.value=old.grouping;bundleUnits=old.bundleUnits;connection=old.connection;targets.value=focus||'';rebuild();});back.id='structure-back';
    const selectedPanel=el('div',undefined,'structure-selection','structure-selection');selectedPanel.setAttribute('aria-live','polite');
    const cards=el('div',undefined,'structure-target-map','structure-target-map');
    const targets=el('select',undefined,'structure-target'),search=el('input',undefined,'structure-search');search.type='search';search.placeholder='Related unit name or description…';
    const labeled=(text,input)=>{const label=el('label',text);label.append(input);return label;};
    controls.append(labeled('Group by',grouping),back,labeled('Relationship category',mode),labeled('Target to investigate (not a proven boot root)',targets),button('Whole system',()=>focusOn(null)));
    const groups=el('div',undefined,'structure-groups','structure-groups'),links=el('div',undefined,'structure-connections','structure-links'),units=el('div',undefined,'structure-units'),edges=el('div',undefined,'structure-edges');
    const direction=el('p',undefined,'structure-direction','muted');
    const help=el('details');help.append(el('summary','How groups and arrows are interpreted'),el('p','Collapsed by unit type, not startup stages or ownership. Groups can share dependencies and are not a tree. Same-type links alone do not prove a unit cycle. Request arrows mean A requests B; ordering arrows mean earlier → later and do not start units. Counts are property observations, including inverse records of the same constraint. Effective manager data only; unknown provenance remains unknown.',undefined,'muted'));
    element.replaceChildren(controls,status,selectedPanel,scope,direction,help,cards,groups,labeled('Search expanded units / observations',search),units,el('h3','Connections between groups'),links,edges);
    function inspect(name){onInspect(name);}
    function focusOn(name){history.push({focus,type,query:search.value,mode:mode.value,grouping:grouping.value,bundleUnits,connection});bundleUnits=null;type=null;cardPage=12;search.value='';focus=name;connection=null;unitPage=40;edgePage=40;targets.value=idx.units.get(name)?.unit_type==='target'?name:'';rebuild();}
    function locateSelected(){
      if(!location)return;
      focusOn(selection);grouping.value=location.targets.length?'target':'type';type=idx.units.get(selection).unit_type;rebuild();
    }
    function renderSelected(){
      selectedPanel.replaceChildren();location=idx&&selection?root.ExplorerStructureData.locate(idx,selection,{category:mode.value,focus}):null;
      if(!location){selectedPanel.append(el('p','Select a unit in the inventory, timeline or hardware view to locate it here.'));return;}
      selectedPanel.append(el('strong','Selected unit: '+selection),el('p',location.records.length+' effective direct records in this category · '+location.targets.length+' related targets. '+(location.inScope?'Present in the current scope.':'Outside the current scope.')),
        button('Locate selected unit',locateSelected),button('Inspect selected unit',()=>inspect(selection)));
      if(!location.records.length)selectedPanel.append(el('p',location.totalRecords?'Other categories contain effective records; change Relationship category to inspect them.':'No effective direct relationships collected. Position and activation cause remain unknown.'));
      selectedPanel.append(el('small','Highlights show direct effective relationships in the selected category, not ownership or the historical activation cause.'));
    }
    function renderUnits(){
      units.replaceChildren();if(!model||!type)return;
      const group=model.groups.find(g=>g.type===type),query=search.value.toLowerCase();
      const rows=(bundleUnits||group?.units||[]).filter(u=>u.name.toLowerCase().includes(query)||String(u.description||'').toLowerCase().includes(query));
      units.append(el('h3',type+' · '+rows.length+' matching units'));
      for(const u of rows.slice(0,unitPage)){const row=el('div',undefined,undefined,'structure-unit');if(u.name===selection){row.className+=' structure-highlight';row.setAttribute('aria-label','Selected unit '+u.name);}row.append(el('span',u.name),el('small',(u.active_state||'unknown')+(u.unresolved?' · unresolved':'')),button('Map connections',()=>focusOn(u.name)),button('Inspect unit',()=>inspect(u.name)));units.append(row);}
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
    function renderTargets(){
      cards.replaceChildren();if(!idx||grouping.value!=='target')return;
      const map=root.ExplorerStructureData.targets(idx,{category:mode.value,focus});
      const relatedTargets=new Set(location?.targets||[]);map.cards.sort((a,b)=>Number(relatedTargets.has(b.unit.name))-Number(relatedTargets.has(a.unit.name)));
      cards.append(el('p',map.cards.length+' targets in scope · '+map.unobserved+' targets have no observations in this category. Shared dependencies appear under each target; cards are not a boot sequence.'));
      for(const target of map.cards.slice(0,cardPage)){
        const card=el('article',undefined,undefined,'structure-target-card');if(relatedTargets.has(target.unit.name)){card.className+=' structure-highlight';card.append(el('strong',target.unit.name===selection?'Selected target':'Directly related to selected unit'));}card.append(button(target.unit.name,()=>focusOn(target.unit.name)),el('small',target.unit.active_state||'State unknown'));
        const related=el('details');related.append(el('summary',target.links.length+' target connections'));
        for(const link of target.links){const text=(link.direction==='outgoing'?'→ ':'← ')+link.unit.name+' · '+link.kind;related.append(button(text,()=>focusOn(link.unit.name)),button('Evidence: '+text,()=>{connection={fromType:link.direction==='outgoing'?target.unit.name:link.unit.name,toType:link.direction==='outgoing'?link.unit.name:target.unit.name,kind:link.kind,records:link.records};search.value='';edgePage=40;renderEdges();}));}
        for(const record of location?.records||[])if((record.from===target.unit.name||record.to===target.unit.name)&&target.unit.name!==selection){const hit=button('Property: '+record.from+' → '+record.to+' · '+record.kind,()=>{connection={fromType:record.kind==='After'?record.to:record.from,toType:record.kind==='After'?record.from:record.to,kind:record.kind,records:[{edge:record,from:record.kind==='After'?record.to:record.from,to:record.kind==='After'?record.from:record.to}]};search.value='';renderEdges();});hit.className='structure-highlight';card.append(hit);}
        for(const link of target.links.filter(l=>l.direction==='outgoing').slice(0,3))card.append(button('→ '+link.unit.name+' · '+link.kind,()=>focusOn(link.unit.name)));
        card.append(related);
        const bundles=el('details');bundles.append(el('summary',target.bundles.length+' surrounding unit groups'));
        for(const bundle of target.bundles)bundles.append(button((bundle.direction==='outgoing'?'→ ':'← ')+bundle.type+' · '+bundle.kind+' · '+bundle.units.length+' units',()=>{focusOn(target.unit.name);bundleUnits=bundle.units;type=bundle.type;connection={fromType:bundle.direction==='outgoing'?target.unit.name:bundle.type,toType:bundle.direction==='outgoing'?bundle.type:target.unit.name,kind:bundle.kind,records:bundle.records};renderUnits();renderEdges();}));
        card.append(bundles);cards.append(card);
      }
      if(map.cards.length>cardPage)cards.append(button('Show more targets',()=>{cardPage+=12;renderTargets();}));
      if(!map.cards.length)cards.append(el('p','No target relationships observed in this scope. Try Unit types to explore other units.'));
    }
    function rebuild(){
      if(targets.firstChild)targets.firstChild.textContent=focus&&idx?.units.get(focus)?.unit_type!=='target'?'Current unit scope: '+focus:'Whole system';
      renderSelected();cards.replaceChildren();back.disabled=!history.length;groups.hidden=links.hidden=grouping.value==='target';
      groups.replaceChildren();links.replaceChildren();scope.replaceChildren();
      if(!idx){model=null;connection=null;direction.textContent='';status.textContent='Open a snapshot to explore its structure.';units.replaceChildren();edges.replaceChildren();return;}
      model=root.ExplorerStructureData.summarize(idx,{category:mode.value,focus});
      direction.textContent=mode.value==='request'?'Request arrows: requester → requested unit. No ordering is implied.':mode.value==='ordering'?'Ordering arrows: earlier → later. Counts are original property records, not unique constraints. Ordering does not start a unit.':'Requests use requester → requested; ordering uses earlier → later; other kinds retain original property direction.';
      status.textContent=model.scopeUnits+' units · '+model.groups.length+' type groups · '+model.records+' effective property observations · '+model.connections.length+' grouped connections';
      if(history.length)scope.append(el('small','Investigation history: '+history.map(h=>h.focus||'Whole system').join(' → ')+' → current scope (navigation, not activation history)'));
      scope.append(el('strong',focus?'Connections around '+focus+' (one hop)':'Whole system — all unit types'));
      if(focus)scope.append(button('Inspect '+focus,()=>inspect(focus)));
      for(const group of model.groups){const b=button(group.type+' · '+group.units.length+' units',()=>{type=type===group.type?null:group.type;unitPage=40;rebuild();});if(group.units.some(u=>u.name===selection))b.className='structure-highlight';b.setAttribute('aria-pressed',String(type===group.type));groups.append(b);}
      for(const link of model.connections){const b=button(link.fromType+' → '+link.toType+' · '+link.kind+' · '+link.records.length+' records',()=>{connection=link;edgePage=40;renderEdges();});b.className=link.category+(link.records.some(r=>r.from===selection||r.to===selection)?' structure-highlight':'');links.append(b);}
      if(connection&&connection.key)connection=model.connections.find(c=>c.key===connection.key)||null;
      if(!model.connections.length)links.append(el('p','No effective relationships observed for this category/scope. This is not proof of no dependencies.'));
      renderTargets();renderUnits();renderEdges();
    }
    grouping.addEventListener('change',()=>{bundleUnits=null;type=null;connection=null;rebuild();});mode.addEventListener('change',()=>{bundleUnits=null;connection=null;rebuild();});targets.addEventListener('change',()=>focusOn(targets.value||null));search.addEventListener('input',()=>{unitPage=40;edgePage=40;renderUnits();renderEdges();});
    rebuild();
    return {select(name){selection=idx?.units.has(name)?name:null;cardPage=12;rebuild();},locateSelected,setSnapshot(index){idx=index;selection=null;history=[];bundleUnits=null;cardPage=12;grouping.value='target';focus=null;type=null;connection=null;search.value='';mode.value='request';targets.replaceChildren();const all=el('option','Whole system');all.value='';targets.append(all);targets.value='';if(idx)for(const u of [...idx.units.values()].filter(u=>u.unit_type==='target').sort((a,b)=>a.name.localeCompare(b.name))){const option=el('option',u.name);option.value=u.name;targets.append(option);}for(const c of [mode,targets,search,grouping])c.disabled=!idx;rebuild();}};
  }
  root.ExplorerStructure={create};
})(typeof globalThis!=='undefined'?globalThis:this);
