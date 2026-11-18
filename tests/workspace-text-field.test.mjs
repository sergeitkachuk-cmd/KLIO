import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as jsx from 'react/jsx-runtime';
import ts from 'typescript';

const window = new Window();
for (const name of ['window','document','navigator','HTMLElement','HTMLInputElement','HTMLTextAreaElement','Event','KeyboardEvent','Node']) {
  Object.defineProperty(globalThis,name,{configurable:true,value:name==='window'?window:window[name]});
}
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {createRoot}=await import('react-dom/client');
const exports={};
new Function('require','exports',ts.transpileModule(readFileSync(new URL('../app/workspace-text-field.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText)(name=>({'react':React,'react-dom':ReactDOM,'react/jsx-runtime':jsx}[name]),exports);
const {WorkspaceTextarea,WorkspaceInput,BufferedWorkspaceInput}=exports;

test('professional draft stays immediate without rerendering workspace; actions receive latest text',async()=>{
 const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
 let renders=0,saved='',reset;
 function App(){const [value,setValue]=React.useState('');reset=setValue;renders++;return React.createElement(BufferedWorkspaceInput,{value:true},React.createElement(WorkspaceTextarea,{value,onChange:e=>setValue(e.target.value)}),React.createElement('button',{onClick:()=>saved=value},'Save'));}
 await React.act(()=>root.render(React.createElement(App)));
 const field=container.querySelector('textarea');const setter=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;
 async function type(text){await React.act(()=>{setter.call(field,text);field.dispatchEvent(new Event('input',{bubbles:true}));});}
 await type('П');await type('Пр');await type('Привет');
 assert.equal(field.value,'Привет');assert.equal(renders,1,'workspace should not render per character');
 await React.act(()=>{container.querySelector('button').dispatchEvent(new Event('pointerdown',{bubbles:true}));container.querySelector('button').click();});
 assert.equal(saved,'Привет','immediate action must see the uncommitted draft');
 await type('Новый текст');await React.act(()=>reset('Сброс'));assert.equal(field.value,'Сброс');
 await type('Сохранить после паузы');await React.act(()=>new Promise(r=>setTimeout(r,300)));assert.equal(renders,4);
 await React.act(()=>root.unmount());container.remove();
});

test('dialogue input keeps synchronous change behavior',async()=>{
 const container=document.createElement('div');document.body.append(container);const root=createRoot(container);let actual='';
 await React.act(()=>root.render(React.createElement(WorkspaceInput,{value:'',onChange:e=>{actual=e.target.value;}})));
 const field=container.querySelector('input');
 await React.act(()=>{Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(field,'Диалог');field.dispatchEvent(new Event('input',{bubbles:true}));});
 assert.equal(actual,'Диалог');await React.act(()=>root.unmount());container.remove();
});
