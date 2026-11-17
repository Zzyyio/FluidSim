import {scene,contains} from './geometry.js';
import {refinementRegions,contourWeights} from './refinement.js';
const canvas=document.querySelector('canvas'),error=document.querySelector('#error');
const control=id=>document.getElementById(id),number=id=>Number(control(id).value);
try {
 const gl=canvas.getContext('webgl2');
 if(!gl||!gl.getExtension('EXT_color_buffer_float'))throw Error('需要 WebGL2 和浮点纹理支持。');
 const source=await fetch('fluid.glsl').then(r=>{if(!r.ok)throw Error('无法加载 shader');return r.text()});
 function shader(type,text){const s=gl.createShader(type);gl.shaderSource(s,text);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;}
 const program=gl.createProgram();
 gl.attachShader(program,shader(gl.VERTEX_SHADER,'#version 300 es\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0,1);}'));
 gl.attachShader(program,shader(gl.FRAGMENT_SHADER,source));gl.linkProgram(program);
 if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
 gl.useProgram(program);gl.bindVertexArray(gl.createVertexArray());
 const uniforms=new Map();const loc=n=>{if(!uniforms.has(n))uniforms.set(n,gl.getUniformLocation(program,n));return uniforms.get(n)};
 let base,patches=[],version=-1,pointer=null,lost=false,previous=performance.now();
 function bind(texture,unit,name){gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,texture);gl.uniform1i(loc(name),unit)}
 function texture(w,h,mask=false,pixels=null){const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);gl.texImage2D(gl.TEXTURE_2D,0,mask?gl.R8:gl.RGBA16F,w,h,0,mask?gl.RED:gl.RGBA,mask?gl.UNSIGNED_BYTE:gl.HALF_FLOAT,pixels);for(const k of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,k,gl.NEAREST);for(const k of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,k,gl.CLAMP_TO_EDGE);return t;}
 function target(g){const t=texture(g.w,g.h),f=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,f);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,t,0);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('浮点 framebuffer 不受支持');gl.clear(gl.COLOR_BUFFER_BIT);const r={t,f};g.resources.push(r);return r;}
 function makeGrid(w,h,x=0,y=0,level=1){const g={w,h,x,y,level,resources:[]};for(const name of ['velocity','dye','pressure'])g[name]=[target(g),target(g)];for(const name of ['div','diffusion','curl'])g[name]=target(g);return g;}
 function destroy(g){if(!g)return;for(const r of g.resources){gl.deleteTexture(r.t);gl.deleteFramebuffer(r.f)}if(g.mask)gl.deleteTexture(g.mask);if(g.band)gl.deleteTexture(g.band)}
 function mask(g){const pixels=new Uint8Array(g.w*g.h);for(let y=0;y<g.h;y++)for(let x=0;x<g.w;x++)if(scene.objects.some(o=>contains(o,(g.x+(x+.5)/g.level)/base.w,1-(g.y+(y+.5)/g.level)/base.h,base.w/base.h)))pixels[y*g.w+x]=255;if(g.mask)gl.deleteTexture(g.mask);g.mask=texture(g.w,g.h,true,pixels);if(g.band)gl.deleteTexture(g.band);
 const contour=g.level>1?contourWeights(pixels,g.w,g.h,g.level):{weights:new Uint8Array(g.w*g.h).fill(255),active:0};
 g.band=texture(g.w,g.h,true,contour.weights);g.active=contour.active;}
 function pass(g,mode,out,a,b=a,coarse=a){
  gl.bindFramebuffer(gl.FRAMEBUFFER,out?.f??null);gl.viewport(0,0,g.w,g.h);
  gl.uniform2f(loc('size'),g.w,g.h);gl.uniform2f(loc('gridSize'),g.w,g.h);gl.uniform2f(loc('origin'),g.x,g.y);gl.uniform2f(loc('baseSize'),base.w,base.h);gl.uniform1f(loc('level'),g.level);gl.uniform1i(loc('isPatch'),g.level>1?1:0);gl.uniform1i(loc('mode'),mode);
  bind(a.t,0,'a');bind(b.t,1,'b');bind(g.mask,2,'obstacles');bind(g.band,4,'refinement');bind(coarse.t,3,'coarse');gl.drawArrays(gl.TRIANGLES,0,3);
 }
 function swap(g,mode,p,b=p[0],coarse=p[0]){pass(g,mode,p[1],p[0],b,coarse);p.reverse()}
 function rebuildPatches(){
  patches.forEach(destroy);patches=[];mask(base);
  const enabled=control('adaptive').checked;
  if(enabled)for(const box of refinementRegions(scene.objects,base.w,base.h)){
   const g=makeGrid(box.w*2,box.h*2,box.x,box.y,2);mask(g);patches.push(g);
   for(const name of ['velocity','dye']){gl.uniform1f(loc('fieldScale'),name==='velocity'?2:1);pass(g,13,g[name][0],base[name][0]);}
  }
  version=scene.version;pointer=null;
  const cells=patches.reduce((n,g)=>n+g.active,0);
  control('adaptiveStatus').textContent=patches.length?`轮廓 2× · ${Math.round(cells/(4*base.w*base.h)*100)}% 区域`:'基础网格';
 }
 function reset(){patches.forEach(destroy);patches=[];destroy(base);const ratio=canvas.clientWidth/canvas.clientHeight;const r=number('resolution');base=makeGrid(Math.max(16,Math.round(r*Math.min(ratio,1))),Math.max(16,Math.round(r*Math.min(1/ratio,1))));rebuildPatches()}
 function syncBoundary(g){for(const name of ['velocity','dye']){gl.uniform1f(loc('fieldScale'),name==='velocity'?2:1);swap(g,14,g[name],g[name][0],base[name][0]);}}
 function project(g){swap(g,6,g.velocity);pass(g,3,g.div,g.velocity[0]);for(const r of g.pressure){gl.bindFramebuffer(gl.FRAMEBUFFER,r.f);gl.clear(gl.COLOR_BUFFER_BIT)}for(let i=0;i<number('iterations');i++)swap(g,4,g.pressure,g.div);swap(g,5,g.velocity,g.pressure[0]);}
 function simulate(g,dt,input){
  gl.uniform1f(loc('dt'),dt);gl.uniform1f(loc('decay'),number('velocityDecay'));swap(g,0,g.velocity);
  if(input){const {start,delta,amount}=input,steps=Math.max(1,Math.min(32,Math.ceil(Math.hypot(...delta)/Math.max(1,number('radius')*.5))));gl.uniform1f(loc('radius'),number('radius')*g.level);const hex=control('inkColor').value,rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);
   for(let i=1;i<=steps;i++){gl.uniform2f(loc('point'),(start[0]+delta[0]*i/steps-g.x)*g.level,(start[1]+delta[1]*i/steps-g.y)*g.level);gl.uniform2f(loc('force'),...delta.map(v=>Math.max(-180,Math.min(180,v*12))*number('strength')*g.level/steps));swap(g,1,g.velocity);gl.uniform3f(loc('ink'),...rgb.map(v=>v*number('amount')*amount/steps));swap(g,2,g.dye)}
  }
  if(number('viscosity')>0){pass(g,10,g.diffusion,g.velocity[0]);gl.uniform1f(loc('viscosity'),number('viscosity')*g.level*g.level);for(let i=0;i<40;i++)swap(g,9,g.velocity,g.diffusion)}
  if(number('vorticity')>0){pass(g,11,g.curl,g.velocity[0]);gl.uniform1f(loc('vorticity'),number('vorticity'));swap(g,12,g.velocity,g.curl)}
  project(g);gl.uniform1f(loc('decay'),number('dyeDecay'));swap(g,0,g.dye,g.velocity[0]);
 }
 function restrict(g){
  for(const name of ['velocity','dye']){gl.uniform1f(loc('fieldScale'),name==='velocity'?2:1);
   // Restriction runs on the coarse viewport but needs the fine patch origin.
   const out=base[name][1];gl.bindFramebuffer(gl.FRAMEBUFFER,out.f);gl.viewport(0,0,base.w,base.h);gl.uniform1i(loc('mode'),15);gl.uniform2f(loc('origin'),g.x,g.y);bind(base[name][0].t,0,'a');bind(g[name][0].t,1,'b');bind(g.band,4,'refinement');gl.drawArrays(gl.TRIANGLES,0,3);base[name].reverse();
  }
 }
 function display(g,speed){const a=speed?g.velocity[0]:g.dye[0];gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.uniform1i(loc('mode'),speed?7:8);gl.uniform1i(loc('isPatch'),g.level>1?1:0);gl.uniform1f(loc('level'),g.level);gl.uniform2f(loc('size'),canvas.width,canvas.height);gl.uniform2f(loc('gridSize'),g.w,g.h);gl.uniform2f(loc('origin'),g.x,g.y);gl.uniform2f(loc('baseSize'),base.w,base.h);bind(a.t,0,'a');bind(g.div.t,1,'b');bind(g.mask,2,'obstacles');bind(g.band,4,'refinement');bind((speed?base.velocity[0]:base.dye[0]).t,3,'coarse');
  const x=Math.round(g.x/base.w*canvas.width),y=Math.round(g.y/base.h*canvas.height),right=Math.round((g.x+g.w/g.level)/base.w*canvas.width),top=Math.round((g.y+g.h/g.level)/base.h*canvas.height);
  gl.viewport(x,y,right-x,top-y);gl.uniform4f(loc('displayRect'),x,y,right-x,top-y);gl.drawArrays(gl.TRIANGLES,0,3);
 }
 for(const input of document.querySelectorAll('input[type=range]:not(#hueLow):not(#hueHigh)'))input.oninput=()=>{control(input.id+'Value').textContent=input.value};
 const pos=e=>{const r=canvas.getBoundingClientRect();return [(e.clientX-r.left)/r.width*base.w,(1-(e.clientY-r.top)/r.height)*base.h]};
 canvas.onpointerdown=e=>{if(pointer||!base)return;canvas.setPointerCapture(e.pointerId);const p=pos(e);pointer={id:e.pointerId,p,previous:p}};
 canvas.onpointermove=e=>{if(pointer?.id===e.pointerId)pointer.p=pos(e)};
 canvas.onpointerup=canvas.onpointercancel=canvas.onlostpointercapture=e=>{if(pointer?.id===e.pointerId)pointer=null};
 control('reset').onclick=()=>{reset();pointer=null};control('resolution').addEventListener('change',reset);control('adaptive').addEventListener('change',()=>{if(base)rebuildPatches()});
 canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();lost=true;error.textContent='GPU 上下文丢失，请刷新页面。'});
 function frame(now){if(lost)return;try{
  const cw=Math.max(1,Math.round(canvas.clientWidth*Math.min(devicePixelRatio,2))),ch=Math.max(1,Math.round(canvas.clientHeight*Math.min(devicePixelRatio,2)));
  if(canvas.width!==cw||canvas.height!==ch||!base){canvas.width=cw;canvas.height=ch;reset()}
  if(version!==scene.version)rebuildPatches();
  const elapsed=Math.min(Math.max((now-previous)/1000,0),1/30)*number('timeScale');previous=now;
  const steps=Math.max(1,Math.ceil(elapsed/(1/30))),dt=elapsed/steps;
  for(let step=0;step<steps;step++){
   const delta=pointer?.p.map((v,i)=>(v-pointer.previous[i])/steps);
   const input=pointer?{start:pointer.previous.map((v,i)=>v+delta[i]*step),delta,amount:dt}:null;
   simulate(base,dt,input);
   for(const g of patches){syncBoundary(g);simulate(g,dt,input);restrict(g)}
   // Blending coarse/fine velocities can introduce divergence; reproject globally.
   if(patches.length){
    project(base);
    // The final global correction must also reach fine-grid velocities.
    // Pressure scales with cell-size squared; its gradient then scales as velocity.
    for(const g of patches){gl.uniform1f(loc('fieldScale'),g.level*g.level);pass(g,13,g.pressure[0],base.pressure[0]);swap(g,5,g.velocity,g.pressure[0]);syncBoundary(g);}
   }
  }
  if(pointer)pointer.previous=[...pointer.p];
  gl.uniform1f(loc('speedMax'),150);gl.uniform2f(loc('hueRange'),(240-number('hueLow'))/360,(240-number('hueHigh'))/360);
  const speed=control('mode').value==='0';display(base,speed);for(const g of patches)display(g,speed);
  requestAnimationFrame(frame);
 }catch(e){error.textContent=e.message;console.error(e)}}
 requestAnimationFrame(frame);
}catch(e){error.textContent=e.message;console.error(e)}
