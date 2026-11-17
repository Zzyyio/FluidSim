// Patch rectangles are expressed in coarse cells, bottom-left origin.
// Overlapping rectangles merge so no fluid cell is simulated by two patches.
export function refinementRegions(objects,w,h,padding=16){
 const boxes=objects.map(o=>{
  const c=Math.abs(Math.cos(o.rotation)),s=Math.abs(Math.sin(o.rotation));
  const rx=(c*o.width+s*o.height)*h/2,ry=(s*o.width+c*o.height)*h/2;
  const x0=Math.max(0,Math.floor(o.x*w-rx-padding)),y0=Math.max(0,Math.floor((1-o.y)*h-ry-padding));
  const x1=Math.min(w,Math.ceil(o.x*w+rx+padding)),y1=Math.min(h,Math.ceil((1-o.y)*h+ry+padding));
  return {x:x0,y:y0,w:x1-x0,h:y1-y0};
 }).filter(b=>b.w>0&&b.h>0);
 let merged=true;
 while(merged){merged=false;outer:for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
  const a=boxes[i],b=boxes[j];
  if(a.x<=b.x+b.w&&b.x<=a.x+a.w&&a.y<=b.y+b.h&&b.y<=a.y+a.h){
   const x=Math.min(a.x,b.x),y=Math.min(a.y,b.y);boxes[i]={x,y,w:Math.max(a.x+a.w,b.x+b.w)-x,h:Math.max(a.y+a.h,b.y+b.h)-y};boxes.splice(j,1);merged=true;break outer;
  }
 }}
 return boxes;
}

// Distance to rasterized solids in fine-cell units; two-pass chamfer transform.
export function contourWeights(pixels,w,h,level){
 const d=new Float32Array(w*h);for(let i=0;i<d.length;i++)d[i]=pixels[i]?0:1e6;
 const visit=(x,y,dx,dy,cost)=>{const xx=x+dx,yy=y+dy;if(xx>=0&&yy>=0&&xx<w&&yy<h)d[y*w+x]=Math.min(d[y*w+x],d[yy*w+xx]+cost)};
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){visit(x,y,-1,0,1);visit(x,y,0,-1,1);visit(x,y,-1,-1,Math.SQRT2);visit(x,y,1,-1,Math.SQRT2)}
 for(let y=h-1;y>=0;y--)for(let x=w-1;x>=0;x--){visit(x,y,1,0,1);visit(x,y,0,1,1);visit(x,y,1,1,Math.SQRT2);visit(x,y,-1,1,Math.SQRT2)}
 const weights=new Uint8Array(w*h);let active=0;
 for(let i=0;i<d.length;i++){const t=Math.max(0,Math.min(1,(d[i]/level-5)/7));weights[i]=Math.round(255*(1-t*t*(3-2*t)));if(!pixels[i]&&weights[i])active++}
 return {weights,active};
}
