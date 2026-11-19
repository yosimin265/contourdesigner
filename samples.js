(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.ContourSamples=api;})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  function make(kind,id){
    let count=0;id=id||(()=>kind+'-'+(++count));
    const ring=(name,height,points)=>({id:id(),name:'サンプル：'+name,height,closed:true,smooth:.4,points:points.map(([x,y])=>({x,y}))});
    const outer=[[.28,.36],[.35,.22],[.49,.16],[.65,.23],[.73,.38],[.63,.57],[.48,.61],[.34,.51]];
    const middle=[[.35,.36],[.42,.26],[.54,.24],[.64,.34],[.63,.45],[.5,.51],[.4,.46]];
    const inner=[[.45,.32],[.52,.29],[.58,.35],[.55,.42],[.47,.41]];
    if(kind==='valley')return {baseHeight:0,name:'谷・池のくぼみ',contours:[
      ring('谷の縁',0,[[.36,.50],[.43,.48],[.48,.55],[.47,.63],[.43,.70],[.36,.67],[.33,.59]]),
      ring('谷の斜面',-2,[[.37,.54],[.42,.52],[.45,.57],[.43,.65],[.38,.66],[.35,.60]]),
      ring('池の底',-4,[[.38,.57],[.41,.56],[.43,.59],[.41,.63],[.38,.63],[.37,.60]])
    ],pins:[{id:id(),name:'サンプル：いちばん深い所',x:.4,y:.60,height:-5}]};
    if(kind==='sunken')return {baseHeight:0,name:'高台の中のくぼみ',contours:[ring('高台の縁',8,outer),ring('内側の斜面',5,middle),ring('くぼみの底',2,inner)],pins:[]};
    return {baseHeight:0,name:'高台',contours:[ring('高台の外周',2,outer),ring('中段',6,middle),ring('上段',10,inner)],pins:[]};
  }
  return {make};
});
