/* Collapsed effective relationship map. Groups are not ownership or boot stages. */
(function(root){
  'use strict';
  const C=typeof module!=='undefined'?require('./core.js'):root.ExplorerCore;
  function summarize(idx,{category='request',focus=null}={}){
    const groups=new Map(),links=new Map(),scope=new Set(focus?[focus]:idx.units.keys());
    let records=0;
    for(const edge of idx.relations){
      if(edge.evidence!=='effective'||(category!=='all'&&C.category(edge.kind)!==category))continue;
      if(focus&&edge.from!==focus&&edge.to!==focus)continue;
      const ordering=C.category(edge.kind)==='ordering';
      const from=ordering&&edge.kind==='After'?edge.to:edge.from,to=ordering&&edge.kind==='After'?edge.from:edge.to;
      const fromType=idx.units.get(from)?.unit_type||'unknown',toType=idx.units.get(to)?.unit_type||'unknown',kind=ordering?'Ordering':edge.kind;
      scope.add(from);scope.add(to);records++;
      const key=JSON.stringify([fromType,toType,kind]);
      if(!links.has(key))links.set(key,{key,fromType,toType,kind,category:C.category(edge.kind),records:[]});
      links.get(key).records.push({edge,from,to});
    }
    for(const name of scope){const unit=idx.units.get(name);if(!unit)continue;const type=unit.unit_type||'unknown';if(!groups.has(type))groups.set(type,[]);groups.get(type).push(unit);}
    const byName=(a,b)=>a.name.localeCompare(b.name);
    const connections=[...links.values()].sort((a,b)=>b.records.length-a.records.length||a.fromType.localeCompare(b.fromType)||a.toType.localeCompare(b.toType)||a.kind.localeCompare(b.kind));
    for(const link of connections)link.records.sort((a,b)=>a.from.localeCompare(b.from)||a.to.localeCompare(b.to)||a.edge.kind.localeCompare(b.edge.kind)||String(a.edge.source||'').localeCompare(String(b.edge.source||'')));
    return {groups:[...groups].map(([type,units])=>({type,units:units.sort(byName)})).sort((a,b)=>b.units.length-a.units.length||a.type.localeCompare(b.type)),connections,records,scopeUnits:scope.size};
  }
  function targets(idx,{category='request',focus=null}={}) {
    const map=new Map([...idx.units.values()].filter(u=>u.unit_type==='target').map(unit=>[unit.name,{unit,links:new Map(),bundles:new Map(),records:0,outgoing:0}]));
    let records=0;
    for(const edge of idx.relations){
      if(edge.evidence!=='effective'||(category!=='all'&&C.category(edge.kind)!==category))continue;
      const ordering=C.category(edge.kind)==='ordering',from=ordering&&edge.kind==='After'?edge.to:edge.from,to=ordering&&edge.kind==='After'?edge.from:edge.to,kind=ordering?'Ordering':edge.kind;
      const record={edge,from,to};if(map.has(from)||map.has(to))records++;
      for(const name of new Set([from,to])){
        if(!map.has(name))continue;
        const target=map.get(name),direction=from===name?'outgoing':'incoming',other=from===name?to:from,unit=idx.units.get(other);
        target.records++;if(direction==='outgoing')target.outgoing++;
        if(unit?.unit_type==='target'){
          const key=JSON.stringify([direction,other,kind]);if(!target.links.has(key))target.links.set(key,{direction,unit,kind,records:[]});target.links.get(key).records.push(record);
        } else {
          const type=unit?.unit_type||'unknown',key=JSON.stringify([direction,type,kind]);
          if(!target.bundles.has(key))target.bundles.set(key,{key,direction,type,kind,units:new Map(),records:[]});
          const bundle=target.bundles.get(key);bundle.units.set(other,unit);bundle.records.push(record);
        }
      }
    }
    let chosen=null;if(focus){chosen=new Set([focus]);for(const e of idx.relations)if(e.evidence==='effective'&&(category==='all'||C.category(e.kind)===category)&&(e.from===focus||e.to===focus)){chosen.add(e.from);chosen.add(e.to);}}
    const sortRecords=(a,b)=>a.from.localeCompare(b.from)||a.to.localeCompare(b.to)||a.edge.kind.localeCompare(b.edge.kind)||String(a.edge.source||'').localeCompare(String(b.edge.source||''));
    const all=[...map.values()];
    const cards=all.filter(t=>t.records&&(!chosen||chosen.has(t.unit.name))).map(t=>({...t,
      links:[...t.links.values()].map(l=>({...l,records:l.records.sort(sortRecords)})).sort((a,b)=>a.direction.localeCompare(b.direction)||a.unit.name.localeCompare(b.unit.name)||a.kind.localeCompare(b.kind)),
      bundles:[...t.bundles.values()].map(b=>({...b,units:[...b.units.values()].sort((a,b)=>a.name.localeCompare(b.name)),records:b.records.sort(sortRecords)})).sort((a,b)=>a.direction.localeCompare(b.direction)||b.units.length-a.units.length||a.type.localeCompare(b.type)||a.kind.localeCompare(b.kind)),
    })).sort((a,b)=>Number(b.unit.name===focus)-Number(a.unit.name===focus)||b.outgoing-a.outgoing||a.unit.name.localeCompare(b.unit.name));
    return {cards,records,unobserved:all.filter(t=>!t.records).length,totalTargets:all.length};
  }
  root.ExplorerStructureData={summarize,targets};if(typeof module!=='undefined')module.exports=root.ExplorerStructureData;
})(typeof globalThis!=='undefined'?globalThis:this);
