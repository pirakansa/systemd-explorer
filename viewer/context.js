/* Semantic exploration of observed effective properties, not a transaction simulator. */
(function(root) {
  'use strict';
  const requests = new Set(['Wants', 'Requires', 'BindsTo', 'Upholds']);
  function inspect(idx, name) {
    const effective = idx.relations.filter(e => e.evidence === 'effective');
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
    // Local contact map: original edges, two hops, no invented hardware causality.
    const hiddenNodes=new Set(), seen=new Set([name]), todo=[{unit:name,depth:0}];
    for(let i=0;i<todo.length;i++) {
      const n=todo[i]; if(n.depth===2) continue;
      for(const e of adjacent.get(n.unit)||[]) {
        const other=e.from===n.unit?e.to:e.from;
        if(!seen.has(other)) { if(seen.size<100) {seen.add(other);todo.push({unit:other,depth:n.depth+1});} else hiddenNodes.add(other); }
      }
    }
    for(const e of effective) if(seen.has(e.from)&&seen.has(e.to) && [e.from,e.to].some(n=>['device','mount','automount','socket','path'].includes(idx.units.get(n)?.unit_type))) hardware.push(e);
    const unique = rows => rows.filter((r,i)=>rows.findIndex(x=>x.unit===r.unit)===i);
    return {paths, truncated, terminationCounts, hardwareHiddenNodes:hiddenNodes.size, hardwareHiddenEdges:Math.max(0,hardware.length-100), waits:unique(waits), waitedBy:unique(waitedBy), hardware:hardware.slice(0,100)};
  }
  root.ExplorerContext={inspect};
  if(typeof module!=='undefined') module.exports=root.ExplorerContext;
})(typeof globalThis!=='undefined'?globalThis:this);
