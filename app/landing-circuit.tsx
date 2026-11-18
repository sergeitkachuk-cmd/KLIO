import { FileText, ImageIcon, CalendarDays, Layers, AudioLines, Sparkles } from 'lucide-react';

function Processor() {
  const pins=[53,71,89,107];
  const outline='M34 16H126L144 34V126L126 144H34L16 126V34Z';
  return <div className="kl-chip" aria-hidden="true"><svg className="kl-processor" viewBox="0 0 160 166" fill="none">
    <defs>
      <linearGradient id="cpu-metal" x1="0" y1="0" x2="1" y2="1"><stop stopColor="var(--kl-cpu-metal-1,#6b6268)"/><stop offset=".35" stopColor="var(--kl-cpu-metal-2,#332e34)"/><stop offset=".65" stopColor="var(--kl-cpu-metal-3,#111015)"/><stop offset="1" stopColor="var(--kl-cpu-metal-4,#575056)"/></linearGradient>
      <linearGradient id="cpu-edge" x1="20" y1="16" x2="130" y2="144" gradientUnits="userSpaceOnUse"><stop stopColor="var(--kl-cpu-edge-1,#80737a)"/><stop offset=".3" stopColor="var(--kl-cpu-edge-2,#393038)"/><stop offset=".7" stopColor="var(--kl-cpu-edge-3,#151218)"/><stop offset="1" stopColor="var(--kl-cpu-edge-4,#5a4445)"/></linearGradient>
      <linearGradient id="cpu-face" x1="35" y1="22" x2="126" y2="140" gradientUnits="userSpaceOnUse"><stop stopColor="var(--kl-cpu-face-1,#343035)"/><stop offset=".5" stopColor="var(--kl-cpu-face-2,#242127)"/><stop offset="1" stopColor="var(--kl-cpu-face-3,#1e1a20)"/></linearGradient>
      <linearGradient id="cpu-type" x1="40" y1="65" x2="110" y2="95" gradientUnits="userSpaceOnUse"><stop stopColor="var(--kl-cpu-type-1,#f7eeed)"/><stop offset=".5" stopColor="var(--kl-cpu-type-2,#bdb3ba)"/><stop offset="1" stopColor="var(--kl-cpu-type-3,#776d75)"/></linearGradient>
      <radialGradient id="cpu-warm"><stop stopColor="#e6a765" stopOpacity=".24"/><stop offset="1" stopColor="#e6a765" stopOpacity="0"/></radialGradient>
    </defs>
    <ellipse cx="80" cy="116" rx="79" ry="47" fill="url(#cpu-warm)"/>
    <g className="kl-processor-pins" fill="url(#cpu-metal)" stroke="#9a838533" strokeWidth=".5">
      {pins.map(p=><g key={p}><rect x="2" y={p-3} width="20" height="6" rx="1.3"/><rect x="138" y={p-3} width="20" height="6" rx="1.3"/><rect x={p-3} y="138" width="6" height="23" rx="1.3"/></g>)}
    </g>
    <path d={outline} transform="translate(0 5)" fill="var(--kl-cpu-shadow,#0b090d)" stroke="var(--kl-cpu-shadow,#30262e)" strokeWidth="2"/>
    <path d={outline} fill="url(#cpu-edge)" stroke="#77626c" strokeOpacity=".45"/>
    <path d="M35 20H125L140 35V124L124 140H35L20 125V35Z" fill="url(#cpu-face)" stroke="#a58a961c"/>
    <path d="M35 21H124L138 35" stroke="#e3cdd0" strokeOpacity=".22" strokeWidth=".8"/>
    <path d="M22 36V123L36 138" stroke="#b3a1ab" strokeOpacity=".08"/>
    <path className="kl-processor-glint" d={outline} stroke="#f4c088" strokeWidth="1" pathLength="100"/>
    <circle cx="34" cy="35" r="1.7" fill="#a6959e" fillOpacity=".3"/>
    <text x="80" y="89" textAnchor="middle" fill="url(#cpu-type)" fontSize="26" fontWeight="600" letterSpacing="-1.5" fontFamily="Arial, sans-serif">КЛИО</text>
    <path d="M57 113H103" stroke="#75636e" strokeOpacity=".18"/>
    <path d="M51 116H109" stroke="#75636e" strokeOpacity=".08"/>
  </svg></div>;
}

export function LandingCircuit() {
  const paths = [
    'M0 50H145Q170 50 185 70L235 116Q251 133 277 133H460',
    'M0 150H210Q230 150 247 143Q262 137 280 151H460',
    'M0 245H174Q195 245 213 225L250 186Q265 169 289 169H460',
    'M0 350H140Q163 350 180 329L262 207Q275 187 300 187H460',
    'M1000 50H855Q830 50 815 70L765 116Q749 133 723 133H540',
    'M1000 150H790Q770 150 753 143Q738 137 720 151H540',
    'M1000 245H826Q805 245 787 225L750 186Q735 169 711 169H540',
    'M1000 350H860Q837 350 820 329L738 207Q725 187 700 187H540',
    'M480 198V268Q480 281 468 295L420 350V400',
    'M493 198V400','M507 198V400',
    'M520 198V268Q520 281 532 295L580 350V400',
  ];
  return <div className="kl-circuit kl-circuit-wide" aria-label="Все инструменты связаны с процессором КЛИО">
    <svg className="kl-circuit-lines" viewBox="0 0 1000 400" preserveAspectRatio="none" fill="none" aria-hidden="true"><defs><linearGradient id="circuit-stroke"><stop stopColor="var(--kl-wire-edge,#e8afc2)" stopOpacity="var(--kl-wire-edge-opacity,.025)"/><stop offset=".5" stopColor="var(--kl-wire-center,#c49c76)" stopOpacity="var(--kl-wire-center-opacity,.38)"/><stop offset="1" stopColor="var(--kl-wire-edge,#e8afc2)" stopOpacity="var(--kl-wire-edge-opacity,.025)"/></linearGradient><filter id="packet-glow"><feGaussianBlur stdDeviation="3"/></filter></defs>{paths.map((d,i)=><g key={d}><path className="kl-wire" pathLength="100" d={d} style={{animationDelay:`${1.8+i*.065}s`}}/><path className="kl-packet-aura" pathLength="100" d={d} style={{animationDelay:`${i*-.67}s`}}/><path className="kl-packet-core" pathLength="100" d={d} style={{animationDelay:`${i*-.67}s`}}/></g>)}</svg>
    <Processor/>
    {[FileText,AudioLines,Layers,ImageIcon,Sparkles,CalendarDays].map((Icon,i)=><span key={i} className={`kl-network-node kl-network-node-${i}`}><Icon/><small>{['Тексты','Голос бренда','Контент-план','Визуалы','Редактура','Публикации'][i]}</small></span>)}
  </div>;
}
