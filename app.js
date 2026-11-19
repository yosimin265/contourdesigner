(function(){
  'use strict';
  const C=window.ContourCore,F=window.ContourFiles,$=id=>document.getElementById(id);
  const canvas=$('map'),ctx=canvas.getContext('2d'),preview=$('preview');
  const KEY='contour-designer-standalone-v1',MAX_LINES=32,MAX_NODES=96,MAX_PINS=64;
  const copy=x=>JSON.parse(JSON.stringify(x)),clamp=(x,a,b)=>Math.max(a,Math.min(b,x)),num=(id)=>Number($(id).value);
  const uid=()=>globalThis.crypto?.randomUUID?.()||'c-'+Date.now()+'-'+Math.random().toString(16).slice(2);
  const initial=()=>({schema:'tsukuyomi.contour-design',version:1,name:'丘と水辺の高さ設計',image:copy(window.CONTOUR_DEFAULT_IMAGE),sourceKind:'concept',frame:{u0:0,v0:0,u1:1,v1:1},bounds:{xMin:-80,xMax:80,zMin:-50,zMax:50},baseHeight:0,interval:2,contours:[],pins:[],raw:{min:-8,max:16,size:257}});
  let project=initial(),image=new Image(),mode='select',selected=null,draft=[],gesture=null,space=false;
  let extending=null,snapTarget=null;
  let view={zoom:1,x:0,y:0},size={w:800,h:580,dpr:1},fitRect={x:0,y:0,w:1,h:1};
  let history=[],future=[],revision=0,issues=[],previewData=null,previewRevision=-1,saveTimer,toastTimer,drawQueued=false,busy=false;

  function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4300);}
  function fail(error){console.error(error);toast(error.message||String(error));}
  function selection(){return project.contours.find(c=>c.id===selected)||project.pins.find(c=>c.id===selected);}
  function snapshot(){const p=copy(project);delete p.image;return JSON.stringify(p);}
  function restore(s){const img=project.image;project={...JSON.parse(s),image:img};selected=null;setMode('select');changed(false);}
  function remember(s=snapshot()){history.push(s);if(history.length>40)history.shift();future=[];}
  function change(fn){remember();fn();changed();}
  function changed(autosave=true){revision++;sync();requestDraw();if(autosave)scheduleSave();}
  function scheduleSave(){clearTimeout(saveTimer);$('saveState').textContent='保存待ち';saveTimer=setTimeout(()=>{try{localStorage.setItem(KEY,JSON.stringify(project));$('saveState').textContent='端末内に自動保存済み';}catch(_){$('saveState').textContent='端末保存の容量不足 · 設計をファイル保存してください';}},450);}
  function levels(){const a=[project.baseHeight,...project.contours.map(c=>c.height),...project.pins.map(p=>p.height)];return {min:Math.min(...a),max:Math.max(...a)};}
  function rgb(h,range=levels()){const t=range.max===range.min ? .5 : clamp((h-range.min)/(range.max-range.min),0,1);const stops=[[80,117,182],[96,177,177],[171,195,107],[226,151,76]];const s=t*3,i=Math.min(2,Math.floor(s)),f=s-i;return stops[i].map((n,k)=>Math.round(n+(stops[i+1][k]-n)*f));}
  function color(h){return 'rgb('+rgb(h).join(',')+')';}
  function itemLabel(item){return item.name||(item.points?'等高線':'高さの点');}
  function validBounds(){const b=project.bounds,f=project.frame;return [b.xMin,b.xMax,b.zMin,b.zMax,f.u0,f.v0,f.u1,f.v1,project.baseHeight].every(Number.isFinite)&&b.xMax>b.xMin&&b.zMax>b.zMin&&f.u1>f.u0&&f.v1>f.v0;}
  function validate(){issues=C.validate(project.contours,project.pins);if(!validBounds())issues.push({message:'ゲーム座標・地図範囲の大小関係を確認してください。',ids:[]});return issues;}
  function sync(){
    validate();
    for(const [id,key] of [['projectName','name'],['baseHeight','baseHeight'],['interval','interval']])$(id).value=project[key];
    for(const id of ['xMin','xMax','zMin','zMax'])$(id).value=project.bounds[id];
    $('rawMin').value=project.raw.min;$('rawMax').value=project.raw.max;$('rawSize').value=project.raw.size;$('topDown').checked=project.sourceKind==='topdown';
    $('nextLevel').textContent='次の高さ ＋'+project.interval+'m';$('undo').disabled=!history.length;$('redo').disabled=!future.length;
    $('imageName').textContent=project.image?.name||'地図';$('itemCount').textContent=project.contours.length+project.pins.length;
    $('emptyState').hidden=Boolean(project.contours.length+project.pins.length);
    const list=$('lineList');list.replaceChildren();
    for(const item of [...project.contours,...project.pins]){
      const b=document.createElement('button');b.className='line-row';b.setAttribute('aria-pressed',String(item.id===selected));
      const sw=document.createElement('span');sw.className='swatch'+(!item.points?' pin-swatch':'');sw.style.background=color(item.height);
      const name=document.createElement('span');name.className='row-name';name.textContent=itemLabel(item);
      const height=document.createElement('span');height.className='row-height';height.textContent=item.height+' m';b.append(sw,name,height);
      b.onclick=()=>{selected=item.id;setMode('select');sync();requestDraw();};list.append(b);
    }
    const item=selection();$('selection').hidden=!item;
    if(item){$('itemName').value=itemLabel(item);$('itemHeight').value=item.height;$('smoothing').value=item.smooth||0;$('smoothing').disabled=!item.points;}
    $('openLineTools').hidden=!(item?.points&&!item.closed);
    const box=$('validation');box.replaceChildren();
    if(issues.length){for(const issue of issues.slice(0,8)){const p=document.createElement('p');p.className='issue';p.textContent=issue.message;box.append(p);}}
    else{const p=document.createElement('p');p.className='ok';p.textContent=project.contours.length+project.pins.length?'高さの矛盾・線の交差は見つかりません。':'線または高さの点を追加してください。';box.append(p);}
    $('projectionNote').classList.toggle('calibrated',project.sourceKind==='topdown');
    $('projectionNote').textContent=project.sourceKind==='topdown'?'真上からの図として範囲合わせ済み。画像の上が北（+Z）、下が南です。':'斜めの参考画像は、構想のための下図です。画像の遠近だけから実際の地形高を自動測定するものではありません。';
    const outside=[...project.contours.flatMap(c=>C.curvePoints(c)),...project.pins].some(p=>p.x<project.frame.u0||p.x>project.frame.u1||p.y<project.frame.v0||p.y>project.frame.v1);
    const heights=levels(),rangeGood=project.raw.max>project.raw.min&&heights.min>=project.raw.min&&heights.max<=project.raw.max;
    $('exportRaw').disabled=busy||project.sourceKind!=='topdown'||issues.length>0||outside||!rangeGood;
    $('rawHelp').textContent=project.sourceKind!=='topdown'?'真上からの図の確認後に利用できます。':issues.length?'設計の矛盾を直してから保存してください。':outside?'地図の範囲外に線または点があります。範囲を合わせてください。':!rangeGood?'最低高・最高高の間に、すべての設計高さを含めてください。':'RAW16と座標・高さの情報を、1つのZIPで保存します。';
    if(previewRevision!==revision&&previewData)$('previewState').textContent='設計が変わりました。「高さを確認」で更新します。';
  }
  function setMode(m){mode=m;draft=[];gesture=null;extending=null;snapTarget=null;$('closedLine').disabled=false;$('newHeight').disabled=false;document.querySelectorAll('[data-mode]').forEach(b=>{b.classList.toggle('active',b.dataset.mode===m);b.setAttribute('aria-pressed',String(b.dataset.mode===m));});$('drawOptions').hidden=m!=='draw';$('modeHelp').textContent={select:'線を選んで形を調整。開いた線は、端から描き足したり連結できます。',draw:'点を置いて確定。短い線は「閉じた線」を外すと、端点を吸着・連結できます。',pin:'地図をクリックし、その場所の高さを指定します。',frame:'ゲーム座標に対応させる地図の範囲を、ドラッグして囲みます。',pan:'ドラッグで移動。ホイールで拡大・縮小できます。'}[m];canvas.style.cursor=m==='pan'?'grab':m==='select'?'default':'crosshair';requestDraw();}
  function requestDraw(){if(!drawQueued){drawQueued=true;requestAnimationFrame(()=>{drawQueued=false;draw();});}}
  function toPixel(p){return{x:fitRect.x+p.x*fitRect.w,y:fitRect.y+p.y*fitRect.h};}
  function fromEvent(e,limit=false){const b=canvas.getBoundingClientRect(),x=(e.clientX-b.left-fitRect.x)/fitRect.w,y=(e.clientY-b.top-fitRect.y)/fitRect.h;return{x:limit?clamp(x,0,1):x,y:limit?clamp(y,0,1):y};}
  function within(p){return p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1;}
  function screenDistance(a,b){return Math.hypot((a.x-b.x)*fitRect.w,(a.y-b.y)*fitRect.h);}
  function nearestEndpoint(p,height,exclude=null){
    if(!$('snapEndpoints').checked)return null;
    let best=null;
    for(const line of project.contours){if(line.closed||line.id===exclude||Math.abs(line.height-height)>1e-6)continue;for(const index of [0,line.points.length-1]){const point=line.points[index],distance=screenDistance(p,point);if(distance<=14&&(!best||distance<best.distance))best={id:line.id,index,point,distance,height};}}
    return best;
  }
  function snapped(p,height,exclude=null){snapTarget=nearestEndpoint(p,height,exclude);return snapTarget?{...snapTarget.point}:p;}
  function path(target,line){const pts=C.curvePoints(line);if(!pts.length)return;let a=target(pts[0]);ctx.beginPath();ctx.moveTo(a.x,a.y);for(const p of pts.slice(1)){a=target(p);ctx.lineTo(a.x,a.y);}if(line.closed)ctx.closePath();}
  function renderLines(context,transform,scale=1,nodes=true){
    // Same sampled paths are used in the viewport, validation and exported image.
    context.lineJoin='round';context.lineCap='round';
    for(const line of project.contours){const pts=C.curvePoints(line);if(!pts.length)continue;const selectedLine=line.id===selected,bad=issues.some(i=>i.ids.includes(line.id));context.beginPath();let p=transform(pts[0]);context.moveTo(p.x,p.y);for(const v of pts.slice(1)){p=transform(v);context.lineTo(p.x,p.y);}if(line.closed)context.closePath();context.strokeStyle='rgba(12,20,36,.75)';context.lineWidth=(selectedLine?5:4)*scale;context.stroke();context.strokeStyle=bad?'#ff707b':color(line.height);context.lineWidth=(selectedLine?2.6:1.9)*scale;context.stroke();
      const label=transform(pts[0]);context.font='600 '+12*scale+'px sans-serif';context.textAlign='left';context.textBaseline='bottom';context.lineJoin='round';context.lineWidth=4*scale;context.strokeStyle='#16212d';context.strokeText(line.height+' m',label.x+9*scale,label.y-6*scale);context.fillStyle=bad?'#ff9c9c':'#f4f6ff';context.fillText(line.height+' m',label.x+9*scale,label.y-6*scale);
      if(nodes&&selectedLine&&$('showNodes').checked)for(const v of line.points){const p=transform(v);context.beginPath();context.arc(p.x,p.y,4.3*scale,0,Math.PI*2);context.fillStyle='#fff';context.fill();context.strokeStyle='#526ab4';context.lineWidth=1.5*scale;context.stroke();}
      if(nodes&&!line.closed&&(selectedLine||mode==='draw'))for(const [i,v] of [[0,line.points[0]],[1,line.points[line.points.length-1]]]){const p=transform(v);context.beginPath();context.arc(p.x,p.y,6*scale,0,Math.PI*2);context.fillStyle=i?'#edb66e':'#8fdbbd';context.fill();context.strokeStyle='#15273d';context.lineWidth=2*scale;context.stroke();}
    }
    for(const pin of project.pins){const p=transform(pin);context.beginPath();context.arc(p.x,p.y,(pin.id===selected?6:4.5)*scale,0,Math.PI*2);context.fillStyle=color(pin.height);context.fill();context.strokeStyle='#fff';context.lineWidth=2*scale;context.stroke();context.font='600 '+12*scale+'px sans-serif';context.textAlign='left';context.textBaseline='bottom';context.lineWidth=4*scale;context.strokeStyle='#16212d';context.strokeText(pin.height+' m',p.x+9*scale,p.y-5*scale);context.fillStyle='#fff';context.fillText(pin.height+' m',p.x+9*scale,p.y-5*scale);}
  }
  function draw(){
    ctx.setTransform(size.dpr,0,0,size.dpr,0,0);ctx.clearRect(0,0,size.w,size.h);ctx.fillStyle='#151f2b';ctx.fillRect(0,0,size.w,size.h);
    if(!image.complete||!image.naturalWidth)return;
    const factor=Math.min((size.w-34)/image.naturalWidth,(size.h-34)/image.naturalHeight)*view.zoom;
    fitRect={w:image.naturalWidth*factor,h:image.naturalHeight*factor};fitRect.x=(size.w-fitRect.w)/2+view.x;fitRect.y=(size.h-fitRect.h)/2+view.y;
    ctx.globalAlpha=num('imageOpacity');ctx.drawImage(image,fitRect.x,fitRect.y,fitRect.w,fitRect.h);ctx.globalAlpha=1;
    if($('showHeat').checked&&previewData&&previewRevision===revision){const f=project.frame,a=toPixel({x:f.u0,y:f.v0}),b=toPixel({x:f.u1,y:f.v1});ctx.globalAlpha=.37;ctx.drawImage(previewData.heat,a.x,a.y,b.x-a.x,b.y-a.y);ctx.globalAlpha=1;}
    const frame=gesture?.type==='frame'?{u0:Math.min(gesture.start.x,gesture.now.x),v0:Math.min(gesture.start.y,gesture.now.y),u1:Math.max(gesture.start.x,gesture.now.x),v1:Math.max(gesture.start.y,gesture.now.y)}:project.frame;
    const a=toPixel({x:frame.u0,y:frame.v0}),b=toPixel({x:frame.u1,y:frame.v1});ctx.setLineDash([6,5]);ctx.strokeStyle='rgba(210,210,255,.65)';ctx.lineWidth=1;ctx.strokeRect(a.x,a.y,b.x-a.x,b.y-a.y);ctx.setLineDash([]);
    renderLines(ctx,toPixel,1,true);
    const points=gesture?.type==='free'?gesture.points:draft;
    if(points.length){const guide=C.curvePoints({points,closed:false,smooth:.8});ctx.beginPath();let p=toPixel(guide[0]);ctx.moveTo(p.x,p.y);for(const v of guide.slice(1)){p=toPixel(v);ctx.lineTo(p.x,p.y);}ctx.strokeStyle=color(num('newHeight'));ctx.lineWidth=2;ctx.setLineDash([5,3]);ctx.stroke();ctx.setLineDash([]);for(const v of [points[0],points[points.length-1]]){p=toPixel(v);ctx.beginPath();ctx.arc(p.x,p.y,4,0,Math.PI*2);ctx.fillStyle='#fff';ctx.fill();}}
    if(snapTarget){const p=toPixel(snapTarget.point);ctx.beginPath();ctx.arc(p.x,p.y,11,0,Math.PI*2);ctx.strokeStyle='#a7f2dc';ctx.lineWidth=2;ctx.stroke();ctx.font='600 11px sans-serif';ctx.textAlign='left';ctx.textBaseline='bottom';ctx.lineWidth=4;ctx.strokeStyle='#15273d';const label=snapTarget.height+' m の端点に吸着';const x=Math.min(p.x+15,size.w-135),y=Math.max(24,p.y-12);ctx.strokeText(label,x,y);ctx.fillStyle='#c8ffef';ctx.fillText(label,x,y);}
  }
  function hit(p){const item=selection();if(item?.points&&$('showNodes').checked){for(let i=0;i<item.points.length;i++)if(screenDistance(p,item.points[i])<10)return{item,index:i};}
    for(const pin of [...project.pins].reverse())if(screenDistance(p,pin)<11)return{item:pin,index:-1};
    for(const line of [...project.contours].reverse()){const pts=C.curvePoints(line);for(let i=0,n=line.closed?pts.length:pts.length-1;i<n;i++){const a=toPixel(p),b=toPixel(pts[i]),c=toPixel(pts[(i+1)%pts.length]);if(C.closestPoint(a,b,c).distance<8)return{item:line,index:null};}}
    return null;
  }
  canvas.addEventListener('pointerdown',e=>{if(e.button!==0)return;canvas.focus({preventScroll:true});const p=fromEvent(e);canvas.setPointerCapture(e.pointerId);
    if(space||mode==='pan'){gesture={type:'pan',x:e.clientX,y:e.clientY,oldX:view.x,oldY:view.y};return;}
    if(!within(p))return;
    if(mode==='draw'){
      if(project.contours.length>=MAX_LINES&&!extending){toast('等高線は32本までです。設計を分けて保存してください。');return;}
      const point=snapped(p,num('newHeight'),extending?.id);
      if($('drawStyle').value==='freehand'){gesture={type:'free',points:extending?[draft[0],point]:[point]};}
      else{if($('closedLine').checked&&draft.length>=3&&screenDistance(p,draft[0])<12){finish(true);return;}if(!draft.length||screenDistance(point,draft[draft.length-1])>4)draft.push(point);if(draft.length>MAX_NODES)draft.pop();requestDraw();}
    }else if(mode==='pin'){if(project.pins.length>=MAX_PINS)return toast('高さの点は64個までです。');change(()=>{const pin={id:uid(),name:'高さの点 '+(project.pins.length+1),x:p.x,y:p.y,height:num('newHeight')};project.pins.push(pin);selected=pin.id;});setMode('select');}
    else if(mode==='frame')gesture={type:'frame',start:p,now:p,before:snapshot()};
    else{const found=hit(p);selected=found?.item.id||null;snapTarget=null;if(found&&found.index!==null){gesture={type:'node',id:selected,index:found.index,before:snapshot()};if(found.item.points)$('extendEnd').value=found.index===0?'start':'end';}sync();requestDraw();}
  });
  canvas.addEventListener('pointermove',e=>{const p=fromEvent(e,true);if(within(fromEvent(e))){try{const w=C.imageToWorld(p,project.frame,project.bounds);$('position').textContent='X '+w.x.toFixed(1)+' / Z '+w.z.toFixed(1)+(project.sourceKind==='concept'?'（仮）':'');}catch(_){$('position').textContent='範囲を確認';}}
    if(!gesture){if(mode==='draw'){snapTarget=within(fromEvent(e))?nearestEndpoint(p,num('newHeight'),extending?.id):null;requestDraw();}return;}
    if(gesture.type==='pan'){view.x=gesture.oldX+e.clientX-gesture.x;view.y=gesture.oldY+e.clientY-gesture.y;}
    else if(gesture.type==='frame')gesture.now=p;
    else if(gesture.type==='free'){const a=gesture.points;if(a.length<2000&&screenDistance(p,a[a.length-1])>4)a.push(p);}
    else if(gesture.type==='node'){const item=selection();if(!item)return;if(gesture.index<0){item.x=p.x;item.y=p.y;}else{const end=!item.closed&&(gesture.index===0||gesture.index===item.points.length-1);item.points[gesture.index]=end?snapped(p,item.height,item.id):p;}}
    requestDraw();
  });
  canvas.addEventListener('pointerup',()=>{if(!gesture)return;const g=gesture;gesture=null;
    if(g.type==='free'){draft=g.points;draft[draft.length-1]=snapped(draft[draft.length-1],num('newHeight'),extending?.id);finish($('closedLine').checked);}
    else if(g.type==='frame'){const f={u0:Math.min(g.start.x,g.now.x),v0:Math.min(g.start.y,g.now.y),u1:Math.max(g.start.x,g.now.x),v1:Math.max(g.start.y,g.now.y)};if(f.u1-f.u0>.04&&f.v1-f.v0>.04){remember(g.before);project.frame=f;changed();}else{toast('もう少し大きな範囲を囲んでください。');requestDraw();}}
    else if(g.type==='node'){snapTarget=null;if(snapshot()!==g.before){remember(g.before);changed();}else requestDraw();}
  });
  canvas.addEventListener('pointercancel',()=>{if(gesture?.before)restore(gesture.before);setMode('select');});
  canvas.addEventListener('dblclick',e=>{if(mode==='draw'&&$('drawStyle').value==='points'){e.preventDefault();finish($('closedLine').checked);}});
  function zoom(mult,anchor={x:size.w/2,y:size.h/2}){const z=clamp(view.zoom*mult,.35,8),ratio=z/view.zoom;view.x=anchor.x-size.w/2-(anchor.x-size.w/2-view.x)*ratio;view.y=anchor.y-size.h/2-(anchor.y-size.h/2-view.y)*ratio;view.zoom=z;requestDraw();}
  canvas.addEventListener('wheel',e=>{e.preventDefault();const b=canvas.getBoundingClientRect();zoom(Math.exp(-e.deltaY*.0015),{x:e.clientX-b.left,y:e.clientY-b.top});},{passive:false});
  function finish(closed=$('closedLine').checked){if(draft.length<(closed?3:2)){toast(closed?'閉じた線には3点以上置いてください。':'線には2点以上置いてください。');return;}
    let points=draft.map(p=>({...p})),t=.0012;points=C.simplify(points,t);while(points.length>MAX_NODES){t*=1.4;points=C.simplify(draft,t);}if(closed&&points.length>3&&screenDistance(points[0],points[points.length-1])<7)points.pop();
    if(points.length<(closed?3:2))return toast('線が短すぎます。もう少し大きく描いてください。');
    const h=num('newHeight');if(!Number.isFinite(h)||h< -100||h>200)return toast('高さは−100〜200mで指定してください。');
    const source=extending&&project.contours.find(c=>c.id===extending.id);
    if(source){points=extending.end==='start'?points.slice(1).reverse().concat(source.points):source.points.concat(points.slice(1));if(points.length>MAX_NODES)return toast('1本の線は96点までです。別の短い線として描いてください。');}
    change(()=>{if(source){source.points=points;selected=source.id;}else{const c={id:uid(),name:'等高線 '+(project.contours.length+1),height:h,closed,points,smooth:.8};project.contours.push(c);selected=c.id;}});setMode('select');}
  document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>setMode(b.dataset.mode));
  $('finishLine').onclick=()=>finish();$('cancelLine').onclick=()=>setMode('select');
  $('snapEndpoints').onchange=()=>{snapTarget=null;requestDraw();};
  $('continueLine').onclick=()=>{const item=selection();if(!item?.points||item.closed)return;const end=$('extendEnd').value;setMode('draw');extending={id:item.id,end};draft=[{...item.points[end==='start'?0:item.points.length-1]}];$('closedLine').checked=false;$('closedLine').disabled=true;$('newHeight').value=item.height;$('newHeight').disabled=true;$('modeHelp').textContent=itemLabel(item)+' の'+(end==='start'?'始点':'終点')+'から描き足し中。点を追加し「線を確定」。Escで取り消し。';requestDraw();};
  $('joinLines').onclick=()=>{const item=selection();if(!item?.points||item.closed)return;
    let candidate=null;
    for(const line of project.contours){if(line.id===item.id||line.closed||Math.abs(line.height-item.height)>1e-6)continue;for(const a of [item.points[0],item.points[item.points.length-1]])for(const b of [line.points[0],line.points[line.points.length-1]]){const distance=screenDistance(a,b);if(distance<=18&&(!candidate||distance<candidate.distance))candidate={line,distance};}}
    if(!candidate)return toast('同じ高さの線の端を近づけてください。端点をドラッグすると吸着します。');
    try{const a=project.contours,b=candidate.line,result=C.joinOpenContours(item,b,{maxGap:Math.hypot(18/fitRect.w,18/fitRect.h)}),merged=a.filter(c=>c.id!==b.id).map(c=>c.id===item.id?result.contour:c),problems=C.validate(merged,project.pins).filter(i=>i.ids.includes(item.id));if(problems.length)throw new Error(problems[0].message);change(()=>{project.contours=merged;selected=item.id;});toast('同じ高さの2本を、1本の滑らかな線に連結しました。');}catch(e){toast(e.message);}
  };
  $('undo').onclick=()=>{if(!history.length)return;future.push(snapshot());const s=history.pop();restore(s);scheduleSave();};
  $('redo').onclick=()=>{if(!future.length)return;history.push(snapshot());restore(future.pop());scheduleSave();};
  $('zoomIn').onclick=()=>zoom(1.25);$('zoomOut').onclick=()=>zoom(.8);$('fit').onclick=()=>{view={zoom:1,x:0,y:0};requestDraw();};
  function updateItemName(){const item=selection(),name=$('itemName').value.slice(0,60);if(item&&item.name!==name)change(()=>item.name=name);}
  $('itemName').oninput=updateItemName;$('itemName').onchange=updateItemName;
  function updateItemHeight(){const item=selection(),h=num('itemHeight');if($('itemHeight').value.trim()==='')return;if(item&&Number.isFinite(h)&&h>=-100&&h<=200&&item.height!==h)change(()=>item.height=h);}
  $('itemHeight').oninput=updateItemHeight;$('itemHeight').onchange=()=>{updateItemHeight();sync();};
  $('smoothing').onchange=()=>{const item=selection();if(item?.points)change(()=>item.smooth=num('smoothing'));};
  function remove(){if(!selected)return;change(()=>{project.contours=project.contours.filter(x=>x.id!==selected);project.pins=project.pins.filter(x=>x.id!==selected);selected=null;});}
  $('deleteItem').onclick=remove;$('duplicate').onclick=()=>{const item=selection();if(!item)return;if(item.points&&project.contours.length>=MAX_LINES)return;change(()=>{const clone=copy(item);clone.id=uid();clone.name=itemLabel(item)+' 複製';if(clone.points){clone.points=clone.points.map(p=>({x:clamp(p.x+.025,0,1),y:clamp(p.y+.025,0,1)}));project.contours.push(clone);}else{clone.x=clamp(clone.x+.025,0,1);clone.y=clamp(clone.y+.025,0,1);project.pins.push(clone);}selected=clone.id;});};
  $('nextLevel').onclick=()=>{$('newHeight').value=clamp(num('newHeight')+project.interval,-100,200);setMode('draw');};
  $('interval').onchange=()=>{const n=num('interval');if(n>=.5&&n<=20)change(()=>project.interval=n);else sync();};
  $('baseHeight').onchange=()=>{const n=num('baseHeight');if(Number.isFinite(n)&&n>=-100&&n<=200)change(()=>project.baseHeight=n);else sync();};
  function updateProjectName(){const name=$('projectName').value.slice(0,80);if(project.name!==name)change(()=>project.name=name);}
  $('projectName').oninput=updateProjectName;$('projectName').onchange=updateProjectName;
  for(const id of ['xMin','xMax','zMin','zMax'])$(id).onchange=()=>{const n=num(id);if(Number.isFinite(n)&&Math.abs(n)<=1e6)change(()=>project.bounds[id]=n);else sync();};
  for(const [id,key] of [['rawMin','min'],['rawMax','max'],['rawSize','size']])$(id).onchange=()=>{const n=num(id);if(Number.isFinite(n))change(()=>project.raw[key]=n);else sync();};
  $('topDown').onchange=()=>change(()=>project.sourceKind=$('topDown').checked?'topdown':'concept');
  $('imageOpacity').oninput=requestDraw;$('showNodes').onchange=requestDraw;$('showHeat').onchange=()=>{if($('showHeat').checked&&previewRevision!==revision)makePreview();requestDraw();};
  function sampler(p=project){const f=p.frame,b=p.bounds;return C.prepare(p.contours,p.pins,p.baseHeight,{scaleX:(b.xMax-b.xMin)/(f.u1-f.u0),scaleY:(b.zMax-b.zMin)/(f.v1-f.v0)});}
  function makePreview(){try{if(validate().length)throw new Error(issues[0].message);const prepared=sampler(),grid=C.sampleGrid(prepared,project.frame,65),range={min:Math.min(...grid,levels().min),max:Math.max(...grid,levels().max)},heat=document.createElement('canvas');heat.width=heat.height=65;const h=heat.getContext('2d'),pixels=h.createImageData(65,65);grid.forEach((v,i)=>{const c=rgb(v,range);pixels.data.set([...c,255],i*4);});h.putImageData(pixels,0,0);previewData={grid,range,heat};previewRevision=revision;renderPreview();$('previewState').textContent='色分け（左）と立体の概略（右） · 線間は暫定補間';$('maxLegend').textContent=range.max.toFixed(1)+' m';$('minLegend').textContent=range.min.toFixed(1)+' m';requestDraw();}catch(e){fail(e);}}
  function renderPreview(){const p=preview.getContext('2d'),w=preview.width,h=preview.height;p.clearRect(0,0,w,h);p.fillStyle='#f2f5fa';p.fillRect(0,0,w,h);if(!previewData){p.fillStyle='#7c899d';p.font='13px sans-serif';p.textAlign='center';p.fillText('「高さを確認」で表示',w/2,h/2);return;}
    const {grid,range,heat}=previewData;p.imageSmoothingEnabled=true;p.drawImage(heat,16,14,230,212);const iso=(col,row,z)=>({x:425+(col-row)*2.05,y:95+(col+row)*.8-(z-range.min)*Math.min(9,80/Math.max(1,range.max-range.min))});
    for(let row=0;row<64;row+=2)for(let col=0;col<64;col+=2){const vertices=[[col,row],[col+2,row],[col+2,row+2],[col,row+2]],values=vertices.map(([x,y])=>grid[y*65+x]);p.beginPath();vertices.forEach(([x,y],i)=>{const a=iso(x,y,values[i]);i?p.lineTo(a.x,a.y):p.moveTo(a.x,a.y);});p.closePath();p.fillStyle='rgb('+rgb(values.reduce((s,n)=>s+n,0)/4,range).join(',')+')';p.fill();p.strokeStyle='rgba(45,61,83,.12)';p.lineWidth=.4;p.stroke();}}
  $('makePreview').onclick=makePreview;
  function safeName(){return(project.name.replace(/[^\p{L}\p{N}_-]+/gu,'-').slice(0,60)||'contour-map');}
  function download(data,name,type){const blob=data instanceof Blob?data:new Blob([data],{type}),a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);}
  function exportProject(){const p=copy(project);p.updatedAt=new Date().toISOString();p.coordinateMapping={status:p.sourceKind==='topdown'?'user-declared-topdown':'concept-only',units:'metres',imageTopWorldDirection:'+Z',frame:p.frame,bounds:p.bounds};p.validation=C.validate(p.contours,p.pins);if(validBounds())p.contourWorldPoints=p.contours.map(c=>({id:c.id,height:c.height,closed:c.closed,points:C.curvePoints(c).map(v=>({...C.imageToWorld(v,p.frame,p.bounds),y:c.height}))}));return p;}
  $('saveProject').onclick=()=>{download(JSON.stringify(exportProject(),null,2),safeName()+'.contours.json','application/json');toast('背景画像を含む設計JSONを保存しました。');};
  $('exportPng').onclick=()=>{if(!image.complete)return;const out=document.createElement('canvas'),max=2048,factor=Math.min(1,max/image.naturalWidth,max/image.naturalHeight),w=Math.round(image.naturalWidth*factor),h=Math.round(image.naturalHeight*factor),g=out.getContext('2d');out.width=w;out.height=h+60;g.drawImage(image,0,0,w,h);renderLines(g,v=>({x:v.x*w,y:v.y*h}),Math.max(.8,w/1000),false);g.fillStyle='#152132';g.fillRect(0,h,w,60);g.fillStyle='#eff3fb';g.font=Math.max(11,w/85)+'px sans-serif';g.textAlign='left';g.textBaseline='middle';g.fillText(project.name+' · 単位 m · '+(project.sourceKind==='concept'?'参考画像上の設計案':'真上図・座標範囲設定済み'),16,h+22);g.fillStyle='#b1c0d4';g.font=Math.max(10,w/105)+'px sans-serif';g.fillText('基準高 '+project.baseHeight+'m  /  線間は暫定補間  /  '+(issues.length?'矛盾のある線を含む':'地形へ未適用'),16,h+43);out.toBlob(b=>{if(b)download(b,safeName()+'-contours.png','image/png');},'image/png');};
  $('exportRaw').onclick=async()=>{if($('exportRaw').disabled)return;const startRevision=revision,p=copy(project);busy=true;sync();$('exportRaw').textContent='高さマップを作成中…';try{const prepared=sampler(p),n=p.raw.size,grid=new Float64Array(n*n);for(let row=0;row<n;row++){const v=p.frame.v0+(p.frame.v1-p.frame.v0)*row/(n-1);for(let col=0;col<n;col++)grid[row*n+col]=prepared.sample(p.frame.u0+(p.frame.u1-p.frame.u0)*col/(n-1),v);if(row%8===0){$('exportRaw').textContent='作成中 '+Math.round(row/n*100)+'%';await new Promise(r=>setTimeout(r,0));if(revision!==startRevision)throw new Error('設計が変更されたため、書き出しを中止しました。');}}
    const meta={format:'RAW16',width:n,height:n,byteOrder:'little-endian',rows:'north-to-south',firstRowWorldZ:p.bounds.zMax,lastRowWorldZ:p.bounds.zMin,units:'metres',minHeight:p.raw.min,maxHeight:p.raw.max,heightScale:(p.raw.max-p.raw.min)/65535,heightOffset:p.raw.min,bounds:p.bounds,frame:p.frame,sourceKind:p.sourceKind,sourceName:p.image.name,interpolation:'Approximate contour-constrained distance interpolation; inspect in the destination engine before use.',unityNote:'No automatic Unity import. Respect north-to-south rows; flip vertically when the destination importer expects row zero at zMin.'};
    download(F.zipStore([{name:'heightmap.raw',data:C.encodeRaw16(grid,p.raw.min,p.raw.max)},{name:'heightmap.json',data:JSON.stringify(meta,null,2)}]),safeName()+'-heightmap.zip','application/zip');toast('RAW16と高さ・座標情報をZIPに保存しました。');
    }catch(e){fail(e);}finally{busy=false;$('exportRaw').textContent='16bit 高さマップを保存';sync();}};
  function readFile(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(new Error('ファイルを読めませんでした。'));r.readAsDataURL(file);});}
  async function loadBackground(){
    const next = new Image();
    image = next;
    $('aiImageSize').textContent = '';
    next.onload = () => {
      if (image !== next) return;
      $('aiImageSize').textContent = '下図のサイズ ' + next.naturalWidth + ' × ' + next.naturalHeight + ' px';
      view = {zoom:1,x:0,y:0};
      requestDraw();
    };
    next.onerror = () => { if (image === next) toast('背景画像を読み込めませんでした。'); };
    next.src = project.image.dataURL;
  }
  $('loadImage').onclick=()=>$('imageFile').click();$('imageFile').onchange=async e=>{const file=e.target.files[0];e.target.value='';if(!file)return;try{if(file.size>8*1024*1024)throw new Error('画像は8MB以内のPNG・JPEG・WebPにしてください。');if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('PNG・JPEG・WebPを選んでください。');if((project.contours.length||project.pins.length)&&!confirm('新しい画像に入れ替え、現在の線を消します。必要な設計は保存しましたか？'))return;const dataURL=await readFile(file);project=initial();project.name=file.name.replace(/\.[^.]+$/,'')+' 高さ設計';project.image={name:file.name,dataURL};project.sourceKind='concept';selected=null;setMode('select');history=[];future=[];previewData=null;previewRevision=-1;changed();await loadBackground();renderPreview();}catch(e){fail(e);}};
  function normalize(p){if(p?.schema!=='tsukuyomi.contour-design'||p.version!==1)throw new Error('このツールの設計JSONではありません。');if(!Array.isArray(p.contours)||!Array.isArray(p.pins)||p.contours.length>MAX_LINES||p.pins.length>MAX_PINS)throw new Error('線や点の数が上限を超えています。');if(p.contours.some(c=>!c||!Array.isArray(c.points)||c.points.length>MAX_NODES||!Number.isFinite(c.height)||c.height< -100||c.height>200||c.points.some(v=>!v||!Number.isFinite(v.x)||!Number.isFinite(v.y)||!within(v))))throw new Error('等高線のデータが不正です。');if(p.pins.some(v=>!v||!Number.isFinite(v.x)||!Number.isFinite(v.y)||!within(v)||!Number.isFinite(v.height)||v.height< -100||v.height>200))throw new Error('高さの点のデータが不正です。');if(!p.image||!/^data:image\/(png|jpeg|webp);base64,/.test(p.image.dataURL||'')||p.image.dataURL.length>12*1024*1024)throw new Error('背景画像を含む設計データが必要です。');const q={...initial(),...p};q.name=String(q.name).slice(0,80);q.sourceKind=q.sourceKind==='topdown'?'topdown':'concept';if(!q.bounds||!['xMin','xMax','zMin','zMax'].every(k=>Number.isFinite(q.bounds[k])&&Math.abs(q.bounds[k])<=1e6)||q.bounds.xMin>=q.bounds.xMax||q.bounds.zMin>=q.bounds.zMax||!q.frame||!['u0','v0','u1','v1'].every(k=>Number.isFinite(q.frame[k])&&q.frame[k]>=0&&q.frame[k]<=1)||q.frame.u0>=q.frame.u1||q.frame.v0>=q.frame.v1||!Number.isFinite(q.baseHeight)||q.baseHeight< -100||q.baseHeight>200)throw new Error('座標・地図範囲・基準高が不正です。');q.raw={...initial().raw,...p.raw};if(![129,257,513].includes(q.raw.size)||!Number.isFinite(q.raw.min)||!Number.isFinite(q.raw.max))throw new Error('高さマップの出力設定が不正です。');const ids=new Set();for(const item of [...q.contours,...q.pins]){if(typeof item.id!=='string'||!item.id||ids.has(item.id))throw new Error('線や点の識別IDが重複しています。');ids.add(item.id);item.name=String(item.name||'').slice(0,60);}return q;}
  $('loadProject').onclick=()=>$('projectFile').click();$('projectFile').onchange=async e=>{const file=e.target.files[0];e.target.value='';if(!file)return;try{if(file.size>18*1024*1024)throw new Error('設計ファイルは18MB以内にしてください。');const q=normalize(JSON.parse(await file.text()));if((project.contours.length||project.pins.length)&&!confirm('現在の設計を開いたファイルに入れ替えます。保存しましたか？'))return;project=q;selected=null;setMode('select');history=[];future=[];previewData=null;previewRevision=-1;changed();await loadBackground();renderPreview();toast('設計を読み込みました。');}catch(e){fail(e);}};
  $('loadAIPlan').onclick = () => $('aiPlanFile').click();
  $('aiPlanFile').onchange = async event => {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    const background = image;
    try {
      if (file.size > 512 * 1024) throw new Error('AIの等高線JSONは512 KB以内にしてください。');
      const [source] = await Promise.all([file.text(), background.decode()]);
      if (image !== background) throw new Error('下図が変わりました。対応するAIの等高線を選び直してください。');
      const plan = window.ContourAIPlan.read(JSON.parse(source), {
        width: background.naturalWidth, height: background.naturalHeight
      });
      if ((project.contours.length || project.pins.length || draft.length) &&
          !confirm('現在の線と高さの点を、AIの等高線に入れ替えますか？')) return;
      setMode('select');
      change(() => {
        if (plan.name) project.name = plan.name;
        project.baseHeight = plan.baseHeight;
        project.contours = plan.contours;
        project.pins = plan.pins;
        selected = null;
      });
      makePreview();
      toast('AIの等高線を読み込みました。線を選ぶと高さや形を調整できます。');
    } catch (error) {
      toast(error instanceof SyntaxError ? 'JSONの書式を確認してください。' : error.message);
    }
  };
  $('sample').onclick=()=>{
    if((project.contours.length||project.pins.length)&&!confirm('現在の線を操作サンプルに入れ替えます。必要な設計は保存しましたか？（元に戻すこともできます）'))return;
    const sample=window.ContourSamples.make($('sampleKind').value,uid);
    change(()=>{project.contours=sample.contours;project.pins=sample.pins;project.baseHeight=sample.baseHeight;selected=project.contours[1]?.id||null;});
    setMode('select');makePreview();toast(sample.name+'の操作サンプルです。実際の高さが決まった線ではありません。');
  };
  document.addEventListener('keydown',e=>{const editing=/INPUT|TEXTAREA|SELECT/.test(e.target.tagName);if(e.key==='Escape'){if(gesture?.before)restore(gesture.before);setMode('select');return;}if(editing)return;if(e.code==='Space'){e.preventDefault();space=true;canvas.style.cursor='grab';}if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?$('redo').click():$('undo').click();}else if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='y'){e.preventDefault();$('redo').click();}else if((e.key==='Delete'||e.key==='Backspace')&&selected){e.preventDefault();remove();}});
  document.addEventListener('keyup',e=>{if(e.code==='Space'){space=false;canvas.style.cursor=mode==='pan'?'grab':mode==='select'?'default':'crosshair';}});window.addEventListener('blur',()=>{space=false;});
  new ResizeObserver(()=>{const r=$('viewport').getBoundingClientRect();size={w:r.width,h:r.height,dpr:Math.min(2,devicePixelRatio||1)};canvas.width=Math.round(size.w*size.dpr);canvas.height=Math.round(size.h*size.dpr);requestDraw();}).observe($('viewport'));
  try{const saved=localStorage.getItem(KEY);if(saved)project=normalize(JSON.parse(saved));}catch(_){$('saveState').textContent='保存データを読み込めなかったため、新規で開始';}
  sync();renderPreview();loadBackground();
})();
