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
  root.ExplorerStructureData={summarize};if(typeof module!=='undefined')module.exports=root.ExplorerStructureData;
})(typeof globalThis!=='undefined'?globalThis:this);
