(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.ContourFiles=api;})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const table=Uint32Array.from({length:256},(_,i)=>{let c=i;for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
  function crc32(bytes){let c=0xffffffff;for(const b of bytes)c=table[(c^b)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
  function zipStore(entries){
    const encoder=new TextEncoder(),local=[],central=[];let offset=0;
    for(const entry of entries){
      const name=encoder.encode(entry.name),data=entry.data instanceof Uint8Array?entry.data:encoder.encode(entry.data),crc=crc32(data);
      const head=new Uint8Array(30+name.length),v=new DataView(head.buffer);
      v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint16(12,33,true);v.setUint32(14,crc,true);v.setUint32(18,data.length,true);v.setUint32(22,data.length,true);v.setUint16(26,name.length,true);head.set(name,30);
      local.push(head,data);
      const c=new Uint8Array(46+name.length),w=new DataView(c.buffer);
      w.setUint32(0,0x02014b50,true);w.setUint16(4,20,true);w.setUint16(6,20,true);w.setUint16(8,0x800,true);w.setUint16(14,33,true);w.setUint32(16,crc,true);w.setUint32(20,data.length,true);w.setUint32(24,data.length,true);w.setUint16(28,name.length,true);w.setUint32(42,offset,true);c.set(name,46);central.push(c);offset+=head.length+data.length;
    }
    const size=central.reduce((n,c)=>n+c.length,0),end=new Uint8Array(22),e=new DataView(end.buffer);
    e.setUint32(0,0x06054b50,true);e.setUint16(8,entries.length,true);e.setUint16(10,entries.length,true);e.setUint32(12,size,true);e.setUint32(16,offset,true);
    const out=new Uint8Array(offset+size+22);let pos=0;for(const a of [...local,...central,end]){out.set(a,pos);pos+=a.length;}return out;
  }
  return{crc32,zipStore};
});
