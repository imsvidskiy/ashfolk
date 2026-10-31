const SIDE = 640, CELLS = SIDE * SIDE, PLANTS = 512000;
function mulberry(seed){let a=seed>>>0;return()=>{a=(a+0x6d2b79f5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
const random = mulberry(5);
function time(label, runs, body){let s=0;for(let i=0;i<5;i++)s+=body();const t=performance.now();for(let i=0;i<runs;i++)s+=body();console.log(`${label.padEnd(72)} ${((performance.now()-t)/runs*1000).toFixed(1).padStart(10)} us (${s%997})`);}
function makeLists(count){const first=new Int32Array(CELLS).fill(-1),next=new Int32Array(Math.max(1,count)).fill(-1),kind=new Uint8Array(Math.max(1,count));for(let i=0;i<count;i++){const c=Math.floor(random()*CELLS);next[i]=first[c];first[c]=i;kind[i]=Math.floor(random()*28);}return{first,next,kind};}
const plants = makeLists(PLANTS);
const buildings = makeLists(3000), monuments = makeLists(30), crossings = makeLists(200), deposits = makeLists(400);
class PlantSource{constructor(l){this.l=l;this.group=1;}forEachInCell(cell,v){const{first,next}=this.l;for(let i=first[cell];i!==-1;i=next[i])v.visit(this.group,i);}kindOf(i){return this.l.kind[i];}}
class ThingStoreSource{constructor(l,g){this.l=l;this.group=g;}forEachInCell(cell,v){const{first,next}=this.l;for(let i=first[cell];i!==-1;i=next[i])v.visit(this.group,i);}kindOf(i){return this.l.kind[i];}}
class MonumentSource{constructor(l){this.l=l;this.group=8;}forEachInCell(cell,v){for(let i=this.l.first[cell];i!==-1;i=this.l.next[i])v.visit(this.group,i);}kindOf(i){return 0;}}
class CrossingSource{constructor(l){this.l=l;this.group=16;}forEachInCell(cell,v){for(let i=this.l.first[cell];i!==-1;i=this.l.next[i])v.visit(this.group,i);}kindOf(i){return 0;}}
class DepositSource{constructor(l){this.l=l;this.group=32;}forEachInCell(cell,v){for(let i=this.l.first[cell];i!==-1;i=this.l.next[i])v.visit(this.group,i);}kindOf(i){return 0;}}
const sources=[new PlantSource(plants),new ThingStoreSource(buildings,2),new MonumentSource(monuments),new CrossingSource(crossings),new DepositSource(deposits)];
const footprint=[];for(let dz=-6;dz<=6;dz++)for(let dx=-6;dx<=6;dx++)if(dx*dx+dz*dz<=36)footprint.push(dz*SIDE+dx);
const WANT = new Uint8Array(28); for (let k=0;k<7;k++) WANT[k]=1;
const counter={n:0,visit(group,slot){if(group===1&&WANT[plants.kind[slot]]===1)this.n+=1;return true;}};
const other={n:0,visit(g,s){this.n+=g;return true;}}; const other2={n:0,visit(g,s){this.n^=s;return true;}}; const other3={n:0,visit(g,s){this.n-=1;return true;}};
for(let q=0;q<300;q++){for(const s of sources)for(const o of footprint){s.forEachInCell(200000+q*37+o,other);s.forEachInCell(200000+q*37+o,other2);s.forEachInCell(200000+q*37+o,other3);}}
time("count conifers: all 5 sources, virtual forEachInCell + megamorphic visitor",50,()=>{counter.n=0;for(let q=0;q<1000;q++){const c=200000+q*37;for(const s of sources)for(const o of footprint)s.forEachInCell(c+o,counter);}return counter.n;});
time("count conifers: filter.groups prunes to plant source, still virtual",50,()=>{counter.n=0;for(let q=0;q<1000;q++){const c=200000+q*37;for(const s of sources){if((s.group&1)===0)continue;for(const o of footprint)s.forEachInCell(c+o,counter);}}return counter.n;});
time("count conifers: specialised plant loop, species mask",50,()=>{let n=0;const{first,next,kind}=plants;for(let q=0;q<1000;q++){const c=200000+q*37;for(const o of footprint)for(let i=first[c+o];i!==-1;i=next[i])if(WANT[kind[i]]===1)n++;}return n;});
