const {test}=require('node:test'),assert=require('node:assert/strict');
const C=require('./core.js'), X=require('./context.js');
test('request paths and normalized ordering remain separate; cycles terminate',()=>{
 const edge=(from,to,kind,evidence='effective')=>({from,to,kind,evidence});
 const data={units:['a.target','b.service','c.device'].map(name=>({name,unit_type:name.split('.').pop()})),timings:[],devices:[],relations:[edge('a.target','b.service','Wants'),edge('b.service','c.device','After'),edge('c.device','b.service','Before'),edge('b.service','a.target','Requires'),edge('a.target','c.device','Wants','install_hint')]};
 const result=X.inspect(C.index(data),'b.service');assert(result.truncated);assert.equal(result.waits.length,1);assert.equal(result.waits[0].unit,'c.device');assert(result.hardware.length);assert(!result.paths.some(p=>p.edges.some(e=>e.kind==='After')));
});
