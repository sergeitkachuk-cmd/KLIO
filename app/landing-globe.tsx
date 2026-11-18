"use client";
import { useEffect, useRef } from "react";
import landPoints from "./landing-land-points.json";

// Rotating point cloud: depth, perspective and a warm atmospheric rim, without a video download.
export function LandingGlobe() {
  const ref=useRef<HTMLCanvasElement>(null);
  useEffect(()=>{
    const canvas=ref.current;if(!canvas)return;
    const ctx=canvas.getContext("2d");if(!ctx)return;
    const track=canvas.closest<HTMLElement>(".kl-orbit-track");
    const reduced=window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Natural Earth 1:110m land outline, public domain. Pre-sampled to keep animation inexpensive.
    const points=landPoints;
    let width=0,height=0,frame=0,visible=false,last=0,angle=.35;
    const resize=()=>{width=canvas.clientWidth;height=canvas.clientHeight;const dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);if(reduced)draw(0);};
    const draw=(time:number)=>{
      frame=0;if(!visible&&!reduced)return;
      if(time-last<32&&!reduced){frame=requestAnimationFrame(draw);return;}last=time;
      if(!reduced)angle+=.0009;
      ctx.clearRect(0,0,width,height);
      const radius=Math.min(width,height)*.43,cx=width/2,cy=height/2;
      // Sparse stars sit behind the atmosphere and never obscure the continent pattern.
      for(let i=0;i<65;i++){
        const sx=((Math.sin(i*127.1)*43758.5453)%1+1)%1*width;
        const sy=((Math.sin(i*311.7)*96321.912)%1+1)%1*height;
        ctx.fillStyle=`rgba(227,207,238,${.1+(i%5)*.035})`;
        ctx.beginPath();ctx.arc(sx,sy,i%7===0?1.1:.55,0,Math.PI*2);ctx.fill();
      }
      const atmosphere=ctx.createRadialGradient(cx,cy,radius*.86,cx,cy,radius*1.18);
      atmosphere.addColorStop(0,"#b3590800");
      atmosphere.addColorStop(.32,"#e5781270");
      atmosphere.addColorStop(.49,"#ffa831ae");
      atmosphere.addColorStop(.63,"#f09b2838");
      atmosphere.addColorStop(1,"#b7741500");
      ctx.save();
      const upperGlow=ctx.createLinearGradient(0,cy-radius*1.2,0,cy+radius*.8);
      upperGlow.addColorStop(0,"#fff");upperGlow.addColorStop(.55,"#ffffffb0");upperGlow.addColorStop(1,"#ffffff00");
      ctx.fillStyle=atmosphere;ctx.fillRect(0,0,width,height);
      ctx.globalCompositeOperation="destination-in";
      ctx.fillStyle=upperGlow;ctx.fillRect(0,0,width,height);ctx.restore();
      const surface=ctx.createRadialGradient(cx-radius*.2,cy-radius*.6,radius*.1,cx,cy,radius);
      surface.addColorStop(0,"#25152e");surface.addColorStop(.5,"#170e24");surface.addColorStop(.85,"#0d0915");surface.addColorStop(1,"#4c2316");
      ctx.fillStyle=surface;ctx.beginPath();ctx.arc(cx,cy,radius,0,Math.PI*2);ctx.fill();
      const scrollTurn=track?Number(track.style.getPropertyValue("--globe-progress")||0)*.85:0;
      const rotation=angle+scrollTurn;
      const rotated=points.map(([x,y,z])=>{const xx=x*Math.cos(rotation)+z*Math.sin(rotation),zz=z*Math.cos(rotation)-x*Math.sin(rotation);const yy=y*Math.cos(-.2)-zz*Math.sin(-.2),depth=y*Math.sin(-.2)+zz*Math.cos(-.2);return [xx,yy,depth];}).filter(p=>p[2]>-.1).sort((a,b)=>a[2]-b[2]);
      for(const [x,y,z] of rotated){const perspective=1+z*.07;const alpha=.08+Math.pow(Math.max(0,z),.6)*.8;ctx.fillStyle=`rgba(231,207,235,${alpha})`;ctx.beginPath();ctx.arc(cx+x*radius*perspective,cy+y*radius*perspective,Math.max(.45,(.55+z)*radius/230),0,Math.PI*2);ctx.fill();}
      const shade=ctx.createLinearGradient(0,cy-radius,0,cy+radius);shade.addColorStop(0,"#15111500");shade.addColorStop(.4,"#15111500");shade.addColorStop(1,"#151115ed");ctx.fillStyle=shade;ctx.fillRect(cx-radius-50,cy-radius,radius*2+100,radius*2+50);
      // Platforms grow out of illuminated surface points, with leaders attached to the sphere.
      const progress=reduced?1:(track?Number(track.style.getPropertyValue("--globe-progress")||0):1);
      const platforms=[
        {name:"Telegram",mark:"↗"},{name:"ВКонтакте",mark:"VK"},
        {name:"Instagram",mark:"◎"},{name:"YouTube",mark:"▶"},
        {name:"Дзен",mark:"✦"},{name:"TikTok",mark:"♪"},
        {name:"Pinterest",mark:"P"},{name:"Rutube",mark:"R"},
      ];
      const bounds=canvas.getBoundingClientRect();
      const scale=bounds.width/Math.max(1,width);
      const safeLeft=Math.max(12,-bounds.left/scale+12);
      const safeRight=Math.min(width-12,(innerWidth-bounds.left)/scale-12);
      platforms.forEach((platform,index)=>{
        // Each pulse selects a new real land vertex; it uses exactly the globe's rotation matrix.
        const cycleLength=10;
        const clock=reduced?4:time/1000+index*2.1;
        const cycle=Math.floor(clock/cycleLength);
        const phase=(clock%cycleLength)/cycleLength;
        const envelope=reduced?1:Math.min(1,phase/.15,(1-phase)/.2);
        const raw=Math.max(0,Math.min(1,(progress-.1-index%4*.05)/.18))*Math.max(0,envelope);
        const reveal=raw*raw*(3-2*raw);
        if(reveal<=0)return;
        const vertex=points[(index*467+cycle*691+173)%points.length];
        const [vx,vy,vz]=vertex;
        const x=vx*Math.cos(rotation)+vz*Math.sin(rotation);
        const zz=vz*Math.cos(rotation)-vx*Math.sin(rotation);
        const y=vy*Math.cos(-.2)-zz*Math.sin(-.2);
        const z=vy*Math.sin(-.2)+zz*Math.cos(-.2);
        if(z<.22)return;
        const perspective=1+z*.07;
        const ax=cx+x*radius*perspective,ay=cy+y*radius*perspective;
        const direction=x<0?-1:1;
        const font=Math.max(13,width*.016),boxHeight=font*2.7;
        ctx.font=`500 ${font}px system-ui, sans-serif`;
        const boxWidth=ctx.measureText(platform.name).width+font*3.6;
        const lx=Math.max(safeLeft,Math.min(safeRight-boxWidth,ax+direction*radius*.2*reveal-(direction<0?boxWidth:0)));
        const ly=Math.max(12,Math.min(height-boxHeight-12,ay+(y<0?-1:1)*radius*.12*reveal-boxHeight/2));
        ctx.save();ctx.globalAlpha=reveal*Math.min(1,(z-.22)*4);
        ctx.strokeStyle="#f3c7a9aa";ctx.lineWidth=1;
        ctx.beginPath();ctx.moveTo(ax,ay);ctx.lineTo(lx+boxWidth/2,ly+boxHeight/2);ctx.stroke();
        ctx.fillStyle="#ffddb2";ctx.shadowColor="#ffc589";ctx.shadowBlur=14;
        ctx.beginPath();ctx.arc(ax,ay,3,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
        const pulse=reduced?0:(time/1800+index*.3)%1;
        ctx.strokeStyle=`rgba(255,213,162,${(1-pulse)*.6})`;
        ctx.beginPath();ctx.arc(ax,ay,4+pulse*13,0,Math.PI*2);ctx.stroke();
        ctx.translate(lx+boxWidth/2,ly+boxHeight/2);ctx.scale(.75+.25*reveal,.75+.25*reveal);
        ctx.fillStyle="#302430f2";ctx.strokeStyle="#e9b9cc75";
        ctx.beginPath();ctx.roundRect(-boxWidth/2,-boxHeight/2,boxWidth,boxHeight,boxHeight/2);ctx.fill();ctx.stroke();
        ctx.textBaseline="middle";ctx.textAlign="center";ctx.fillStyle="#f3c88c";
        ctx.font=`600 ${font*.88}px system-ui, sans-serif`;
        ctx.fillText(platform.mark,-boxWidth/2+font*1.4,0);
        ctx.textAlign="left";ctx.fillStyle="#fff1ec";ctx.font=`500 ${font}px system-ui, sans-serif`;
        ctx.fillText(platform.name,-boxWidth/2+font*2.6,0);ctx.restore();
      });
      if(!reduced&&visible)frame=requestAnimationFrame(draw);
    };
    const observer=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;if(visible&&!frame)frame=requestAnimationFrame(draw);else if(!visible){cancelAnimationFrame(frame);frame=0;}},{rootMargin:"150px"});
    observer.observe(canvas);const sizes=new ResizeObserver(resize);sizes.observe(canvas);resize();
    return()=>{observer.disconnect();sizes.disconnect();cancelAnimationFrame(frame);};
  },[]);
  return <canvas ref={ref} className="kl-globe-canvas" aria-hidden="true"/>;
}
