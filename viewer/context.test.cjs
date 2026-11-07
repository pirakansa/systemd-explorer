const {test}=require('node:test'),assert=require('node:assert/strict');
const C=require('./core.js'), X=require('./context.js');
test('request paths and normalized ordering remain separate; cycles terminate',()=>{
 const edge=(from,to,kind,evidence='effective')=>({from,to,kind,evidence});
 const data={units:['a.target','b.service','c.device'].map(name=>({name,unit_type:name.split('.').pop()})),timings:[],devices:[],relations:[edge('a.target','b.service','Wants'),edge('b.service','c.device','After'),edge('c.device','b.service','Before'),edge('b.service','a.target','Requires'),edge('a.target','c.device','Wants','install_hint')]};
 const result=X.inspect(C.index(data),'b.service');assert(result.truncated);assert.equal(result.waits.length,1);assert.equal(result.waits[0].unit,'c.device');assert(result.hardware.length);assert(!result.paths.some(p=>p.edges.some(e=>e.kind==='After')));
});
test('partial request paths retain cycle, depth and size stop reasons',()=>{
 const make = relations => C.index({units:[],timings:[],devices:[],relations});
 const edge=(from,to)=>({from,to,kind:'Wants',evidence:'effective'});
 let result=X.inspect(make([edge('a.service','b.service'),edge('b.service','a.service')]),'b.service');
 assert(result.paths.length);assert(result.paths.some(p=>p.stop==='cycle'&&p.edges.length>0));
 result=X.inspect(make(Array.from({length:6},(_,i)=>edge(`n${i+1}.service`,`n${i}.service`))),'n0.service');
 assert.equal(result.paths[0].stop,'depth-limit');assert.equal(result.paths[0].edges.length,4);
 result=X.inspect(make(Array.from({length:150},(_,i)=>edge(`parent${i}.target`,'root.service'))),'root.service');
 assert(result.truncated);assert(result.paths.length<=100);assert(result.terminationCounts['path-limit']>0);
 assert(result.paths.some(p=>p.stop==='path-limit'));
});
test('hardware limits expose unique boundary-node and edge omissions',()=>{
 const units=[{name:'root.target',unit_type:'target'},...Array.from({length:150},(_,i)=>({name:`d${i}.device`,unit_type:'device'}))];
 const relations=units.slice(1).map(u=>({from:'root.target',to:u.name,kind:'Wants',evidence:'effective'}));
 for(let i=0;i<49;i++) relations.push({from:`d${i}.device`,to:`d${i+1}.device`,kind:'Before',evidence:'effective'});
 const result=X.inspect(C.index({units,relations,timings:[],devices:[]}),'root.target');
 assert.equal(result.hardwareHiddenNodes,50);assert(result.hardwareHiddenEdges>=50);assert.equal(result.hardware.length,100);assert.equal(result.hardwareDirect.length,100);
});
test('hardware selection is deterministic, prioritizes direct links and excludes target hubs',()=>{
 const units=['app.service','hub.target','disk.device','data.mount','unrelated.device'].map(name=>({name,unit_type:name.split('.').pop()}));
 const edge=(from,to,kind)=>({from,to,kind,evidence:'effective'});
 const relations=[edge('app.service','hub.target','After'),edge('hub.target','unrelated.device','Wants'),edge('app.service','data.mount','Requires'),edge('data.mount','disk.device','BindsTo')];
 const index=r=>C.index({units,relations:r,timings:[],devices:[]});
 const a=X.inspect(index(relations),'app.service'),b=X.inspect(index([...relations].reverse()),'app.service');
 assert.deepEqual(a.hardware,b.hardware);assert.equal(a.hardwareDirect.length,1);assert.equal(a.hardwareIndirect[0].via,'data.mount');
 assert(!a.hardware.some(e=>e.to==='unrelated.device'));assert.equal(a.hardwareIndirect[0].connector.to,'data.mount');
});
test('sysfs aliases group without losing names, while unknown paths stay separate',()=>{
 const units=['a.device','b.device','unknown.device','other.device','data.mount'].map(name=>({name,unit_type:name.split('.').pop()}));
 const idx=C.index({units,relations:[],timings:[],devices:[]});
 const groups=X.devices(idx,[{unit:'a.device',sysfs_path:'/sys/fictitious/a'},{unit:'b.device',sysfs_path:'/sys/fictitious/a'}]);
 assert.equal(groups.length,4);assert.equal(groups.find(g=>g.path).units.length,2);
 assert.equal(X.condition({ConditionResult:'no',ConditionTimestampMonotonic:'0'},'Condition'),'No evaluation timestamp recorded');
 assert.equal(X.condition({ConditionResult:'no',ConditionTimestampMonotonic:'7'},'Condition'),'Latest recorded evaluation did not pass');
});
test('comparison combines request and normalized ordering evidence per neighbor',()=>{
 const units=['app.service','data.mount','parent.target'].map(name=>({name,unit_type:name.split('.').pop()}));
 const e=(from,to,kind,evidence='effective')=>({from,to,kind,evidence});
 const idx=C.index({units,timings:[],devices:[],relations:[e('app.service','data.mount','Requires'),e('app.service','data.mount','After'),e('data.mount','app.service','Before'),e('parent.target','app.service','Wants'),e('app.service','parent.target','Wants','install_hint')]});
 const rows=X.comparison(idx,'app.service'),mount=rows.find(r=>r.unit.name==='data.mount'),parent=rows.find(r=>r.unit.name==='parent.target');
 assert.equal(rows.length,2);assert.deepEqual(mount.requests,['Requires']);assert(mount.waitsFor);assert(!mount.waitedBy);assert.equal(mount.evidence.length,3);
 assert.deepEqual(parent.requests,[]);assert.deepEqual(parent.requestedBy,['Wants']);
 const filtered=X.inspect(idx,'data.mount',{hardwareQuery:'parent.target'});assert.equal(filtered.hardwareDirect.length,0);
 assert.match(X.startup('notify'),/not ongoing health/);
});
