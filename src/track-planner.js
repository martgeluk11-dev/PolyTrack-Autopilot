(() => {
  "use strict";

  const AXES = [
    [0, 1, 0], [0, -1, 0], [1, 0, 0],
    [-1, 0, 0], [0, 0, 1], [0, 0, -1]
  ];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist3 = (a, b) => Math.hypot(a[0]-b[0], a[1]-b[1], a[2]-b[2]);
  const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];

  function rotate(v, axis, turns) {
    const a = AXES[axis] || AXES[0];
    const angle = (turns & 3) * Math.PI / 2;
    const c = Math.cos(angle), s = Math.sin(angle);
    const d = dot(a, v), cross = [
      a[1]*v[2]-a[2]*v[1],
      a[2]*v[0]-a[0]*v[2],
      a[0]*v[1]-a[1]*v[0]
    ];
    return [
      v[0]*c + cross[0]*s + a[0]*d*(1-c),
      v[1]*c + cross[1]*s + a[1]*d*(1-c),
      v[2]*c + cross[2]*s + a[2]*d*(1-c)
    ];
  }

  function worldPoint(local, part) {
    const p = rotate(local, part.rotationAxis, part.rotation);
    return [p[0]+part.x*5, p[1]+part.y*5, p[2]+part.z*5];
  }

  function normalize(v) {
    const n = Math.hypot(v[0],v[1],v[2]) || 1;
    return [v[0]/n,v[1]/n,v[2]/n];
  }

  function makeSamples(parts, library, spacing, budget) {
    const points = [];
    const seen = new Set();
    let triangles = 0;
    for (const part of parts) {
      const shape = library[part.id];
      const vertices = shape?.vertices;
      if (!vertices || vertices.length < 9) continue;
      for (let k=0; k+8<vertices.length; k+=9) {
        const a = worldPoint([vertices[k],vertices[k+1],vertices[k+2]],part);
        const b = worldPoint([vertices[k+3],vertices[k+4],vertices[k+5]],part);
        const c = worldPoint([vertices[k+6],vertices[k+7],vertices[k+8]],part);
        const ab = [b[0]-a[0],b[1]-a[1],b[2]-a[2]];
        const ac = [c[0]-a[0],c[1]-a[1],c[2]-a[2]];
        const normal = normalize([
          ab[1]*ac[2]-ab[2]*ac[1],
          ab[2]*ac[0]-ab[0]*ac[2],
          ab[0]*ac[1]-ab[1]*ac[0]
        ]);
        const longest = Math.max(dist3(a,b),dist3(b,c),dist3(c,a));
        const steps = clamp(Math.ceil(longest/spacing),1,12);
        for(let i=0;i<=steps;i++) {
          for(let j=0;j<=steps-i;j++) {
            const u=i/steps, v=j/steps, w=1-u-v;
            const p=[
              a[0]*w+b[0]*u+c[0]*v,
              a[1]*w+b[1]*u+c[1]*v,
              a[2]*w+b[2]*u+c[2]*v
            ];
            const key=[
              Math.round(p[0]*1.6),Math.round(p[1]*1.6),
              Math.round(p[2]*1.6),Math.round(normal[0]*3),
              Math.round(normal[1]*3),Math.round(normal[2]*3)
            ].join(":");
            if(seen.has(key)) continue;
            seen.add(key);
            points.push({p,n:normal,edges:[]});
            if(points.length>budget) return {error:"Track surface is too large for the current browser memory budget.",points:[],triangles};
          }
        }
        triangles++;
      }
    }
    return {points,triangles};
  }

  function buildGraph(nodes, radius) {
    const cell=radius, buckets=new Map();
    const key=(x,y,z)=>Math.floor(x/cell)+","+Math.floor(y/cell)+","+Math.floor(z/cell);
    for(let i=0;i<nodes.length;i++){
      const p=nodes[i].p, k=key(...p);
      if(!buckets.has(k)) buckets.set(k,[]);
      buckets.get(k).push(i);
    }
    for(let i=0;i<nodes.length;i++){
      const node=nodes[i], p=node.p, cx=Math.floor(p[0]/cell),cy=Math.floor(p[1]/cell),cz=Math.floor(p[2]/cell);
      const candidates=[];
      for(let x=-1;x<=1;x++) for(let y=-1;y<=1;y++) for(let z=-1;z<=1;z++){
        const list=buckets.get((cx+x)+","+(cy+y)+","+(cz+z))||[];
        for(const j of list){
          if(j===i) continue;
          const other=nodes[j], d=dist3(p,other.p);
          if(d<0.25 || d>radius) continue;
          if(dot(node.n,other.n)<0.78) continue;
          const delta=[other.p[0]-p[0],other.p[1]-p[1],other.p[2]-p[2]];
          if(Math.abs(dot(delta,node.n))>Math.max(0.35,d*0.28)) continue;
          candidates.push([j,d]);
        }
      }
      candidates.sort((a,b)=>a[1]-b[1]);
      node.edges=candidates.slice(0,12);
    }
  }

  function detectorNodes(part, shape, nodes) {
    const detector=shape?.detector;
    if(!detector?.center || !detector?.size) return [];
    const center=worldPoint(detector.center,part);
    const half=detector.size.map(v=>Math.abs(v)*0.5+1.4);
    const result=[];
    for(let i=0;i<nodes.length;i++){
      const local=rotate([
        nodes[i].p[0]-part.x*5,
        nodes[i].p[1]-part.y*5,
        nodes[i].p[2]-part.z*5
      ],part.rotationAxis,(4-part.rotation)&3);
      const delta=rotate(detector.center,part.rotationAxis,part.rotation);
      if(Math.abs(local[0]-delta[0])<=half[0] &&
         Math.abs(local[1]-delta[1])<=half[1] &&
         Math.abs(local[2]-delta[2])<=half[2]) result.push(i);
    }
    if(!result.length){
      let best=-1,bd=Infinity;
      for(let i=0;i<nodes.length;i++){
        const d=dist3(nodes[i].p,center);
        if(d<bd){bd=d;best=i;}
      }
      if(best>=0 && bd<12) result.push(best);
    }
    return result;
  }

  class MinHeap {
    constructor(){this.a=[];}
    push(item){const a=this.a;a.push(item);let i=a.length-1;while(i){const p=(i-1)>>1;if(a[p][0]<=item[0])break;a[i]=a[p];i=p;}a[i]=item;}
    pop(){const a=this.a,top=a[0],last=a.pop();if(a.length){let i=0;while(true){let c=i*2+1;if(c>=a.length)break;if(c+1<a.length&&a[c+1][0]<a[c][0])c++;if(a[c][0]>=last[0])break;a[i]=a[c];i=c;}a[i]=last;}return top;}
    get size(){return this.a.length;}
  }

  function shortestPath(nodes,start,goals){
    const goalSet=new Set(goals), cost=new Float64Array(nodes.length).fill(Infinity);
    const previous=new Int32Array(nodes.length).fill(-1), heap=new MinHeap();
    cost[start]=0;heap.push([0,start]);let end=-1;
    while(heap.size){
      const [d,i]=heap.pop();if(d!==cost[i])continue;
      if(goalSet.has(i)){end=i;break;}
      for(const [j,length] of nodes[i].edges){
        const degree=Math.max(1,nodes[j].edges.length);
        const edgeCost=length*(1+2.5/degree);
        const next=d+edgeCost;
        if(next<cost[j]){cost[j]=next;previous[j]=i;heap.push([next,j]);}
      }
    }
    if(end<0)return null;
    const path=[];for(let i=end;i>=0;i=previous[i]){path.push(i);if(i===start)break;}
    if(path[path.length-1]!==start)return null;
    return path.reverse();
  }

  function nearest(nodes,position,maxDistance=20){
    let best=-1,bd=maxDistance;
    for(let i=0;i<nodes.length;i++){const d=dist3(nodes[i].p,position);if(d<bd){bd=d;best=i;}}
    return best;
  }

  function resample(nodes,path,step=2.5){
    const raw=path.map(i=>nodes[i]);
    if(raw.length<2)return [];
    const lengths=[0];
    for(let i=1;i<raw.length;i++)lengths.push(lengths[i-1]+dist3(raw[i-1].p,raw[i].p));
    const total=lengths[lengths.length-1], count=Math.max(2,Math.ceil(total/step)+1), out=[];
    let j=1;
    for(let i=0;i<count;i++){
      const d=total*i/(count-1);
      while(j<lengths.length-1 && lengths[j]<d)j++;
      const span=lengths[j]-lengths[j-1],t=span>1e-6?(d-lengths[j-1])/span:0;
      const a=raw[j-1],b=raw[j];
      out.push([
        a.p[0]+(b.p[0]-a.p[0])*t,
        a.p[1]+(b.p[1]-a.p[1])*t,
        a.p[2]+(b.p[2]-a.p[2])*t,
        ...normalize([
          a.n[0]+(b.n[0]-a.n[0])*t,
          a.n[1]+(b.n[1]-a.n[1])*t,
          a.n[2]+(b.n[2]-a.n[2])*t
        ])
      ]);
    }
    return out;
  }

  function build(decoded,geometry,startPosition,options={}){
    const parts=decoded?.track?.parts;
    if(!Array.isArray(parts)||!parts.length)return {ok:false,reason:"No decoded track blocks."};
    if(!geometry||!Object.keys(geometry).length)return {ok:false,reason:"The game has not supplied its 3D block geometry yet."};
    const spacing=options.spacing||2.6;
    const sampled=makeSamples(parts,geometry,spacing,options.nodeBudget||160000);
    if(sampled.error)return {ok:false,reason:sampled.error};
    const nodes=sampled.points;
    if(nodes.length<30)return {ok:false,reason:"Not enough road surface triangles were found. Check that the game track matches the pasted code."};
    buildGraph(nodes,Math.max(2.7,spacing*1.25));
    const start=nearest(nodes,startPosition,18);
    if(start<0)return {ok:false,reason:"Could not find a drivable surface near the car's starting position."};

    const checkpoints=parts.filter(p=>Number.isInteger(p.checkpointOrder))
      .sort((a,b)=>a.checkpointOrder-b.checkpointOrder);
    const unique=[];
    for(const p of checkpoints)if(!unique.some(q=>q.checkpointOrder===p.checkpointOrder))unique.push(p);
    const waypoints=[];
    for(const p of unique){
      const goals=detectorNodes(p,geometry[p.id],nodes);
      if(!goals.length)return {ok:false,reason:"Could not locate checkpoint "+p.checkpointOrder+" on the sampled road surface."};
      waypoints.push({name:"checkpoint "+(p.checkpointOrder+1),goals});
    }
    const finish=parts.find(p=>geometry[p.id]?.detector?.type===1) ||
      parts.find(p=>[6,74,76,78].includes(p.id));
    if(!finish)return {ok:false,reason:"No finish-line geometry was found."};
    const finishGoals=detectorNodes(finish,geometry[finish.id],nodes);
    if(!finishGoals.length)return {ok:false,reason:"Could not locate the finish on the sampled road surface."};
    waypoints.push({name:"finish",goals:finishGoals});

    const path=[];let cursor=start;
    for(const waypoint of waypoints){
      const segment=shortestPath(nodes,cursor,waypoint.goals);
      if(!segment)return {ok:false,reason:"No continuous drivable surface found to "+waypoint.name+". A jump/loop transition may need a physics-aware connection."};
      path.push(...(path.length?segment.slice(1):segment));
      cursor=segment[segment.length-1];
    }
    const route=resample(nodes,path,options.routeSpacing||2.5);
    if(route.length<5)return {ok:false,reason:"Generated route is too short to drive."};
    return {
      ok:true,route,
      stats:{
        sampledTriangles:sampled.triangles,
        surfaceNodes:nodes.length,
        routePoints:route.length,
        routeLengthM:Number(route.reduce((sum,p,i)=>i?sum+dist3(route[i-1],p):0,0).toFixed(1)),
        checkpoints:unique.length,
        jumpTransitions:0,
        planner:"3D triangle-surface graph / clearance-weighted shortest path"
      }
    };
  }

  window.PTAPTrackPlanner=Object.freeze({build});
})();