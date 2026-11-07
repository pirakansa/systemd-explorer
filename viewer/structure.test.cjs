const {test}=require('node:test'),assert=require('node:assert/strict'),C=require('./core.js'),S=require('./structure-core.js');
const edge=(from,to,kind,evidence='effective')=>({from,to,kind,evidence,source:'fictional'});
const data={units:[{name:'root.target',unit_type:'target'},{name:'worker.service',unit_type:'service'},{name:'disk.device',unit_type:'device'},{name:'unused.timer',unit_type:'timer'}],timings:[],devices:[],relations:[edge('root.target','worker.service','Wants'),edge('worker.service','disk.device','Requires'),edge('worker.service','disk.device','After'),edge('disk.device','worker.service','Before'),edge('worker.service','root.target','Wants'),edge('root.target','unknown.mount','Wants','install_hint')]};
test('collapsed map retains shared and reciprocal request records without claiming a tree',()=>{
 const idx=C.index(data),model=S.summarize(idx);
 assert.equal(model.records,3);assert.equal(model.scopeUnits,5);assert(model.groups.some(g=>g.type==='timer'));
 assert(model.connections.some(g=>g.fromType==='service'&&g.toType==='target'));
 assert(model.connections.some(g=>g.fromType==='target'&&g.toType==='service'));
 assert.equal(model.connections.reduce((n,g)=>n+g.records.length,0),3);
 const reversed=S.summarize(C.index({...data,relations:[...data.relations].reverse()}));assert.deepEqual(model,reversed);
});
test('ordering is normalized but original inverse property evidence survives',()=>{
 const model=S.summarize(C.index(data),{category:'ordering'});
 assert.equal(model.connections.length,1);const link=model.connections[0];assert.equal(link.fromType,'device');assert.equal(link.toType,'service');assert.equal(link.records.length,2);
 assert.deepEqual(new Set(link.records.map(r=>r.edge.kind)),new Set(['Before','After']));
 assert(link.records.every(r=>r.from==='disk.device'&&r.to==='worker.service'));
});
test('focused scope is one hop and empty observations remain unknown',()=>{
 const idx=C.index(data),model=S.summarize(idx,{focus:'root.target'});assert.equal(model.records,2);assert.equal(model.scopeUnits,2);assert(!model.groups.some(g=>g.type==='device'));
 const unused=S.summarize(idx,{focus:'unused.timer'});assert.equal(unused.records,0);assert.equal(unused.groups[0].units[0].name,'unused.timer');
});
test('target cards preserve shared membership, direction, evidence and deterministic order',()=>{
 const snapshot={...data,units:[...data.units,{name:'second.target',unit_type:'target'},{name:'idle.target',unit_type:'target'}],relations:[...data.relations,edge('second.target','worker.service','Wants'),edge('root.target','second.target','Requires')]};
 const model=S.targets(C.index(snapshot));assert.equal(model.totalTargets,3);assert.equal(model.unobserved,1);
 for(const name of ['root.target','second.target'])assert(model.cards.find(t=>t.unit.name===name).bundles.some(b=>b.direction==='outgoing'&&b.units.some(u=>u.name==='worker.service')));
 assert(model.cards.find(t=>t.unit.name==='second.target').links.some(l=>l.direction==='incoming'&&l.unit.name==='root.target'));
 assert.equal(model.records,4);assert.deepEqual(model,S.targets(C.index({...snapshot,relations:[...snapshot.relations].reverse()})));
});
test('target ordering normalizes After while retaining original records and scoped cards',()=>{
 const idx=C.index({...data,relations:[edge('root.target','worker.service','After'),edge('worker.service','root.target','Before')]});
 const model=S.targets(idx,{category:'ordering',focus:'worker.service'});assert.equal(model.cards.length,1);
 const bundle=model.cards[0].bundles[0];assert.equal(bundle.direction,'incoming');assert.equal(bundle.records.length,2);assert(bundle.records.every(r=>r.to==='root.target'));assert.equal(S.targets(idx).cards.length,0);
});
test('selection location keeps shared targets, category boundaries and scope distinct',()=>{
 const snapshot={...data,units:[...data.units,{name:'second.target',unit_type:'target'}],relations:[...data.relations,edge('second.target','worker.service','Wants'),edge('second.target','disk.device','After')]};
 const idx=C.index(snapshot),location=S.locate(idx,'worker.service');assert.deepEqual(location.targets,['root.target','second.target']);assert.equal(location.records.length,4);
 const ordering=S.locate(idx,'disk.device',{category:'ordering',focus:'unused.timer'});assert.deepEqual(ordering.targets,['second.target']);assert.equal(ordering.inScope,false);assert.equal(ordering.records.length,3);
 assert.deepEqual(S.locate(idx,'unused.timer').targets,[]);assert.equal(S.locate(idx,'unused.timer').totalRecords,0);assert.equal(S.locate(idx,'absent.service'),null);
 assert.equal(S.locate(idx,'unknown.mount').totalRecords,0);
});
