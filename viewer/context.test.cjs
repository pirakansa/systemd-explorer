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
 assert.equal(result.hardwareHiddenNodes,51);assert.equal(result.hardwareHiddenEdges,48);assert.equal(result.hardware.length,100);
});
