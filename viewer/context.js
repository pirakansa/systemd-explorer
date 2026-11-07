/* Semantic exploration of observed effective properties, not a transaction simulator. */
(function(root) {
  'use strict';
  const requests = new Set(['Wants', 'Requires', 'BindsTo', 'Upholds']);
  function inspect(idx, name) {
    const key = e => JSON.stringify([e.from,e.to,e.kind,e.source || '']);
    const compare = (a,b) => key(a).localeCompare(key(b));
    const effective = idx.relations.filter(e => e.evidence === 'effective').sort(compare);
    const waits = [], waitedBy = [], hardware = [], paths = [];
    for (const e of effective) {
      const before = e.kind === 'Before' ? e.from : e.kind === 'After' ? e.to : null;
      const after = e.kind === 'Before' ? e.to : e.kind === 'After' ? e.from : null;
      if (after === name) waits.push({ unit: before, edge: e });
      if (before === name) waitedBy.push({ unit: after, edge: e });
    }
    const incoming = new Map(), adjacent = new Map();
    for (const e of effective) {
      if (requests.has(e.kind)) { if (!incoming.has(e.to)) incoming.set(e.to, []); incoming.get(e.to).push(e); }
      for (const n of new Set([e.from,e.to])) { if (!adjacent.has(n)) adjacent.set(n, []); adjacent.get(n).push(e); }
    }
    const queue = [{ nodes: [name], edges: [] }]; let truncated = false;
    const terminationCounts = {}, stopped = new Set();
    function stop(path, reason, stoppedAt) {
      terminationCounts[reason] = (terminationCounts[reason] || 0) + 1;
      const key = JSON.stringify([path.nodes, path.edges.map(e => [e.kind,e.source]), reason, stoppedAt]);
      if (!stopped.has(key) && paths.length < 100) { paths.push({...path, stop:reason, stoppedAt}); stopped.add(key); }
      else if (!stopped.has(key)) { truncated=true; terminationCounts['display-limit']=(terminationCounts['display-limit']||0)+1; }
    }
    for (let i=0; i<queue.length; i++) {
      const p=queue[i], parents=incoming.get(p.nodes[0]) || [];
      if (p.edges.length >= 4 || !parents.length) { if (p.edges.length || parents.length) stop(p, parents.length ? 'depth-limit' : 'no-upstream-observation'); if (parents.length) truncated=true; continue; }
      for (const e of parents) {
        if (p.nodes.includes(e.from)) { stop(p, 'cycle', e.from); truncated=true; continue; }
        if (queue.length >= 100) { stop(p, 'path-limit', e.from); truncated=true; continue; }
        queue.push({nodes:[e.from,...p.nodes],edges:[e,...p.edges]});
      }
    }
    // Direct evidence first. Indirect contacts require a hardware-like intermediary,
    // never a generic target/service hub. Preserve the original connecting edge.
    const isHardware = n => ['device','mount','automount','socket','path'].includes(idx.units.get(n)?.unit_type);
    const neighbors = adjacent.get(name) || [];
    const direct = neighbors.filter(e => isHardware(e.from) || isHardware(e.to)).sort(compare);
    const contactKind = e => requests.has(e.kind) || ['Triggers','TriggeredBy'].includes(e.kind);
    const connectors = neighbors.filter(contactKind);
    const intermediates = [...new Set(connectors.map(e=>e.from===name?e.to:e.from).filter(n=>n!==name&&isHardware(n)))].sort();
    const indirectMap = new Map();
    for (const via of intermediates.slice(0,100)) for (const edge of adjacent.get(via)||[]) {
      if (edge.from===name || edge.to===name || !contactKind(edge)) continue;
      const connector = connectors.find(e=>e.from===via||e.to===via);
      if (connector.from===name ? edge.from!==via : edge.to!==via) continue;
      const k = JSON.stringify([via,key(edge)]);
      if (!indirectMap.has(k)) indirectMap.set(k,{via,edge,connector});
    }
    const indirect = [...indirectMap.values()].sort((a,b)=>a.via.localeCompare(b.via)||compare(a.edge,b.edge));
    const hardwareDirect = direct.slice(0,100), hardwareIndirect = indirect.slice(0,Math.max(0,100-hardwareDirect.length));
    const unique = rows => rows.filter((r,i)=>rows.findIndex(x=>x.unit===r.unit)===i);
    return {paths, truncated, terminationCounts, hardwareHiddenNodes:Math.max(0,intermediates.length-100), hardwareHiddenEdges:Math.max(0,direct.length+indirect.length-100), hardwareDirect, hardwareIndirect, waits:unique(waits), waitedBy:unique(waitedBy), hardware:[...hardwareDirect,...hardwareIndirect.map(x=>x.edge)]};
  }
  function devices(idx, observations) {
    const paths = new Map(observations.filter(d=>d.sysfs_path).map(d=>[d.unit,d.sysfs_path])), groups=new Map();
    for(const unit of idx.units.values()) {
      if(!['device','mount','automount'].includes(unit.unit_type)) continue;
      const path=unit.unit_type==='device'?paths.get(unit.name):null;
      const key=path?'sysfs:'+path:'unit:'+unit.name;
      if(!groups.has(key)) groups.set(key,{path,units:[]}); groups.get(key).units.push(unit);
    }
    return [...groups.values()].map(g=>({...g,units:g.units.sort((a,b)=>a.name.localeCompare(b.name))})).sort((a,b)=>a.units[0].name.localeCompare(b.units[0].name));
  }
  function condition(properties, prefix) {
    const raw=properties[prefix+'Result'], time=properties[prefix+'TimestampMonotonic'];
    if(time===undefined || !Number.isFinite(Number(time)) || Number(time)<=0) return 'No evaluation timestamp recorded';
    if(raw==='yes') return 'Latest recorded evaluation passed';
    if(raw==='no') return 'Latest recorded evaluation did not pass';
    return 'Evaluation result unknown';
  }
  root.ExplorerContext={inspect,devices,condition};
  if(typeof module!=='undefined') module.exports=root.ExplorerContext;
})(typeof globalThis!=='undefined'?globalThis:this);
