"use client";
import { useEffect, type RefObject } from "react";

export function MotionHeading({ lines, hero = false }: { lines: string[]; hero?: boolean }) {
  let word = 0;
  const Tag = hero ? "h1" : "h2";
  return <Tag className={`kl-motion-heading${hero ? " kl-motion-hero" : ""}`} aria-label={lines.join(" ")}>
    {lines.map((line,i)=><span className="kl-motion-line" aria-hidden="true" key={line}>{line.split(" ").map(text=><span className="kl-motion-word" key={`${i}-${word}`} style={{"--word-index":word++} as React.CSSProperties}>{text}{" "}</span>)}</span>)}
  </Tag>;
}

export function useLandingMotion(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element=root.current;
    if(!element) return;
    const media=window.matchMedia("(prefers-reduced-motion: reduce)");
    if(media.matches) return;
    const clamp=(n:number)=>Math.max(0,Math.min(1,n));
    const heads=[...element.querySelectorAll<HTMLElement>(".kl-motion-heading:not(.kl-motion-hero)")];
    const cards=[...element.querySelectorAll<HTMLElement>(".kl-feature")];
    const demo=element.querySelector<HTMLElement>(".kl-demo-window");
    const story=element.querySelector<HTMLElement>(".kl-story");
    const orbit=element.querySelector<HTMLElement>(".kl-orbit-track");
    const hero=element.querySelector<HTMLElement>(".kl-hero-track");
    const closing=element.querySelector<HTMLElement>(".kl-closing");
    const stages=[...element.querySelectorAll<HTMLElement>(".kl-scene-stage")];
    let frame=0;
    const progress=(node:HTMLElement)=> {const r=node.getBoundingClientRect();return clamp(-r.top/Math.max(1,r.height-innerHeight));};
    const update=()=>{
      frame=0;
      stages.forEach((stage,index)=>{
        const next=stages[index+1];
        const covered=next?clamp(1-next.getBoundingClientRect().top/innerHeight):0;
        stage.style.setProperty("--scene-covered",String(covered));
      });
      const nav=clamp(scrollY/Math.max(250,innerHeight*.55));
      element.style.setProperty("--nav-width",`${Math.max(820,Math.min(1060,innerWidth-80))*(1-nav)+820*nav}px`);
      element.style.setProperty("--nav-top",`${52-34*nav}px`);
      element.style.setProperty("--nav-radius",`${16+40*nav}px`);
      if(hero){
        const r=(hero.querySelector(".kl-hero") || hero).getBoundingClientRect();
        element.style.setProperty("--hero-exit",String(clamp(-r.top/(innerHeight*.85))));
      }
      if(story){const r=story.getBoundingClientRect();story.style.setProperty("--curtain",String(clamp((innerHeight-r.top)/(innerHeight*.85))));story.style.setProperty("--story-words",String(clamp((innerHeight*.85-r.top)/(innerHeight*.5))));story.style.setProperty("--story-content-opacity",String(clamp((innerHeight*.8-r.top)/(innerHeight*.4))));}
      heads.forEach(head=>{if(head.closest('.kl-story'))return;const r=head.getBoundingClientRect();if(r.bottom<0||r.top>innerHeight*1.2)return;head.style.setProperty("--heading-progress",String(clamp((innerHeight*.97-r.top)/(innerHeight*.4))));});
      cards.forEach((card,i)=>{const r=card.getBoundingClientRect();if(r.bottom<0||r.top>innerHeight*1.3)return;card.style.setProperty("--card-progress",String(clamp((innerHeight-r.top)/(innerHeight*.45)-i*.05)));});
      if(orbit){const r=orbit.getBoundingClientRect();if(r.bottom>0&&r.top<innerHeight)orbit.style.setProperty("--globe-progress",String(progress(orbit.closest<HTMLElement>(".kl-scene-stage") || orbit)));}
      if(demo){const r=demo.getBoundingClientRect();if(r.bottom>0&&r.top<innerHeight*1.2)demo.style.setProperty("--demo-progress",String(clamp((innerHeight-r.top)/(innerHeight*.65))));}
      if(closing){const r=closing.getBoundingClientRect();closing.style.setProperty("--closing-progress",String(clamp((innerHeight-r.top)/(innerHeight*.85))));}
    };
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(update);};
    const hoverCleanups = cards.map(card => {
      const move = (event: PointerEvent) => {
        if (event.pointerType !== "mouse") return;
        const r = card.getBoundingClientRect();
        const x = (event.clientX-r.left)/r.width-.5;
        const y = (event.clientY-r.top)/r.height-.5;
        card.style.setProperty("--tilt-x", `${-y*5}deg`);
        card.style.setProperty("--tilt-y", `${x*5}deg`);
        card.style.setProperty("--art-x", `${x*12}px`);
        card.style.setProperty("--art-y", `${y*12}px`);
      };
      const leave = () => ["--tilt-x","--tilt-y","--art-x","--art-y"].forEach(key=>card.style.removeProperty(key));
      card.addEventListener("pointermove",move); card.addEventListener("pointerleave",leave);
      return () => {card.removeEventListener("pointermove",move);card.removeEventListener("pointerleave",leave);};
    });
    window.addEventListener("scroll",schedule,{passive:true});window.addEventListener("resize",schedule);update();
    return ()=>{hoverCleanups.forEach(cleanup=>cleanup());cancelAnimationFrame(frame);window.removeEventListener("scroll",schedule);window.removeEventListener("resize",schedule);};
  },[root]);
}
