/******/ (() => { // webpackBootstrap
/******/ 	"use strict";

;// ../../node_modules/uuid/dist/esm-browser/native.js
const randomUUID = typeof crypto !== 'undefined' && crypto.randomUUID && crypto.randomUUID.bind(crypto);
/* harmony default export */ const esm_browser_native = ({
  randomUUID
});
;// ../../node_modules/uuid/dist/esm-browser/rng.js
// Unique ID creation requires a high quality random # generator. In the browser we therefore
// require the crypto API and do not support built-in fallback to lower quality random number
// generators (like Math.random()).
let getRandomValues;
const rnds8 = new Uint8Array(16);
function rng() {
  // lazy load so that environments that need to polyfill have a chance to do so
  if (!getRandomValues) {
    // getRandomValues needs to be invoked in a context where "this" is a Crypto implementation.
    getRandomValues = typeof crypto !== 'undefined' && crypto.getRandomValues && crypto.getRandomValues.bind(crypto);

    if (!getRandomValues) {
      throw new Error('crypto.getRandomValues() not supported. See https://github.com/uuidjs/uuid#getrandomvalues-not-supported');
    }
  }

  return getRandomValues(rnds8);
}
;// ../../node_modules/uuid/dist/esm-browser/stringify.js
/* unused harmony import specifier */ var validate;

/**
 * Convert array of 16 byte values to UUID string format of the form:
 * XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX
 */

const byteToHex = [];

for (let i = 0; i < 256; ++i) {
  byteToHex.push((i + 0x100).toString(16).slice(1));
}

function unsafeStringify(arr, offset = 0) {
  // Note: Be careful editing this code!  It's been tuned for performance
  // and works in ways you may not expect. See https://github.com/uuidjs/uuid/pull/434
  return byteToHex[arr[offset + 0]] + byteToHex[arr[offset + 1]] + byteToHex[arr[offset + 2]] + byteToHex[arr[offset + 3]] + '-' + byteToHex[arr[offset + 4]] + byteToHex[arr[offset + 5]] + '-' + byteToHex[arr[offset + 6]] + byteToHex[arr[offset + 7]] + '-' + byteToHex[arr[offset + 8]] + byteToHex[arr[offset + 9]] + '-' + byteToHex[arr[offset + 10]] + byteToHex[arr[offset + 11]] + byteToHex[arr[offset + 12]] + byteToHex[arr[offset + 13]] + byteToHex[arr[offset + 14]] + byteToHex[arr[offset + 15]];
}

function stringify(arr, offset = 0) {
  const uuid = unsafeStringify(arr, offset); // Consistency check for valid UUID.  If this throws, it's likely due to one
  // of the following:
  // - One or more input array values don't map to a hex octet (leading to
  // "undefined" in the uuid)
  // - Invalid input values for the RFC `version` or `variant` fields

  if (!validate(uuid)) {
    throw TypeError('Stringified UUID is invalid');
  }

  return uuid;
}

/* harmony default export */ const esm_browser_stringify = ((/* unused pure expression or super */ null && (stringify)));
;// ../../node_modules/uuid/dist/esm-browser/v4.js




function v4(options, buf, offset) {
  if (esm_browser_native.randomUUID && !buf && !options) {
    return esm_browser_native.randomUUID();
  }

  options = options || {};
  const rnds = options.random || (options.rng || rng)(); // Per 4.4, set bits for version and `clock_seq_hi_and_reserved`

  rnds[6] = rnds[6] & 0x0f | 0x40;
  rnds[8] = rnds[8] & 0x3f | 0x80; // Copy bytes to buffer, if provided

  if (buf) {
    offset = offset || 0;

    for (let i = 0; i < 16; ++i) {
      buf[offset + i] = rnds[i];
    }

    return buf;
  }

  return unsafeStringify(rnds);
}

/* harmony default export */ const esm_browser_v4 = (v4);
;// ../../node_modules/@eyeo/snippets/webext/main.mjs
/*!
 * This file is part of eyeo's Anti-Circumvention Snippets module (@eyeo/snippets),
 * Copyright (C) 2006-present eyeo GmbH
 * 
 * @eyeo/snippets is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3 as
 * published by the Free Software Foundation.
 * 
 * @eyeo/snippets is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 * 
 * You should have received a copy of the GNU General Public License
 * along with @eyeo/snippets.  If not, see <http://www.gnu.org/licenses/>.
 */
let currentEnvironment = {initial: true};
const callback = (environment, ...filters) => {
const e=Proxy,{apply:t,bind:n,call:r}=Function,o=r.bind(t),i=r.bind(n),s=r.bind(r),a={get:(e,t)=>i(r,e[t])},c=t=>new e(t,a),l=(t,n)=>new e(t,{apply:(e,t,r)=>o(n,t,r)}),u={get:(e,t)=>i(e[t],e)},f=t=>new e(t,u),{assign:p,defineProperties:d,freeze:h,getOwnPropertyDescriptor:y,getOwnPropertyDescriptors:g,getPrototypeOf:w}=f(Object),{hasOwnProperty:m}=c({}),{species:v}=Symbol,b={get(e,t){const n=e[t];class r extends n{}const o=g(n.prototype);delete o.constructor,h(d(r.prototype,o));const i=g(n);return delete i.length,delete i.prototype,i[v]={value:r},h(d(r,i))}},S=t=>new e(t,b);"undefined"!=typeof currentEnvironment&&currentEnvironment.initial&&"undefined"!=typeof environment&&(currentEnvironment=environment);const E=()=>"undefined"!=typeof currentEnvironment?currentEnvironment:"undefined"!=typeof environment?environment:{};"undefined"==typeof globalThis&&(window.globalThis=window);const{apply:$,ownKeys:x}=f(Reflect),R=E(),P="world"in R,k=P&&"ISOLATED"===R.world,O=P&&"MAIN"===R.world,T="object"==typeof chrome&&!!chrome.runtime,j="object"==typeof browser&&!!browser.runtime,A=!O&&(k||T||j),L=e=>A?e:C(e,F(e)),{create:C,defineProperties:M,defineProperty:I,freeze:N,getOwnPropertyDescriptor:D,getOwnPropertyDescriptors:F}=f(Object),q=f(globalThis),W=A?globalThis:S(globalThis),{Map:H,RegExp:J,Set:B,WeakMap:_,WeakSet:V}=W,z=(e,t,n=null)=>{const r=x(t);for(const o of x(e)){if(r.includes(o))continue;const i=D(e,o);if(n&&"value"in i){const{value:e}=i;"function"==typeof e&&(i.value=n(e))}I(t,o,i)}},U=e=>{const t=W[e];class n extends t{}const{toString:r,valueOf:o}=t.prototype;M(n.prototype,{toString:{value:r},valueOf:{value:o}});const i=e.toLowerCase(),s=e=>function(){const t=$(e,this,arguments);return typeof t===i?new n(t):t};return z(t,n,s),z(t.prototype,n.prototype,s),n},X=N({frozen:new _,hidden:new V,iframePropertiesToAbort:{read:new B,write:new B},abortedIframes:new _}),G=new J("^[A-Z]"),K=A&&(T&&chrome||j&&browser)||void 0;var Q=new Proxy(new H([["chrome",K],["browser",K],["isExtensionContext",A],["variables",X],["console",L(console)],["document",globalThis.document],["JSON",L(JSON)],["Map",H],["Math",L(Math)],["Number",A?Number:U("Number")],["RegExp",J],["Set",B],["String",A?String:U("String")],["WeakMap",_],["WeakSet",V],["MouseEvent",MouseEvent]]),{get(e,t){if(e.has(t))return e.get(t);let n=globalThis[t];return"function"==typeof n&&(n=(G.test(t)?W:q)[t]),e.set(t,n),n},has:(e,t)=>e.has(t)});const Y={WeakSet:WeakSet,WeakMap:WeakMap,WeakValue:class{has(){return!1}set(){}}},{apply:Z}=Reflect;const{Map:ee,WeakMap:te,WeakSet:ne,setTimeout:re}=Q;let oe=!0,ie=e=>{e.clear(),oe=!oe};var se=function(e){const{WeakSet:t,WeakMap:n,WeakValue:r}=this||Y,o=new t,i=new n,s=new r;return function(t){if(o.has(t))return t;if(i.has(t))return i.get(t);if(s.has(t))return s.get(t);const n=Z(e,this,arguments);return o.add(n),n!==t&&("object"==typeof t&&t?i:s).set(t,n),n}}.bind({WeakMap:te,WeakSet:ne,WeakValue:class extends ee{set(e,t){return oe&&(oe=!oe,re(ie,0,this)),super.set(e,t)}}});const{concat:ae,includes:ce,join:le,reduce:ue,unshift:fe}=c([]),{Map:pe,WeakMap:de}=S(globalThis),he=new pe,ye=e=>{const t=(e=>{const t=[];let n=e;for(;n;){if(he.has(n))fe(t,he.get(n));else{const e=g(n);he.set(n,e),fe(t,e)}n=w(n)}return fe(t,{}),o(p,null,t)})("function"==typeof e?e.prototype:e),n={get(e,n){if(n in t){const{value:r,get:o}=t[n];if(o)return s(o,e);if("function"==typeof r)return i(r,e)}return e[n]},set(e,n,r){if(n in t){const{set:o}=t[n];if(o)return s(o,e,r),!0}return e[n]=r,!0}};return e=>new Proxy(e,n)},{isExtensionContext:ge,Array:we,Number:me,String:ve,Object:be}=Q,{isArray:Se}=we,{getOwnPropertyDescriptor:Ee,setPrototypeOf:$e}=be,{toString:xe}=be.prototype,{slice:Re}=ve.prototype,{get:Pe}=Ee(Node.prototype,"nodeType"),ke=ge?{}:{Attr:ye(Attr),CanvasRenderingContext2D:ye(CanvasRenderingContext2D),CSSStyleDeclaration:ye(CSSStyleDeclaration),Document:ye(Document),Element:ye(Element),HTMLCanvasElement:ye(HTMLCanvasElement),HTMLElement:ye(HTMLElement),HTMLImageElement:ye(HTMLImageElement),HTMLScriptElement:ye(HTMLScriptElement),MutationRecord:ye(MutationRecord),Node:ye(Node),ShadowRoot:ye(ShadowRoot),get CSS2Properties(){return ke.CSSStyleDeclaration}},Oe=(e,t)=>{if("Element"!==t&&t in ke)return ke[t](e);if(Se(e))return $e(e,we.prototype);const n=(e=>s(Re,s(xe,e),8,-1))(e);if(n in ke)return ke[n](e);if(n in Q)return $e(e,Q[n].prototype);if("nodeType"in e)switch(s(Pe,e)){case 1:if(!(t in ke))throw new Error("unknown hint "+t);return ke[t](e);case 2:return ke.Attr(e);case 3:return ke.Node(e);case 9:return ke.Document(e)}throw new Error("unknown brand "+n)};var Te=ge?e=>e===window||e===globalThis?Q:e:se(((e,t="Element")=>{if(e===window||e===globalThis)return Q;switch(typeof e){case"object":return e&&Oe(e,t);case"string":return new ve(e);case"number":return new me(e);default:throw new Error("unsupported value")}}));const je={get(e,t){const n=e;for(;!m(e,t);)e=w(e);const{get:r,set:i}=y(e,t);return function(){return arguments.length?o(i,n,arguments):s(r,n)}}},Ae=t=>new e(t,je);let{Array:Le,document:Ce,JSON:Me,Math:Ie,Object:Ne,RegExp:De}=Te(window);function Fe(e,t){const n="/"===e[0]?Te(e).lastIndexOf("/"):0;if(n>0){const r=Te(e).slice(1,n),o=Te(e).slice(n+1);try{return new De(r,o)}catch(e){t&&t("warn",`malformed regex /${r}/${o} (${e.message}), treating pattern as literal text`)}}return new De(Te(e).replace(/[-/\\^$*+?.()|[\]{}]/g,"\\$&"))}function qe(e,t){return e.lastIndex=0,Te(e).test(t)}function We(e,t){const n=Fe(e,t),r=Te(n.flags).includes("g")?n.flags:n.flags+"g";return new De(n.source,r)}function He(e){try{return Me.parse(e)}catch(t){return e}}function Je(e,t,n){let r=e[t];return Le.isArray(r)?(Le.isArray(n)?e[t]=Te(r).concat(n):Te(r).push(n),!0):"object"!=typeof r||null===r||"object"!=typeof n||null===n||Le.isArray(n)?"string"==typeof r?(e[t]=r+Te(n).toString(),!0):(e[t]=n,!1):(Ne.assign(r,n),!0)}function Be(e){const t=E();if("function"==typeof t.sendSnippetHitEvent)try{t.sendSnippetHitEvent(e,Ce.location.hostname)}catch(e){}}function _e(){return Te(Ie.floor(2116316160*Ie.random()+60466176)).toString(36)}function Ve(e){return Te(Le.from(e)).map((e=>`'${e}'`)).join(" ")}let{Math:ze,setInterval:Ue,performance:Xe}=Te(window);const Ge={mark(){},end(){},toString:()=>"{mark(){},end(){}}"};let Ke=!0;function Qe(e,t=10){if(Ke)return Ge;function n(){let e=Te([]);for(let{name:t,duration:n}of Xe.getEntriesByType("measure"))e.push({name:t,duration:n});e.length&&Xe.clearMeasures()}return Qe[e]||(Qe[e]=Ue(n,ze.round(6e4/ze.min(60,t)))),{mark(){Xe.mark(e)},end(t=!1){Xe.measure(e,e);const r=Xe.getEntriesByName(e,"measure"),o=r.length>0?r[r.length-1]:null;console.log("PROFILER:",o),Xe.clearMarks(e),t&&(clearInterval(Qe[e]),delete Qe[e],n())}}}let Ye=!1,Ze=null;function et(){return Ye}const{console:tt}=Te(window),nt=()=>{};function rt(...e){let{mark:t,end:n}=Qe("log");if(et()){const t=["%c DEBUG","font-weight: bold;"],n=e.indexOf("error"),r=e.indexOf("warn"),o=e.indexOf("success"),i=e.indexOf("info");-1!==n?(t[0]+=" - ERROR",t[1]+="color: red; border:2px solid red",Te(e).splice(n,1)):-1!==r?(t[0]+=" - WARNING",t[1]+="color: orange; border:2px solid orange ",Te(e).splice(r,1)):-1!==o?(t[0]+=" - SUCCESS",t[1]+="color: green; border:2px solid green",Te(e).splice(o,1)):-1!==i&&(t[1]+="color: black;",Te(e).splice(i,1)),Te(e).unshift(...t);const s=Ze;if(s){if(!Te(e).some((e=>qe(s,e))))return}}t(),tt.log(...e),n()}function ot(e){return i(et()?rt:nt,null,e)}const{Function:it,Object:st,WeakMap:at}=Te(window);let ct=!1;const lt=new at;function ut(e,t){ct||function(){const{toString:e}=it.prototype,t=l(e,(function(){const t=lt.get(this);return o(e,void 0!==t?t:this,arguments)}));st.defineProperty(window.Function.prototype,"toString",{value:t}),lt.set(t,e),ct=!0}(),lt.set(e,t)}let{parseFloat:ft,variables:pt,clearTimeout:dt,fetch:ht,setTimeout:yt,Array:gt,Error:wt,Map:mt,Object:vt,ReferenceError:bt,Set:St,WeakMap:Et}=Te(window),{onerror:$t}=Ae(window),xt=Node.prototype,Rt=Element.prototype,Pt=null;function kt(e,t,n,r=!0){let o=Te(t),i=o.indexOf(".");if(-1==i){let o=vt.getOwnPropertyDescriptor(e,t);if(o&&!o.configurable)return;let i=vt.assign({},n,{configurable:r});if(!o&&!i.get&&i.set){let n=e[t];i.get=()=>n}return void vt.defineProperty(e,t,i)}let s=o.slice(0,i).toString();t=o.slice(i+1).toString();let a=e[s];!a||"object"!=typeof a&&"function"!=typeof a||kt(a,t,n,r);let c=vt.getOwnPropertyDescriptor(e,s);if(c&&!c.configurable)return;Pt||(Pt=new Et),Pt.has(e)||Pt.set(e,new mt);let l=Pt.get(e);if(l.has(s))return void l.get(s).set(t,n);let u=new mt([[t,n]]);l.set(s,u),vt.defineProperty(e,s,{get:()=>a,set(e){if(a=e,a&&("object"==typeof a||"function"==typeof a))for(let[e,t]of u)kt(a,e,t,r)},configurable:r})}function Ot(e){let t=$t();$t(((...n)=>{let r=n.length&&n[0];return!("string"!=typeof r||!Te(r).includes(e))||("function"==typeof t?o(t,this,n):void 0)}))}function Tt(e,t,n,r="",o=!0){let i=ot(e);if(!n)return void i("error","no property to abort on read");let s=_e(),a=!1;i("info",`aborting on ${n} access`),kt(t,n,{get:function(){throw i("success",`${n} access aborted`,`\nFILTER: ${e} ${r}`),a||(a=!0,Be(`${e} ${r}`)),new bt(s)},set(){}},o),Ot(s)}function jt(e,t,n,r="",o=!0){let i=ot(e);if(!n)return void i("error","no property to abort on write");let s=_e(),a=!1;i("info",`aborting when setting ${n}`),kt(t,n,{set:function(){throw i("success",`setting ${n} aborted`,`\nFILTER: ${e} ${r}`),a||(a=!0,Be(`${e} ${r}`)),new bt(s)}},o),Ot(s)}function At(e,t=!1,n=!1){let r=pt.abortedIframes,i=pt.iframePropertiesToAbort;const a=Ve(e);for(let o of gt.from(window.frames))if(r.has(o))for(let i of e)t&&r.get(o).read.add({property:i,formattedProperties:a}),n&&r.get(o).write.add({property:i,formattedProperties:a});for(let r of e)t&&i.read.add({property:r,formattedProperties:a}),n&&i.write.add({property:r,formattedProperties:a});function c(){for(let e of gt.from(window.frames)){r.has(e)||r.set(e,{read:new St(i.read),write:new St(i.write)});let t=r.get(e).read;if(t.size>0){let n=gt.from(t);t.clear();for(let{property:t,formattedProperties:r}of n)Tt("abort-on-iframe-property-read",e,t,r)}let n=r.get(e).write;if(n.size>0){let t=gt.from(n);n.clear();for(let{property:n,formattedProperties:r}of t)jt("abort-on-iframe-property-write",e,n,r)}}}c(),r.has(document)||(r.set(document,!0),function(e){let t;function n(e,t){for(let n of t){kt(e,n,r(e,n))}}function r(t,n){let r=t[n],i=function(...t){let n;return n=o(r,this,t),e&&e(),n};return ut(i,r),{get:()=>i}}function i(t,n){let r=vt.getOwnPropertyDescriptor(t,n),{set:o}=r||{};return{set(t){let n;return n=s(o,this,t),e&&e(),n}}}n(xt,["appendChild","insertBefore","replaceChild"]),n(Rt,["append","prepend","replaceWith","after","before","insertAdjacentElement","insertAdjacentHTML"]),t=i(Rt,"innerHTML"),kt(Rt,"innerHTML",t),t=i(Rt,"outerHTML"),kt(Rt,"outerHTML",t)}(c))}let{Object:Lt}=window;function Ct(e,t){if(!(e instanceof Lt))return;let n=e,r=Te(t).split(".");if(0===r.length)return;for(let e=0;e<r.length-1;e++){let t=r[e];if(!m(n,t))return;if(n=n[t],!(n instanceof Lt))return}let o=r[r.length-1];return m(n,o)?[n,o]:void 0}const Mt=Te(/^\d+$/);function It(e){switch(e){case"false":return!1;case"true":return!0;case"falseStr":return"false";case"trueStr":return"true";case"null":return null;case"noopFunc":return()=>{};case"trueFunc":return()=>!0;case"falseFunc":return()=>!1;case"emptyArray":return[];case"emptyObj":return{};case"undefined":return;case"":return e;default:return Mt.test(e)?ft(e):e}}function Nt(e,t){if(!e||!e.length)return!0;const n=_e(),r=new wt(n),o=new URL(self.location.href);o.hash="";const i=/(.*?@)?(\S+)(:\d+):\d+\)?$/,s=[];for(let e of r.stack.split(/[\n\r]+/)){if(Te(e).includes(n))continue;e=Te(e).trim();const t=Te(i).exec(e);if(null===t)continue;let r=t[2];Te(r).startsWith("(")&&(r=Te(r).slice(1)),r===o.href?r="inlineScript":Te(r).startsWith("<anonymous>")&&(r="injectedScript");let a=t[1]?Te(t[1]).slice(0,-1):Te(e).slice(0,Te(t).index).trim();Te(a).startsWith("at")&&(a=Te(a).slice(2).trim());let c=t[3];Te(s).push(" "+`${a} ${r}${c}:1`.trim())}s[0]="stackDepth:"+(s.length-1);const a=Te(s).join("\n");for(let n of e){if(qe(Fe(n,t),a))return t("info",`Found needle in stack trace: ${n}`),!0}return t("info",`Stack trace does not match any needle. Stack trace: ${a}`),!1}new mt;let{HTMLScriptElement:Dt,Object:Ft,ReferenceError:qt}=Te(window),Wt=Ft.getPrototypeOf(Dt);const{Error:Ht,Object:Jt,Array:Bt,Map:_t}=Te(window);let Vt=null;const zt=new Set;function Ut(e){zt.has(e)||(zt.add(e),Be(e))}function Xt(e,t,n){let r=e;for(const e of n){if(!r||!m(r,e))return!1;r=r[e]}if("string"==typeof r||"number"==typeof r){return qe(t,r.toString())}return!1}const{Array:Gt,Blob:Kt,Error:Qt,Object:Yt,Reflect:Zt}=Te(window),en=[],tn=new Set;let{Error:nn,URL:rn}=Te(window),{cookie:on}=Ae(document);const{Map:sn,Object:an,Reflect:cn,WeakMap:ln}=Te(window),un=window.EventTarget.prototype.addEventListener,fn=window.EventTarget.prototype.removeEventListener,pn=new ln;let dn=[];const hn=new Set;function yn(e){hn.has(e)||(hn.add(e),Be(e))}let{console:gn,document:wn,getComputedStyle:mn,isExtensionContext:vn,variables:bn,Array:Sn,MutationObserver:En,Object:$n,DOMMatrix:xn,XPathEvaluator:Rn,XPathExpression:Pn,XPathResult:kn}=Te(window);const{querySelectorAll:On}=wn,Tn=On&&i(On,wn);function jn(e,t=!1){return Cn(e,Tn.bind(wn),wn,t)}function An(e,t,n,r){const o=t.getAttribute("xlink:href")||t.getAttribute("href");if(o){const s=Tn(o)[0];if(!s&&et())return gn.log("No elements found matching",o),!1;if(!(i=e)||0===i.length||i.every((e=>""===e.trim()))){const e=r.length>0?r:[];return n.push({element:s,rootParents:[...e,t]}),!1}const a=s.querySelectorAll.bind(s);return{nextBoundElement:s,nestedSelectorsString:e.join("^^"),next$$:a}}var i}function Ln(e,t){const n=function(e,t=!1){try{const n=navigator.userAgent.includes("Firefox")?e.openOrClosedShadowRoot:browser.dom.openOrClosedShadowRoot(e);return null===n&&et()&&!t&&gn.log("Shadow root not found or not added in element yet",e),n}catch(n){return et()&&!t&&gn.log("Error while accessing shadow root",e,n),null}}(t);if(n){const{querySelectorAll:r}=n,o=r&&i(r,n).bind(n);return{nextBoundElement:t,nestedSelectorsString:":host "+e.join("^^"),next$$:o}}return!1}function Cn(e,t,n,r,o=[]){if(e.includes("^^")){const[i,s,...a]=e.split("^^");let c,l;switch(s){case"svg":l=An;break;case"sh":l=Ln;break;default:return et()&&gn.log(s," is not supported. Supported commands are: \n^^sh^^\n^^svg^^"),[]}c=""===i.trim()?[n]:t(i);const u=[];for(const e of c){const t=l(a,e,u,o);if(!t)continue;const{next$$:n,nestedSelectorsString:i,nextBoundElement:s}=t,c=Cn(i,n,s,r,[...o,e]);c&&u.push(...c)}return u}const i=t(e);return r?[...i].map((e=>({element:e,rootParents:o.length>0?o:[]}))):i}const{assign:Mn,setPrototypeOf:In}=$n;class Nn extends Pn{evaluate(...e){return In(o(super.evaluate,this,e),kn.prototype)}}class Dn extends Rn{createExpression(...e){return In(o(super.createExpression,this,e),Nn.prototype)}}function Fn(e){if(bn.hidden.has(e))return!1;!function(e){vn&&"function"==typeof checkElement&&checkElement(e)}(e),bn.hidden.add(e);let{style:t}=Te(e),n=Te(t,"CSSStyleDeclaration"),r=Te([]);const o=E();let{debugCSSProperties:i}=o;for(let[e,t]of i||[["display","none"]])n.setProperty(e,t,"important"),r.push([e,n.getPropertyValue(e)]);return new En((()=>{for(let[e,t]of r){let r=n.getPropertyValue(e),o=n.getPropertyPriority(e);r==t&&"important"==o||n.setProperty(e,t,"important")}})).observe(e,{attributes:!0,attributeFilter:["style"]}),!0}function qn(e){let t=e;if(t.startsWith("xpath(")&&t.endsWith(")")){let t=function(e){let t=e;if(t.startsWith("xpath(")&&t.endsWith(")")){let e=t.slice(6,-1),n=(new Dn).createExpression(e,null),r=kn.ORDERED_NODE_SNAPSHOT_TYPE;return e=>{if(!e)return;let t=n.evaluate(wn,r,null),{snapshotLength:o}=t;for(let n=0;n<o;n++)e(t.snapshotItem(n))}}return t=>jn(e).forEach(t)}(e);return()=>{let e=Te([]);return t((t=>e.push(t))),e}}return()=>Sn.from(jn(e))}let{ELEMENT_NODE:Wn,TEXT_NODE:Hn,prototype:Jn}=Node,{prototype:Bn}=Element,{prototype:_n}=HTMLElement,{console:Vn,variables:zn,DOMParser:Un,Error:Xn,MutationObserver:Gn,Object:Kn,ReferenceError:Qn}=Te(window),{getOwnPropertyDescriptor:Yn}=Kn;const{CanvasRenderingContext2D:Zn,document:er,Map:tr,MutationObserver:nr,Object:rr,requestAnimationFrame:or,Set:ir,WeakMap:sr,WeakSet:ar}=Te(window);let cr,lr=new sr,ur=new ar,fr=new ir,pr=new ar;const dr=new ir;let hr=!1,yr=!1,gr=!1,wr=new ir;function mr(e,t){ur.add(e),lr.delete(e);const n=Te(e).closest(t.selector);if(n&&!pr.has(n)){Fn(n),pr.add(n),ot("hide-if-canvas-contains")("success","Matched: ",n,`\nFILTER: hide-if-canvas-contains ${t.formattedArguments}`);const e="hide-if-canvas-contains "+t.formattedArguments;dr.has(e)||(dr.add(e),Be(e))}else!function(e,t){fr.add({canvasElement:e,rule:t})}(e,t)}function vr(e){hr&&e&&!ur.has(e)&&(wr.add(e),gr||(gr=!0,or(br)))}function br(){gr=!1;const e=wr;wr=new ir;const t=ot("hide-if-canvas-contains");for(const n of e){if(ur.has(n))continue;let e=null,r=!1;for(const[o,i]of cr)if("data"===i.mode&&Te(n).closest(i.selector)&&!r){if(null===e)try{e=Te(n).toDataURL().toString()}catch(e){t("info","Could not read canvas data URL:",e.message),r=!0;continue}qe(o,e)&&mr(n,i)}}}Te(window);const{Map:Sr,MutationObserver:Er,Object:$r,Set:xr,WeakSet:Rr}=Te(window);let Pr=Element.prototype,{attachShadow:kr}=Pr,Or=new Rr,Tr=new Sr;const jr=new xr;let Ar=null;const{Error:Lr,Object:Cr,Array:Mr,parseFloat:Ir,isNaN:Nr}=Te(window);class Dr{constructor(e){if("string"!=typeof e)throw new Lr("JSONPath: query must be a string");if(!e.length)throw new Lr("JSONPath: query must be a non-empty string");this._steps=this._tokenize(e)}_tokenize(e){e=Te(e);const t=new Mr;let n=0;for("$"===e[0].toString()&&(n=1);n<e.length;){let r=!1;if(e.startsWith("..",n)?(r=!0,n+=2):"."===e[n].toString()&&n++,"["===e[n].toString()){const o=e.indexOf("]",n);if(-1===o)throw new Lr(`JSONPath: unclosed bracket in query "${e}"`);const i=e.slice(n+1,o);if(!i.length)throw new Lr(`JSONPath: empty bracket notation in query "${e}"`);i.startsWith("?(")?t.push({type:"filter",key:"?",filter:this._parseFilter(i),recursive:r}):t.push({type:"direct",key:i.replace(/['"]/g,"").toString(),recursive:r}),n=o+1}else{const o=e.slice(n).search(/[.[]/),i=-1===o?e.slice(n).toString():e.slice(n,n+o).toString();if(!i&&!r)throw new Lr(`JSONPath: trailing dot with no property name in query "${e}"`);(i||r)&&t.push({type:"direct",key:i||"*",recursive:r}),n+=i.length}}return t}_parseFilter(e){const t=(e=Te(e)).match(/(?:[@.]?)([\w]+(?:\.[\w]+)*)\s*([!=^$*]=|[<>]=?)\s*(?:['"](.+?)['"]|([\w.+-]+))\)/);if(!t)throw new Lr(`JSONPath: invalid filter expression "${e}"`);return{property:t[1],operator:t[2],target:null!=t[3]?t[3]:t[4]}}evaluate(e){if(!e||"object"!=typeof e)throw new Lr("JSONPath: evaluate() requires an object or array");let t=Te([{parent:{root:e},key:"root"}]);for(const e of this._steps){const n=[];for(const{parent:r,key:o}of t){const t=r[o];t&&"object"==typeof t&&(e.recursive?this._deepSearch(t,e,n):this._match(t,e,n))}t=n}return t}_match(e,t,n){const r="*"===t.key||"?"===t.key?Cr.keys(e):[t.key];for(const o of r)if(m(e,o)){if("?"===t.key&&!this._test(e[o],t.filter))continue;n.push({parent:e,key:o})}}_deepSearch(e,t,n,r=1e4){if(this._match(e,t,n),!(r<=0))for(const o of Cr.keys(e))e[o]&&"object"==typeof e[o]&&this._deepSearch(e[o],t,n,r-1)}_test(e,t){if(!t||!e)return!1;let n=e;for(const e of Te(t.property).split(".")){if(null==n||"object"!=typeof n)return!1;n=n[e]}const r=Te(n),o=Te(t.target),i=r.toString(),s=o.toString(),a=Ir(r),c=Ir(o),l=!Nr(a)&&!Nr(c);switch(t.operator){case"==":return l?a===c:i===s;case"!=":return l?a!==c:i!==s;case"<":return l?a<c:i<s;case"<=":return l?a<=c:i<=s;case">":return l?a>c:i>s;case">=":return l?a>=c:i>=s;case"^=":return r.startsWith(o);case"$=":return r.endsWith(o);case"*=":return r.includes(o);default:return!1}}}const{Array:Fr,Error:qr,JSON:Wr,Map:Hr,Object:Jr,Response:Br}=Te(window);let _r=null;const Vr=new Set;function zr(e){Vr.has(e)||(Vr.add(e),Be(e))}let{Array:Ur,Error:Xr,JSON:Gr,Map:Kr,Object:Qr,Response:Yr}=Te(window),Zr=null;const eo=new Set;function to(e){eo.has(e)||(eo.add(e),Be(e))}const{Error:no,Object:ro,Map:oo}=Te(window);let io=null;const so=new Set;function ao(e){so.has(e)||(so.add(e),Be(e))}function co(e,t,n){if(!n.length){if("string"==typeof e||"number"==typeof e){return qe(t,e.toString())}return!1}let r=e;for(const e of n){if(!r||!m(r,e))return!1;r=r[e]}if("string"==typeof r||"number"==typeof r){return qe(t,r.toString())}return!1}let{Error:lo}=Te(window);const{Array:uo,addEventListener:fo,Error:po,Object:ho,Reflect:yo,Set:go,WeakSet:wo}=Te(window),mo=new wo,vo=new uo,bo=new go,So=new go;let{Error:Eo,Map:$o,Object:xo,console:Ro}=Te(window),{toString:Po}=Function.prototype,ko=EventTarget.prototype,{addEventListener:Oo}=ko,To=null;const jo=new Set;const Ao=Proxy,{toStringTag:Lo}=Symbol,{defineProperty:Co,deleteProperty:Mo,get:Io,getOwnPropertyDescriptor:No,has:Do,set:Fo}=f(Reflect),{Array:qo,Error:Wo,Map:Ho,Object:Jo,Set:Bo,document:_o,parseFloat:Vo,setTimeout:zo}=Te(window),Uo=new qo,Xo=new Bo;function Go(e){Xo.has(e)||(Xo.add(e),Be(e))}const Ko=new Bo(["closed","close","opener","frameElement","parent","top","self","window","globalThis","frames","location","document","history",Lo]);let{Array:Qo,Map:Yo,Object:Zo,parseInt:ei,Set:ti}=Te(window);const ni=new Yo,ri=new ti,oi=new ti;let{fetch:ii,Request:si}=Te(window),ai=!1;const ci=[],li=[],ui=[],fi=()=>{if(!ai){let e=l(ii,((...e)=>{let[t,n]=e,r="string"==typeof t?t:t&&"string"==typeof t.url?t.url:"";if(ci.length>0&&"string"==typeof t){let n;try{n=new URL(t)}catch(e){if(!(e instanceof TypeError))throw e;n=new URL(t,Te(document).location)}ci.forEach((e=>e(n))),e[0]=n.href,r=n.href}const i=e=>o(ii,self,e).then((e=>{let t=e;return li.forEach((e=>{t=e(t,{url:r})})),t})),s=e=>{let t=e;return ui.forEach((e=>{t=e(t)})),t};if(ui.length>0)if(n&&"string"==typeof n.body){const t=s(n.body);t!==n.body&&(e[1]=Object.assign({},n,{body:t}))}else if(t&&"function"==typeof t.clone&&(!n||null==n.body)&&"GET"!==t.method&&"HEAD"!==t.method)return t.clone().text().then((n=>{if(!n)return i(e);const r=s(n);if(r===n)return i(e);const o=new si(t,{body:r,referrer:t.referrer,referrerPolicy:t.referrerPolicy});return i([o,...e.slice(1)])})).catch((()=>i(e)));return i(e)}));ut(e,window.fetch),window.fetch=e,ai=!0}},pi=e=>{li.push(e),fi()};let di,{Error:hi,JSON:yi}=Te(window);const gi=new Set;let wi,{Map:mi,Object:vi,Response:bi}=Te(window);const Si=new Set;const{Error:Ei,Object:$i,atob:xi,btoa:Ri}=Te(window);let{XMLHttpRequest:Pi,WeakMap:ki,Object:Oi}=Te(window),Ti=!1;const ji=[],Ai=[],Li=new ki,Ci=()=>{if(Ti)return;const e=class extends Pi{open(e,t,...n){return Li.set(this,{method:e,url:t}),super.open(e,t,...n)}send(e){let t=e;if("string"==typeof e&&ji.length>0)for(const e of ji)t=e(t);return super.send(t)}get response(){const e=super.response;if(0===Ai.length)return e;const t=Li.get(this);if(void 0===t)return e;const n="string"==typeof e?e.length:void 0;if(t.lastResponseLength!==n&&(t.cachedResponse=void 0,t.lastResponseLength=n),void 0!==t.cachedResponse)return t.cachedResponse;if("string"!=typeof e)return t.cachedResponse=e;let r=e;for(const e of Ai)r=e(r,{url:t.url});return t.cachedResponse=r}get responseText(){const e=this.response;return"string"!=typeof e?super.responseText:e}};ut(e,window.XMLHttpRequest),ut(e.prototype.open,window.XMLHttpRequest.prototype.open),ut(e.prototype.send,window.XMLHttpRequest.prototype.send),ut(Oi.getOwnPropertyDescriptor(e.prototype,"response").get,Oi.getOwnPropertyDescriptor(window.XMLHttpRequest.prototype,"response").get),ut(Oi.getOwnPropertyDescriptor(e.prototype,"responseText").get,Oi.getOwnPropertyDescriptor(window.XMLHttpRequest.prototype,"responseText").get),window.XMLHttpRequest=e,Ti=!0},Mi=e=>{Ai.push(e),Ci()};let Ii,{Error:Ni,JSON:Di}=Te(window);const Fi=new Set;let qi,{JSON:Wi}=Te(window);const Hi=new Set;let Ji,{delete:Bi,has:_i}=c(URLSearchParams.prototype);const Vi=new Set;const{Error:zi,Object:Ui,parseInt:Xi,isNaN:Gi}=Te(window),{toString:Ki}=Function.prototype,Qi=window.setTimeout,Yi=window.setInterval,Zi={TIMEOUT:"timeout",INTERVAL:"interval",BOTH:"both"};let es=null;const ts=new Set;const{Array:ns,Date:rs,Object:os,Set:is,WeakSet:ss,document:as,parseInt:cs,window:ls}=Te(window);let us=!1;const fs="param_first",ps="param_second",ds="pyv",hs="client_screen",ys="ad_type",gs="none",ws="eAFgAQ",ms="8AUB",vs="CHANNEL",bs=["playerErrorMessageRenderer","UNPLAYABLE"];function Ss(e){if(!e||"object"!=typeof e)return!1;let t=!1;e.adSlots&&(delete e.adSlots,t=!0),e.playerAds&&(delete e.playerAds,t=!0);const n=e.playerConfig&&e.playerConfig.audioConfig;n&&n.muteOnStart&&(delete n.muteOnStart,t=!0);const r=e.messages;return r&&r[0]&&r[0].youThereRenderer&&(delete r[0].youThereRenderer,t=!0),t}function Es(e,t){if(!e||"object"!=typeof e)return!1;if(null===t||!(t>0))return!1;e.playerConfig||(e.playerConfig={}),e.playerConfig.playbackStartConfig||(e.playerConfig.playbackStartConfig={});const n=e.playerConfig.playbackStartConfig;return n.startSeconds!==t&&(n.startSeconds=t,!0)}function $s(e){if("string"!=typeof e||0===e.length)return null;const t=/[?&]t=([^&#]+)/.exec(e);if(!t)return null;let n=t[1];try{n=decodeURIComponent(n)}catch(e){}if(/^\d+$/.test(n))return cs(n,10);const r=/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i.exec(n);if(!r||!r[1]&&!r[2]&&!r[3])return null;return 3600*cs(r[1]||"0",10)+60*cs(r[2]||"0",10)+cs(r[3]||"0",10)}const{Date:xs,MutationObserver:Rs,Set:Ps,document:ks,parseInt:Os,setTimeout:Ts,window:js}=Te(window);let As=!1;function Ls(e,t){if(null==e)return;const n=e[t];if("function"==typeof n)try{return n.call(e)}catch(e){return}}function Cs(e,t){const n=function(e){if("string"!=typeof e||0===e.length)return"";let t=e;const n=t.indexOf("?");-1!==n&&(t=t.slice(0,n));const r=t.indexOf("#");-1!==r&&(t=t.slice(0,r));const o=t.indexOf("://");-1!==o&&(t=t.slice(o+3));const i=t.indexOf("/");if(-1===i)return"";const s=t.slice(i),a=/^\/([^/]+)/.exec(s);return a?a[1].toLowerCase():""}(e);for(let e=0;e<t.deny.length;e++)if(t.deny[e]===n)return!1;if(0===t.allow.length)return!0;for(let e=0;e<t.allow.length;e++)if(t.allow[e]===n)return!0;return!1}const Ms={"abort-current-inline-script":function(e,t=null){const n=Ve(arguments),r=ot("abort-current-inline-script"),{mark:o,end:i}=Qe("abort-current-inline-script"),a=t?Fe(t,r):null,c=_e(),l=Te(document).currentScript;let u=!1,f=window;const p=Te(e).split("."),d=Te(p).pop();for(let e of Te(p))if(f=f[e],!f||"object"!=typeof f&&"function"!=typeof f)return void r("warn",p," is not found");const{get:h,set:y}=Ft.getOwnPropertyDescriptor(f,d)||{};let g=f[d];void 0===g&&r("warn","The property",d,"doesn't exist yet. Check typos.");const w=()=>{const e=Te(document).currentScript;if(e instanceof Wt&&""==Te(e,"HTMLScriptElement").src&&e!=l&&(!a||qe(a,Te(e).textContent)))throw r("success",p," is aborted \n",e,"\nFILTER: abort-current-inline-script",n),u||(u=!0,Be("abort-current-inline-script "+n)),new qt(c)},m={get(){return w(),h?s(h,this):g},set(e){w(),y?s(y,this,e):g=e}};o(),kt(f,d,m),i(),Ot(c)},"abort-on-iframe-property-read":function(...e){const{mark:t,end:n}=Qe("abort-on-iframe-property-read");t(),At(e,!0,!1),n()},"abort-on-iframe-property-write":function(...e){const{mark:t,end:n}=Qe("abort-on-iframe-property-write");t(),At(e,!1,!0),n()},"abort-on-property-read":function(e,t){const n=!("false"===t),r=Ve(arguments),{mark:o,end:i}=Qe("abort-on-property-read");o(),Tt("abort-on-property-read",window,e,r,n),i()},"abort-on-property-write":function(e,t){const n=Ve(arguments),{mark:r,end:o}=Qe("abort-on-property-write"),i=!("false"===t);r(),jt("abort-on-property-write",window,e,n,i),o()},"array-override":function(e,t,n="false",r,i){if(!e)throw new Ht("[array-override snippet]: Missing method to override.");if(!t)throw new Ht("[array-override snippet]: Missing needle.");Vt||(Vt=new _t);let s=ot("array-override");const{mark:a,end:c}=Qe("array-override"),u=Ve(arguments);if("push"!==e||Vt.has("push"))if("includes"!==e||Vt.has("includes")){if("forEach"===e&&!Vt.has("forEach")){a();const{forEach:e}=Bt.prototype;Vt.set("forEach",Te([]));let t=l(e,(function(t,n){const r=Vt.get("forEach");return o(e,this,[function(e,i,a){for(const{needleRegex:t,pathSegments:n,stackNeedles:o,formattedArgs:i}of r)if(n.length||"string"!=typeof e&&"number"!=typeof e){if(n.length&&"object"==typeof e&&null!==e&&Xt(e,t,n)&&Nt(o,s))return s("success",`Array.forEach skipped callback for object containing needle: ${t}\nFILTER: array-override ${i}`),void Ut("array-override "+i)}else{const n=e.toString();if(n.match&&n.match(t)&&Nt(o,s))return s("success",`Array.forEach skipped callback for item matching needle: ${t}\nFILTER: array-override ${i}`),void Ut("array-override "+i)}return o(t,n||this,[e,i,a])},n])}));ut(t,e),Jt.defineProperty(window.Array.prototype,"forEach",{value:t}),s("info","Wrapped Array.prototype.forEach"),c()}}else{a();const{includes:e}=Bt.prototype;Vt.set("includes",Te([]));let t=l(e,(function(t){const n=Vt.get("includes");for(const{needleRegex:e,retVal:r,pathSegments:o,stackNeedles:i,formattedArgs:a}of n)if(o.length||"string"!=typeof t&&"number"!=typeof t){if(o.length&&"object"==typeof t&&null!==t&&Xt(t,e,o)&&Nt(i,s))return s("success",`Array.includes returned ${r} for object containing ${e}\nFILTER: array-override ${a}`),Ut("array-override "+a),r}else if(t.toString().match&&t.toString().match(e)&&Nt(i,s))return s("success",`Array.includes returned ${r} for ${e}\nFILTER: array-override ${a}`),Ut("array-override "+a),r;return o(e,this,arguments)}));ut(t,e),Jt.defineProperty(window.Array.prototype,"includes",{value:t}),s("info","Wrapped Array.prototype.includes"),c()}else{a();const{push:e}=Bt.prototype;Vt.set("push",Te([]));let t=l(e,(function(t){const n=Vt.get("push");for(const{needleRegex:e,pathSegments:r,stackNeedles:o,formattedArgs:i}of n)if(r.length||"string"!=typeof t&&"number"!=typeof t){if(r.length&&"object"==typeof t&&null!==t&&Xt(t,e,r)&&Nt(o,s))return s("success",`Array.push is ignored for object containing needle: ${e}\nFILTER: array-override ${i}`),void Ut("array-override "+i)}else{const n=t.toString();if(n.match&&n.match(e)&&Nt(o,s))return s("success",`Array.push is ignored for needle: ${e}\nFILTER: array-override ${i}`),void Ut("array-override "+i)}return o(e,this,arguments)}));ut(t,e),Jt.defineProperty(window.Array.prototype,"push",{value:t}),s("info","Wrapped Array.prototype.push"),c()}const f=Fe(t,s);let p=[];r&&(p=r.split("."));let d=[];i&&(d=i.split(",").map((e=>e.trim())));const h=Vt.get(e),y="true"===n;h.push({needleRegex:f,retVal:y,pathSegments:p,stackNeedles:d,formattedArgs:u}),Vt.set(e,h)},"blob-override":function(e,t="",n=null){if(!e)throw new Qt("[blob-override snippet]: Missing parameter search.");const r=ot("blob-override"),o=Ve(arguments),{mark:i,end:s}=Qe("blob-override");if(i(),en.push({match:Fe(e,r),replaceWith:t,needle:n?Fe(n,r):null,formattedArgs:o}),en.length>1)return;const a=Kt;function c(e,t={}){if(Gt.isArray(e)){let t=Te(e).join("");for(const e of Te(en))if((!e.needle||qe(e.needle,t))&&qe(e.match,t)){t=t.replace(e.match,e.replaceWith),r("success",`Replaced: ${e.match} → ${e.replaceWith},\nFILTER: blob-override ${e.formattedArgs}`);const n="blob-override "+e.formattedArgs;tn.has(n)||(tn.add(n),Be(n))}e=[t]}const n=Zt.construct(a,[e,t]);return Yt.setPrototypeOf(n,c.prototype),n}c.prototype=a.prototype,Yt.setPrototypeOf(c,a),ut(c,window.Blob),window.Blob=c,r("info","Wrapped Blob constructor in context "),s()},"cookie-remover":function(e,t=!1){if(!e)throw new nn("[cookie-remover snippet]: No cookie to remove.");const n=Ve(arguments);let r=ot("cookie-remover");const{mark:o,end:i}=Qe("cookie-remover");let s=Fe(e,r),a=!1;if(!Te(/^http|^about/).test(location.protocol))return void r("warn","Snippet only works for http or https and about.");function c(){return Te(on()).split(";").filter((e=>qe(s,Te(e).split("=")[0])))}const l=()=>{r("info","Parsing cookies for matches"),o();for(const e of Te(c())){let t=Te(location.hostname);!t&&Te(location.ancestorOrigins)&&Te(location.ancestorOrigins[0])&&(t=new rn(Te(location.ancestorOrigins[0])).hostname);const o=Te(e).split("=")[0],i="expires=Thu, 01 Jan 1970 00:00:00 GMT",s="path=/",c=t.split(".");for(let e=c.length;e>0;e--){const t=c.slice(c.length-e).join(".");on(`${Te(o).trim()}=;${i};${s};domain=${t}`),on(`${Te(o).trim()}=;${i};${s};domain=.${t}`),r("success",`Set expiration date on ${o}`,"\nFILTER: cookie-remover",n),a||(a=!0,Be("cookie-remover "+n))}}i()};if(l(),t){let e=c();setInterval((()=>{let t=c();if(t!==e)try{l()}finally{e=t}}),1e3)}},debug:function(e){Ye=!0,e&&(Ze=Fe(e))},"event-override":function(e,t,n=null,r=null,i=null,a=""){const c=Ve(arguments);let u=ot("[event-override]");if(!("rewrite"!==t||r&&i))return void u("error",`rewrite mode requires the property and pattern params.\nFILTER: event-override ${c}`);const f={eventType:e,mode:t,needle:n?Fe(n,u):null,property:r,search:"rewrite"===t?We(i,u):null,replacement:a,formattedArgs:c};if(dn.includes(f)||dn.push(f),dn.length>1)return;const{mark:p,end:d}=Qe("event-override"),h=an.getOwnPropertyDescriptor(window.EventTarget.prototype,"addEventListener");if(h.configurable){let e=l(un,(function(e,t,n){p();const r=dn.filter((t=>t.eventType===e));if(!r.length||e!==r[0].eventType)return d(),o(un,this,arguments);const i=r.find((e=>"disable"===e.mode&&(!e.needle||qe(e.needle,t.toString()))));if(i)return u("success",`Disabling ${i.eventType} event, \nFILTER: event-override ${i.formattedArgs}`),yn("event-override "+i.formattedArgs),void d();const a=r.filter((e=>"trusted"===e.mode&&(!e.needle||qe(e.needle,t.toString())))),c=r.filter((e=>"rewrite"===e.mode&&(!e.needle||qe(e.needle,t.toString()))));if(!("function"==typeof t||t&&"function"==typeof t.handleEvent)||!a.length&&!c.length)return d(),o(un,this,arguments);const l=function(e){const n=new Proxy(e,{get(t,n){if("isTrusted"===n&&a.length)return u("success",`Providing trusted value for ${e.type} event`),yn("event-override "+a[0].formattedArgs),!0;const r=cn.get(t,n);if(c.length&&"string"==typeof r){const t=c.find((e=>e.property===n));if(t){const o=Te(r).replace(t.search,t.replacement).toString();if(o!==r)return u("success",`Rewriting ${n} of ${e.type} event, \nFILTER: event-override ${t.formattedArgs}`),yn("event-override "+t.formattedArgs),o}}return"function"==typeof r?function(...e){return o(r,t,e)}:r}});return"function"==typeof t?s(t,this,n):s(t.handleEvent,t,n)};return l.originalListener=t,pn.has(t)||pn.set(t,new sn),pn.get(t).set(e,l),u("info",`\nWrapping event listener for ${e}`),d(),o(un,this,[e,l,n])}));ut(e,un),an.defineProperty(window.EventTarget.prototype,"addEventListener",{...h,value:e})}const y=an.getOwnPropertyDescriptor(window.EventTarget.prototype,"removeEventListener");if(y.configurable){let e=l(fn,(function(e,t,n){if(t&&pn.has(t)&&pn.get(t).has(e)){const r=pn.get(t).get(e);return pn.get(t).delete(e),o(fn,this,[e,r,n])}return o(fn,this,arguments)}));ut(e,fn),an.defineProperty(window.EventTarget.prototype,"removeEventListener",{...y,value:e})}u("info","Initialized event-override snippet")},"freeze-element":function(e,t="",...n){const r=Ve(arguments);let i,a,c=!1,l=!1,u=Te(n).filter((e=>!y(e))),f=Te(n).filter((e=>y(e))).map(Fe),p=_e(),d=qn(e);!function(){let n=Te(t).split("+");1===n.length&&""===n[0]&&(n=[]);for(let t of n)switch(t){case"subtree":c=!0;break;case"abort":l=!0;break;default:throw new Xn("[freeze] Unknown option passed to the snippet. [selector]: "+e+" [option]: "+t)}}();let h={selector:e,shouldAbort:l,rid:p,exceptionSelectors:u,regexExceptions:f,changeId:0};function y(e){return e.length>=2&&"/"==e[0]&&"/"==e[e.length-1]}function g(){a=d(),w(a,!1)}function w(e,t=!0){for(let n of e)zn.frozen.has(n)||(zn.frozen.set(n,h),!t&&c&&new Gn((e=>{for(let t of Te(e))w(Te(t,"MutationRecord").addedNodes)})).observe(n,{childList:!0,subtree:!0}),c&&Te(n).nodeType===Wn&&w(Te(n).childNodes))}function m(e,...t){rt(`[freeze][${e}] `,...t)}function v(e,t,n,r){let o=r.selector,i=r.changeId,s="string"==typeof e,a=r.shouldAbort?"aborting":"watching";switch(Vn.groupCollapsed(`[freeze][${i}] ${a}: ${o}`),n){case"appendChild":case"append":case"prepend":case"insertBefore":case"replaceChild":case"insertAdjacentElement":case"insertAdjacentHTML":case"insertAdjacentText":case"innerHTML":case"outerHTML":m(i,s?"text: ":"node: ",e),m(i,"added to node: ",t);break;case"replaceWith":case"after":case"before":m(i,s?"text: ":"node: ",e),m(i,"added to node: ",Te(t).parentNode);break;case"textContent":case"innerText":case"nodeValue":m(i,"content of node: ",t),m(i,"changed to: ",e)}m(i,`using the function "${n}"`),Vn.groupEnd(),r.changeId++}function b(e,t){if(t)for(let n of t)if(qe(n,e))return!0;return!1}zn.frozen.has(document)||(zn.frozen.set(document,!0),function(){let e;function t(e){return e&&zn.frozen.has(e)}function n(e){try{return e&&(zn.frozen.has(e)||zn.frozen.has(Te(e).parentNode))}catch(e){return!1}}function r(e,t){try{return e&&(zn.frozen.has(e)&&t||zn.frozen.has(Te(e).parentNode)&&!t)}catch(e){return!1}}function o(e){return zn.frozen.get(e)}function i(e){try{if(zn.frozen.has(e))return zn.frozen.get(e);let t=Te(e).parentNode;return zn.frozen.get(t)}catch(e){}}function s(e,t){try{if(zn.frozen.has(e)&&t)return zn.frozen.get(e);let n=Te(e).parentNode;return zn.frozen.get(n)}catch(e){}}e=P(Jn,"appendChild",t,o),kt(Jn,"appendChild",e),e=P(Jn,"insertBefore",t,o),kt(Jn,"insertBefore",e),e=P(Jn,"replaceChild",t,o),kt(Jn,"replaceChild",e),e=k(Bn,"append",t,o),kt(Bn,"append",e),e=k(Bn,"prepend",t,o),kt(Bn,"prepend",e),e=k(Bn,"replaceWith",n,i),kt(Bn,"replaceWith",e),e=k(Bn,"after",n,i),kt(Bn,"after",e),e=k(Bn,"before",n,i),kt(Bn,"before",e),e=O(Bn,"insertAdjacentElement",r,s),kt(Bn,"insertAdjacentElement",e),e=O(Bn,"insertAdjacentHTML",r,s),kt(Bn,"insertAdjacentHTML",e),e=O(Bn,"insertAdjacentText",r,s),kt(Bn,"insertAdjacentText",e),e=T(Bn,"innerHTML",t,o),kt(Bn,"innerHTML",e),e=T(Bn,"outerHTML",n,i),kt(Bn,"outerHTML",e),e=j(Jn,"textContent",t,o),kt(Jn,"textContent",e),e=j(_n,"innerText",t,o),kt(_n,"innerText",e),e=j(Jn,"nodeValue",t,o),kt(Jn,"nodeValue",e)}()),i=new Gn(g),i.observe(document,{childList:!0,subtree:!0}),g();let S=!1;function E(e){throw S||(S=!0,Be("freeze-element "+r)),new Qn(e)}function $(e,t,n,r){let o=new Un,{body:i}=Te(o.parseFromString(e,"text/html")),s=x(Te(i).childNodes,t,n,r);return Te(s).map((e=>{switch(Te(e).nodeType){case Wn:return Te(e).outerHTML;case Hn:return Te(e).textContent;default:return""}})).join("")}function x(e,t,n,r){let o=Te([]);for(let i of e)R(i,t,n,r)&&o.push(i);return o}function R(e,t,n,r){let o=r.shouldAbort,i=r.regexExceptions,s=r.exceptionSelectors,a=r.rid;if("string"==typeof e){let s=e;return!!b(s,i)||(et()&&v(s,t,n,r),o&&E(a),et())}let c=e;switch(Te(c).nodeType){case Wn:return!!function(e,t){if(t){let n=Te(e);for(let e of t)if(n.matches(e))return!0}return!1}(c,s)||(o&&(et()&&v(c,t,n,r),E(a)),!!et()&&(Fn(c),v(c,t,n,r),!0));case Hn:return!!b(Te(c).textContent,i)||(et()&&v(c,t,n,r),o&&E(a),!1);default:return!0}}function P(e,t,n,r){let i=Yn(e,t)||{},a=i.get&&s(i.get,e)||i.value;if(a)return{get:()=>function(...e){if(n(this)){let n=r(this);if(n){let r=e[0];if(!R(r,this,t,n))return r}}return o(a,this,e)}}}function k(e,t,n,r){let i=Yn(e,t)||{},a=i.get&&s(i.get,e)||i.value;if(a)return{get:()=>function(...e){if(!n(this))return o(a,this,e);let i=r(this);if(!i)return o(a,this,e);let s=x(e,this,t,i);return s.length>0?o(a,this,s):void 0}}}function O(e,t,n,r){let i=Yn(e,t)||{},a=i.get&&s(i.get,e)||i.value;if(a)return{get:()=>function(...e){let[i,c]=e,l="afterbegin"===i||"beforeend"===i;if(n(this,l)){let e=r(this,l);if(e){let n,r=l?this:Te(this).parentNode;switch(t){case"insertAdjacentElement":if(!R(c,r,t,e))return c;break;case"insertAdjacentHTML":return n=$(c,r,t,e),n?s(a,this,i,n):void 0;case"insertAdjacentText":if(!R(c,r,t,e))return}}}return o(a,this,e)}}}function T(e,t,n,r){let o=Yn(e,t)||{},{set:i}=o;if(i)return{set(e){if(!n(this))return s(i,this,e);let o=r(this);if(!o)return s(i,this,e);let a=$(e,this,t,o);return a?s(i,this,a):void 0}}}function j(e,t,n,r){let o=Yn(e,t)||{},{set:i}=o;if(i)return{set(e){if(!n(this))return s(i,this,e);let o=r(this);return o?R(e,this,t,o)?s(i,this,e):void 0:s(i,this,e)}}}},"hide-if-canvas-contains":function(e,t="canvas",n="",r=""){const i=ot("hide-if-canvas-contains"),s=Ve(arguments),{mark:a,end:c}=Qe("hide-if-canvas-contains");if(!e)return void i("error","The parameter 'search' is required");if(!cr){a();const f=Zn.prototype;function p(e){const t=f[e];let n=l(t,(function(e,...n){const r=this.canvas;if(ur.has(r))return o(t,this,[e,...n]);const i=((lr.get(r)||"")+e).slice(-1e4);lr.set(r,i);for(const[e,t]of cr)"data"!==t.mode&&qe(e,i)&&mr(r,t);const s=o(t,this,[e,...n]);return vr(r),s}));ut(n,t),rr.defineProperty(window.CanvasRenderingContext2D.prototype,e,{value:n})}function d(){const e=f.clearRect;let t=l(e,(function(...t){let n=!1,r=!0;for(const{clearRectBehavior:e}of cr.values())"always"===e&&(n=!0),"never"!==e&&(r=!1);if(!r){const[e,r,o,i]=t,s=e<=0&&r<=0&&o>=this.canvas.width&&i>=this.canvas.height;(n||s)&&lr.delete(this.canvas)}const i=o(e,this,t);return vr(this.canvas),i}));ut(t,e),rr.defineProperty(window.CanvasRenderingContext2D.prototype,"clearRect",{value:t})}function h(){const e=f.drawImage;let t=l(e,(function(t,...n){if(i("info","drawImage called with arguments:",t,...n),t&&"string"==typeof t.src&&t.src)for(const[e,n]of cr)"data"!==n.mode&&qe(e,t.src)&&mr(this.canvas,n);const r=o(e,this,[t,...n]);return vr(this.canvas),r}));ut(t,e),rr.defineProperty(window.CanvasRenderingContext2D.prototype,"drawImage",{value:t})}i("info","CanvasRenderingContext2D proxied"),p("fillText"),p("strokeText"),d(),h(),cr=new tr;new nr((e=>{for(let t of Te(e))"childList"===t.type&&fr.forEach((e=>{const t=Te(e.canvasElement).closest(e.rule.selector);if(t&&!pr.has(t)){Fn(t),pr.add(t),fr.delete(e),ot("hide-if-canvas-contains")("success","Matched: ",t,`\nFILTER: hide-if-canvas-contains ${e.rule.formattedArguments}`);const n="hide-if-canvas-contains "+e.rule.formattedArguments;dr.has(n)||(dr.add(n),Be(n))}}))})).observe(er,{childList:!0,subtree:!0}),c()}const u=Fe(e,i);if(cr.set(u,{selector:t,formattedArguments:s,clearRectBehavior:n,mode:r}),"data"===r){hr=!0,function(){if(yr)return;yr=!0;const e=Zn.prototype,t=["fillRect","strokeRect","putImageData","fill","stroke"];for(const n of t){const t=e[n];if("function"!=typeof t)continue;let r=l(t,(function(...e){const n=o(t,this,e);return vr(this.canvas),n}));ut(r,t),rr.defineProperty(window.CanvasRenderingContext2D.prototype,n,{value:r})}}();for(const y of jn("canvas"))vr(y)}},"hide-if-shadow-contains":function(e,t="*"){const n=Ve(arguments);let r=`${e}\\${t}`;const i=ot("hide-if-shadow-contains");Tr.has(r)||Tr.set(r,[Fe(e,i),t,nt,n]);const{mark:s,end:a}=Qe("hide-if-shadow-contains");if(!Ar){Ar=new Er((e=>{s();let t=new xr;for(let{target:n}of Te(e)){let e=Te(n).parentNode;for(;e;)[n,e]=[e,Te(n).parentNode];if(!Or.has(n)&&!t.has(n)){t.add(n);for(let[e,t,r,o]of Tr.values())if(qe(e,Te(n).textContent)){let e=Te(n.host).closest(t);if(e){r(),Te(n).appendChild(document.createElement("style")).textContent=":host {display: none !important}",Fn(e),Or.add(n),i("success","Hiding: ",e,`\nFILTER: hide-if-shadow-contains ${o}`);const t="hide-if-shadow-contains "+o;jr.has(t)||(jr.add(t),Be(t))}a()}}}}));let e=l(kr,(function(){let e=o(kr,this,arguments);return i("info","attachShadow is called for: ",e),Ar.observe(e,{childList:!0,characterData:!0,subtree:!0}),e}));ut(e,kr),$r.defineProperty(Pr,"attachShadow",{value:e})}},"json-override":function(e,t,n="",r=""){if(!e)throw new qr("[json-override snippet]: Missing paths to override.");if(void 0===t)throw new qr("[json-override snippet]: No value to override with.");let i=ot("json-override");const{mark:s,end:a}=Qe("json-override");if(!_r){function p(e,t){for(let{formattedArgs:n,prune:r,jsonPathObjects:o,needle:s,filter:a,value:c}of _r.values())if(!a||qe(a,t)){if(Te(s).some((t=>!Ct(e,t))))return e;for(let t of r)if(t.startsWith("jsonpath("))try{const r=o.get(t);r.evaluate(e).forEach((({parent:e,key:t})=>{i("success",`JSONPath match found at [${t}], replaced with ${c}`,`\nFILTER: json-override ${n}`),zr("json-override "+n),e[t]=It(c)}))}catch(e){i("error",`JSONPath evaluation failed for: ${t}. Error: ${e.message}`)}else t.includes("{}")||t.includes("[]")?d(e,t,c,n):h(e,t,c,n)}return e}function d(e,t,n,r){let o=Te(t).split("."),s=e;for(let e=0;e<o.length;e++){let a=o[e];if("[]"===a)return void(Fr.isArray(s)&&(i("info",`Iterating over array at: ${a}`),Te(s).forEach((t=>{null!=t&&d(t,o.slice(e+1).join("."),n,r)}))));if("{}"===a)return void(s&&"object"==typeof s&&(i("info",`Iterating over object at: ${a}`),Jr.keys(s).forEach((t=>{let i=s[t];null!=i&&d(i,o.slice(e+1).join("."),n,r)}))));if(!s||"object"!=typeof s||!m(s,a))return;e===o.length-1?(i("success",`Found ${t}, replaced it with ${n}`,`\nFILTER: json-override ${r}`),zr("json-override "+r),s[a]=It(n)):s=s[a]}}function h(e,t,n,r){let o=Ct(e,t);void 0!==o&&(i("success",`Found ${t}, replaced it with ${n}`,`\nFILTER: json-override ${r}`),zr("json-override "+r),o[0][o[1]]=It(n))}s();let{parse:y}=Wr;_r=new Hr;let g=l(y,(function(e){return p(o(y,this,arguments),e)}));ut(g,y),Jr.defineProperty(window.JSON,"parse",{value:g}),i("info","Wrapped JSON.parse for override");let{json:w}=Br.prototype;Jr.defineProperty(window.Response.prototype,"json",{value:l(w,(function(e){return o(w,this,arguments).then((t=>p(t,e)))}))}),i("info","Wrapped Response.json for override"),a()}const c=Ve(arguments),u=Te(e).split(/ +/),f=new Hr;for(const v of u)if(v.startsWith("jsonpath("))try{f.set(v,new Dr(v.slice(9,-1)))}catch(b){i("error",`Invalid JSONPath query: ${v}. Error: ${b.message}`)}_r.set(e,{formattedArgs:c,prune:u,jsonPathObjects:f,needle:n.length?Te(n).split(/ +/):[],filter:r?Fe(r,i):null,value:t})},"json-prune":function(e,t="",n=""){if(!e)throw new Xr("Missing paths to prune");let r=ot("json-prune");const{mark:i,end:s}=Qe("json-prune");if(!Zr){function f(e){for(let{prune:t,needle:n,jsonPathObjects:o,stackNeedle:i,formattedArgs:s}of Zr.values()){if(Te(n).length>0&&Te(n).some((t=>!Ct(e,t))))return e;if(Te(i)&&Te(i).length>0&&!Nt(i,r))return e;for(let n of t)if(n.startsWith("jsonpath("))try{const t=o.get(n);t.evaluate(e).forEach((({parent:e,key:t})=>{r("success",`JSONPath match found and deleted at [${t}]`,`\nFILTER: json-prune ${s}`),to("json-prune "+s),delete e[t]}))}catch(e){r("error",`JSONPath evaluation failed for: ${n}. Error: ${e.message}`)}else n.includes("{}")||n.includes("[]")||n.includes("{-}")||n.includes("[-]")?p(e,n,s):h(e,n,s)}return e}function p(e,t,n){let o=Te(t).split("."),i=e;for(let e=0;e<o.length;e++){let s=o[e];if("[]"===s)return void(Ur.isArray(i)&&(r("info",`Iterating over array at: ${s}`),Te(i).forEach((t=>p(t,o.slice(e+1).join("."),n)))));if("[-]"===s){if(Ur.isArray(i)){r("info",`Iterating over array with element removal at: ${s}`);let t=o.slice(e+1).join("."),a=[];Te(i).forEach(((e,n)=>{d(e,t)&&a.push(n)}));for(let e=a.length-1;e>=0;e--)r("success",`Found element at index ${a[e]} matching ${t} and removed entire element, \nFILTER: json-prune ${n}`),to("json-prune "+n),i.splice(a[e],1)}return}if("{}"===s)return void("object"==typeof i&&null!==i&&(r("info",`Iterating over object at: ${s}`),Qr.keys(i).forEach((t=>p(i[t],o.slice(e+1).join("."),n)))));if("{-}"===s){if("object"==typeof i&&null!==i){r("info",`Iterating over object with element removal at: ${s}`);let t=o.slice(e+1).join("."),a=[];Qr.keys(i).forEach((e=>{d(i[e],t)&&a.push(e)})),a.forEach((e=>{r("success",`Found object key ${e} matching ${t} and removed entire element, \nFILTER: json-prune ${n}`),to("json-prune "+n),delete i[e]}))}return}if(!i||"object"!=typeof i||!m(i,s))return;e===o.length-1?(r("success",`Found ${t} and deleted, \nFILTER: json-prune ${n}`),to("json-prune "+n),delete i[s]):i=i[s]}}function d(e,t){if(!t||""===t)return!0;let n=Te(t).split("."),r=e;for(let e=0;e<n.length;e++){let t=n[e];if("[]"===t)return!!Ur.isArray(r)&&Te(r).some((t=>d(t,n.slice(e+1).join("."))));if("{}"===t)return"object"==typeof r&&null!==r&&Qr.keys(r).some((t=>d(r[t],n.slice(e+1).join("."))));if(!r||"object"!=typeof r||!m(r,t))return!1;if(e===n.length-1)return!0;r=r[t]}return!1}function h(e,t,n){let o=Ct(e,t);void 0!==o&&(r("success",`Found ${t} and deleted`,`\nFILTER: json-prune ${n}`),to("json-prune "+n),delete o[0][o[1]])}i();let{parse:y}=Gr;Zr=new Kr;let g=l(y,(function(){return f(o(y,this,arguments))}));ut(g,y),Qr.defineProperty(window.JSON,"parse",{value:g}),r("info","Wrapped JSON.parse for prune");let{json:w}=Yr.prototype,v=l(w,(function(){return o(w,this,arguments).then((e=>f(e)))}));ut(v,w),Qr.defineProperty(window.Response.prototype,"json",{value:v}),r("info","Wrapped Response.json for prune"),s()}const a=Ve(arguments),c=Te(e).split(/ +/),u=new Kr;for(const b of c)if(b.startsWith("jsonpath("))try{u.set(b,new Dr(b.slice(9,-1)))}catch(S){r("error",`Invalid JSONPath query: ${b}. Error: ${S.message}`)}Zr.set(e,{formattedArgs:a,prune:c,jsonPathObjects:u,needle:t.length?Te(t).split(/ +/):[],stackNeedle:n.length?Te(n).split(/ +/):[]})},"map-override":function(e,t,n="",r,i){if(!e)throw new no("[map-override snippet]: Missing method to override.");if(!t)throw new no("[map-override snippet]: Missing needle.");io||(io=new oo);let a=ot("map-override");const{mark:c,end:u}=Qe("map-override"),{set:f,get:p,has:d}=oo.prototype,h=Ve(arguments);if("set"!==e||io.has("set"))if("get"!==e||io.has("get")){if("has"===e&&!io.has("has")){c(),s(f,io,"has",Te([]));let e=l(d,(function(e){const t=s(p,io,"has");for(const{needleRegex:n,retVal:r,stackNeedles:o}of t)if("string"==typeof e||"number"==typeof e){const t=e.toString();if(qe(n,t)&&Nt(o,a))return a("success",`Map.has returned ${r} for key: ${t}\nFILTER: map-override ${h}`),ao("map-override "+h),r}return o(d,this,arguments)}));ut(e,d),ro.defineProperty(window.Map.prototype,"has",{value:e}),a("info","Wrapped Map.prototype.has"),u()}}else{c(),s(f,io,"get",Te([]));let e=l(p,(function(e){const t=s(p,io,"get");for(const{needleRegex:n,retVal:r,stackNeedles:o}of t)if("string"==typeof e||"number"==typeof e){const t=e.toString();if(qe(n,t)&&Nt(o,a))return a("success",`Map.get returned ${r} for key: ${t}\nFILTER: map-override ${h}`),ao("map-override "+h),r}return o(p,this,arguments)}));ut(e,p),ro.defineProperty(window.Map.prototype,"get",{value:e}),a("info","Wrapped Map.prototype.get"),u()}else{c(),s(f,io,"set",Te([]));let e=l(f,(function(e,t){const n=s(p,io,"set");for(const{needleRegex:e,pathSegments:r,stackNeedles:o}of n)if(co(t,e,r)&&Nt(o,a))return a("success",`Map.set is ignored for value matching needle: ${e}\nFILTER: map-override ${h}`),ao("map-override "+h),this;return o(f,this,arguments)}));ut(e,f),ro.defineProperty(window.Map.prototype,"set",{value:e}),a("info","Wrapped Map.prototype.set"),u()}const y=Fe(t,a);let g=[];r&&(g=r.split("."));let w=[];i&&(w=i.split(",").map((e=>e.trim())));const m=s(p,io,e);let v;"get"===e?v=""===n?void 0:n:"has"===e&&(v="true"===n),m.push({needleRegex:y,retVal:v,pathSegments:g,stackNeedles:w}),s(f,io,e,m)},"override-property-read":function(e,t,n){if(!e)throw new lo("[override-property-read snippet]: No property to override.");if(void 0===t)throw new lo("[override-property-read snippet]: No value to override with.");const r=Ve(arguments);let o=ot("override-property-read");const{mark:i,end:s}=Qe("override-property-read");let a=It(t),c=!1;o("info",`Overriding ${e}.`);const l=!("false"===n);i(),kt(window,e,{get:()=>(o("success",`${e} override done.`,"\nFILTER: override-property-read",r),c||(c=!0,Be("override-property-read "+r)),a),set(){}},l),s()},"prevent-element-src-loading":function(e,t){if(!e||"string"!=typeof e)throw new po("[prevent-element-src-loading snippet]: tagName param must be a string.");if(!t)throw new po("[prevent-element-src-loading snippet]: Missing search parameter.");if(e=Te(e).toString().toLowerCase(),!Te(["script","img","iframe","link"]).includes(e))throw new po("[prevent-element-src-loading snippet]: tagName parameter is incorrect.");const n={script:"data:text/javascript;base64,KCk9Pnt9",img:"data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==",iframe:"data:text/html;base64,PGRpdj48L2Rpdj4=",link:"data:text/plain;base64,"},r={script:window.HTMLScriptElement,img:window.HTMLImageElement,iframe:window.HTMLIFrameElement,link:window.HTMLLinkElement}[e],o="link"===e?"href":"src",i="onerror",s=ot("[prevent-element-src-loading snippet]"),a=Ve(arguments),c="prevent-element-src-loading "+a,{mark:l,end:u}=Qe("prevent-element-src-loading");l();const f=Fe(t,s);if(vo.push({tagName:e,searchRegex:f}),s("info",`Added filter rule\nFILTER: prevent-element-src-loading ${a}`),!So.has(e)){So.add(e);const t={apply:(e,t,r)=>{if(!r[0]||!r[1])return yo.apply(e,t,r);const i=t.nodeName.toLowerCase(),a=r[0].toLowerCase(),l=r[1];return a===o&&vo.some((e=>i===e.tagName&&qe(e.searchRegex,l)))?(mo.add(t),s("success",`Replaced setAttribute for ${a}: ${l} → ${n[i]}`),bo.has(c)||(bo.add(c),Be(c)),yo.apply(e,t,[a,n[i]])):yo.apply(e,t,r)}};r.prototype.setAttribute=new Proxy(r.prototype.setAttribute,t),s("info","Wrapped setAttribute function");const i=ho.getOwnPropertyDescriptor(r.prototype,o);if(!i)return;ho.defineProperty(r.prototype,o,{enumerable:!0,configurable:!0,get(){return i.get.call(this)},set(e){const t=this.nodeName.toLowerCase();vo.some((n=>t===n.tagName&&qe(n.searchRegex,e)))?(mo.add(this),s("success",`Replaced in src/href setter ${e} → ${n[t]}`),bo.has(c)||(bo.add(c),Be(c)),i.set.call(this,n[t])):i.set.call(this,e)}}),s("info","Wrapped src/href property setter")}if(1===vo.length){const e=ho.getOwnPropertyDescriptor(HTMLElement.prototype,i);if(!e)return;ho.defineProperty(HTMLElement.prototype,i,{enumerable:!0,configurable:!0,get(){return e.get.call(this)},set(t){mo.has(this)?(s("success",`Replaced in onerror setter ${t} → () => {}`),bo.has(c)||(bo.add(c),Be(c)),e.set.call(this,(()=>{}))):e.set.call(this,t)}}),s("info","Wrapped onerror property setter");const t={apply:(e,t,n)=>{if(!n[0]||!n[1]||!t)return yo.apply(e,t,n);const r=n[0];return"function"==typeof t.getAttribute&&mo.has(t)&&"error"===r?(s("success",`Replaced error event handler on ${t} with () => {}`),bo.has(c)||(bo.add(c),Be(c)),yo.apply(e,t,[r,()=>{}])):yo.apply(e,t,n)}};EventTarget.prototype.addEventListener=new Proxy(EventTarget.prototype.addEventListener,t),s("info","Wrapped addEventListener");(()=>{fo("error",(e=>{const t=e.target;if(!t||!t.nodeName)return;const n=t.src||t.href,r=t.nodeName.toLowerCase();vo.some((e=>r===e.tagName&&n&&qe(e.searchRegex,n)))&&(t.onerror=()=>{})}),!0),s("info","Added event listener to defuse global errors")})()}u()},"prevent-listener":function(e,t,n){if(!e)throw new Eo("[prevent-listener snippet]: No event type.");let r=ot("[prevent]");if(!To){To=new $o;const{mark:e,end:t}=Qe("prevent-listener");let n=l(Oo,(function(n,i){e();for(let{evt:e,handlers:t,selectors:o,formattedArgs:a}of To.values()){if(!qe(e,n))continue;let c=this instanceof Element;for(let l=0;l<t.length;l++){const u=t[l],f=o[l];if(f&&(!c||!Te(this).matches(f)))continue;if(u){const e=function(){try{const e=String("function"==typeof i?i:i.handleEvent);return qe(u,e)}catch(e){return r("error","Error while trying to stringify listener: ",e),!1}};if(!function(){try{const e=s(Po,"function"==typeof i?i:i.handleEvent);return qe(u,e)}catch(e){return r("error","Error while trying to stringify listener: ",e),!1}}()&&!e())continue}const p="prevent-listener "+a;return jo.has(p)||(jo.add(p),Be(p)),void(et()&&(Ro.groupCollapsed("DEBUG [prevent] was successful",`\nFILTER: prevent-listener ${a}`),r("success",`type: ${n} matching ${e}`),r("success","handler:",i),u&&r("success",`matching ${u}`),f&&r("success","on element: ",this,` matching ${f}`),r("success","was prevented from being added"),Ro.groupEnd()))}}return t(),o(Oo,this,arguments)}));ut(n,Oo),xo.defineProperty(ko,"addEventListener",{value:n}),r("info","Wrapped addEventListener")}const i=Ve(arguments);To.has(e)||To.set(e,{evt:Fe(e,r),handlers:[],selectors:[],formattedArgs:i});let{handlers:a,selectors:c}=To.get(e);a.push(t?Fe(t,r):null),c.push(n)},"prevent-window-open":function(e="",t="",n="iframe"){if(""===n&&(n="iframe"),"iframe"!==n&&"obj"!==n&&"blank"!==n)throw new Wo("[prevent-window-open snippet]: decoy must be iframe, obj or blank.");let r=!1;Te(e).startsWith("!")&&(r=!0,e=Te(e).slice(1));const i=ot("[prevent-window-open]");if(Uo.push({regex:Fe(e,i),invert:r,hasDelay:""!==t,autoRemoveAfter:Vo(t)||0,decoy:n,formattedArgs:Ve(arguments)}),Uo.length>1)return;const{mark:s,end:a}=Qe("prevent-window-open"),c=Jo.getOwnPropertyDescriptor(window,"open");if(!c||"function"!=typeof c.value||!c.configurable)return void i("warn","window.open not wrappable, bailing out");const u=c.value,f=(e=0,t=(()=>{}))=>{let n=!1;const r=()=>{n||(n=!0,t())};zo(r,e);const o={href:"about:blank",assign(){},replace(){},reload(){},toString:()=>"about:blank"},i={location:o,defaultView:null,cookie:"",open(){},write(){},writeln(){},close(){}},s={length:0,state:null,scrollRestoration:"auto",back(){},forward(){},go(){},pushState(){},replaceState(){}},a=new Ho,c=Jo.create(Jo.create(null)),l=new Ao(c,{get(e,t,c){if(No(e,t))return Io(e,t,c);if("closed"===t)return n;if("close"===t)return r;if("opener"===t)return window;if("frameElement"===t)return null;if(t===Lo)return"Window";if("parent"===t||"top"===t||"self"===t||"window"===t||"globalThis"===t||"frames"===t)return c;if("location"===t)return o;if("document"===t)return i;if("history"===t)return s;let l;try{l=Io(window,t)}catch(e){return}if("function"==typeof l){let e=a.get(t);return e||(e=()=>{},a.set(t,e)),e}return null===l||"object"!=typeof l?l:void 0},set:(e,t,n)=>"location"===t||"opener"===t||(!!Ko.has(t)||Fo(e,t,n)),defineProperty:(e,t,n)=>!Ko.has(t)&&Co(e,t,n),deleteProperty:(e,t)=>Mo(e,t),has:(e,t)=>Ko.has(t)||Do(e,t)||Do(window,t),setPrototypeOf:()=>!1,preventExtensions:()=>!1});return i.defaultView=l,l},p=l(u,(function(e){s();const t=new qo(arguments.length);for(let e=0;e<arguments.length;e++)t[e]=arguments[e];const n=t.join(" ");for(let r=0;r<Uo.length;r++){const s=Uo[r];if(qe(s.regex,n)===s.invert)continue;if(Go("prevent-window-open "+s.formattedArgs),i("success",`Prevented window.open(${n})`,`\nFILTER: prevent-window-open ${s.formattedArgs}`),a(),!s.hasDelay)return null;if("blank"===s.decoy){t[0]="about:blank";const e=o(u,this,t),n=e&&e.close;return"function"==typeof n&&zo((()=>o(n,e,[])),s.autoRemoveAfter),e}const c="obj"===s.decoy?"object":"iframe",l="obj"===s.decoy?"data":"src";let p;try{p=Te(_o).createElement(c),p[l]=null==e?"about:blank":e;const{style:t}=Te(p,"HTMLElement"),n=Te(t,"CSSStyleDeclaration");n.setProperty("height","1px","important"),n.setProperty("position","fixed","important"),n.setProperty("top","-1px","important"),n.setProperty("width","1px","important");const r=Te(_o).body||Te(_o).documentElement;Te(r).appendChild(p)}catch(e){if(p)try{Te(p).remove()}catch(e){}return f(s.autoRemoveAfter)}return f(s.autoRemoveAfter,(()=>Te(p).remove()))}return i("info",`Allowed window.open(${n})`),a(),o(u,this,arguments)}));ut(p,u),Jo.defineProperty(window,"open",{...c,value:p}),i("info","Wrapped window.open")},profile:function(){Ke=!1},"replace-argument":function(e,t,n="",r="",i=""){const s=ot("[replace-argument snippet]"),a="replace-argument "+Ve(arguments),{mark:c,end:u}=Qe("replace-argument");if(!e||"string"!=typeof e)return void s("error",`methodPath param must be a string.\nFILTER: ${a}`);const f=""+t;if(!/^\d+$/.test(f))return void s("error",`argPosition param must be a non-negative integer.\nFILTER: ${a}`);const p=ei(f,10),d=Te(e).split("."),h=d[d.length-1];let y=window;for(let e=0;e<d.length-1&&null!=y;e++)y=y[d[e]];if(null==y||"function"!=typeof y[h])return void s("warn",`could not resolve ${e}\nFILTER: ${a}`);const g=i?Te(i).split(",").map((e=>e.trim())):[],w=""===n,m={argPosition:p,search:w?null:We(n,s),replacement:r,wholeValue:w,filterStr:a,stackNeedles:g};let v=ni.get(e);if(v||(v=new Qo,ni.set(e,v)),v.push(m),s("info",`Added rule for ${e}\nFILTER: ${a}`),!ri.has(e)){c(),ri.add(e);const t=y[h],n=l(t,(function(){let n=arguments;try{const t=ni.get(e);if(t)for(const r of t){if(arguments.length<=r.argPosition||!Nt(r.stackNeedles,s))continue;const t=arguments[r.argPosition];let o;if(r.wholeValue)o=It(r.replacement);else{if(null!==t&&"object"==typeof t)continue;const e=""+t;if(o=Te(e).replace(r.search,r.replacement).toString(),o===e)continue}const i=Qo.from(arguments);i[r.argPosition]=o,oi.has(r.filterStr)||(oi.add(r.filterStr),Be(r.filterStr)),s("success",`argument ${r.argPosition} of ${e} replaced\nFILTER: ${r.filterStr}`),n=i;break}}catch(e){n=arguments}return o(t,this,n)}));ut(n,t),Zo.defineProperty(y,h,{value:n}),s("info",`${e} wrapped`),u()}},"replace-fetch-request":function(e,t="",n=null,r="replace"){const o=Ve(arguments),i=ot("replace-fetch-request"),{mark:s,end:a}=Qe("replace-fetch-request");if(!e)throw new hi("[replace-fetch-request]: Missing 'search' parameter");var c;if(di||(di=new Map,i("info","fetch proxied"),c=e=>{s();let t=e;for(const[e,{replacement:n,needle:r,formattedArgs:o,isJsonPath:s,jsonPathEngine:a,mode:c}]of di){if(r){if(!qe(Fe(r,i),t))continue;i("info",`'${r}' found in fetch request body`)}if(s)try{let e=yi.parse(t);const r=a.evaluate(e);Te(r).forEach((({parent:e,key:t})=>{let r=He(n);"append"===c?Je(e,t,r)||i("info",`append has no meaning for the value at [${t}], replaced it instead`):e[t]=r,i("success",`JSONPath [${c}] at [${t}] with `+n,"\nFILTER: replace-fetch-request "+o);const s="replace-fetch-request "+o;gi.has(s)||(gi.add(s),Be(s))})),t=yi.stringify(e)}catch(e){i("info","JSONPath: skipping non-JSON body or evaluation error: "+e.message)}else{const r=t;if(t=Te(t).replace(e,n).toString(),r.toString()!==t.toString()){i("success",`'${e}' replaced with '${n}' in fetch request body`,"\nFILTER: replace-fetch-request "+o);const t="replace-fetch-request "+o;gi.has(t)||(gi.add(t),Be(t))}}}return a(),t},ui.push(c),fi()),Te(e).startsWith("jsonpath(")){let s;try{const t=Te(e).slice(9,-1).toString();s=new Dr(t)}catch(t){return void i("error",`Invalid JSONPath query: ${e}. Error: ${t.message}`)}di.set(e,{replacement:t,needle:n,formattedArgs:o,isJsonPath:!0,jsonPathEngine:s,mode:r})}else{const s=We(e,i);di.set(s,{replacement:t,needle:n,formattedArgs:o,isJsonPath:!1,jsonPathEngine:null,mode:r})}},"replace-fetch-response":function(e,t="",n=null){const r=Ve(arguments),o=ot("replace-fetch-response"),{mark:i,end:s}=Qe("replace-fetch-response");if(!e)return void o("error","The parameter 'search' is required");if(!wi){const e=e=>{i();return Te(e).clone().text().then((t=>{let n=Te(t);for(const[e,{replacement:t,needle:r,formattedArgs:i}]of wi){if(r){if(!qe(Fe(r,o),n)){et()&&(console.groupCollapsed(`DEBUG [replace-fetch-response] warn: '${r}' not found in fetch response`),o("warn",`${n}`),console.groupEnd());continue}et()&&(console.groupCollapsed(`DEBUG [replace-fetch-response] success: '${r}' found in fetch response`),o("info",`${n}`),console.groupEnd())}const s=n.toString();if(n=n.replace(e,t),n.toString()!==s){const r="replace-fetch-response "+i;Si.has(r)||(Si.add(r),Be(r)),et()&&(console.groupCollapsed(`DEBUG [replace-fetch-response] success: '${e}' replaced with '${t}' in fetch response`,`\nFILTER: replace-fetch-response ${i}`),o("success",`${n}`),console.groupEnd())}}if(n.toString()===t.toString())return e;const r=new bi(n.toString(),{status:e.status,statusText:e.statusText,headers:e.headers});return vi.defineProperties(r,{ok:{value:e.ok},redirected:{value:e.redirected},type:{value:e.type},url:{value:e.url}}),s(),r}))};wi=new mi,o("info","Network API proxied"),pi(e)}const a=We(e,o);wi.set(a,{replacement:t,needle:n,formattedArgs:r})},"replace-outbound-value":function(e,t="",n="",r="",i="",s=""){if(!e)throw new Ei("[replace-outbound-value snippet]: Missing method path.");let a=ot("replace-outbound-value");const{mark:c,end:u}=Qe("replace-outbound-value"),f=Ve(arguments);let p=!1;function d(){p||(p=!0,Be("replace-outbound-value "+f))}function h(e,t,n,r){if("base64"===r)try{if(function(e){try{if(""===e)return!1;const t=xi(e),n=Ri(t),r=Te(e).replace(/=+$/,"").toString();return Te(n).replace(/=+$/,"").toString()===r}catch(e){return!1}}(e)){const r=xi(e);a("info",`Decoded base64 content: ${r}`);const o=t?Te(r).replace(t,n).toString():r;a("info",o!==r?`Modified decoded content: ${o}`:"Decoded content was not modified");const i=Ri(o);return a("info",`Re-encoded to base64: ${i}`),i}a("info",`Content is plain text: ${e}`);const r=t?Te(e).replace(t,n).toString():e;a("info",r!==e?`Modified plain text content: ${r}`:"Plain text content was not modified");const o=Ri(r);return a("info",`Encoded to base64: ${o}`),o}catch(t){return a("info",`Error processing base64 content: ${t.message}`),e}return t?Te(e).replace(t,n).toString():e}function y(e,t,n,r,o,i){const s=n?We(n,a):null;if(t.length&&"object"==typeof e&&null!==e){const c=n?function(e,t,n,r,o){if(!t.length)return e;let i=e;for(let n=0;n<t.length-1;n++){if(!i||"object"!=typeof i)return a("info",`Cannot navigate to path: property '${t[n]}' not found`),e;i=i[t[n]]}const s=t[t.length-1];if(!i||"object"!=typeof i||!(s in i))return a("info",`Target property '${s}' not found at path`),e;const c=i[s];if("string"!=typeof c)return a("info","Property at path is not a string: "+typeof c),e;const l=h(c,n,r,o);if(l!==c){const n=JSON.parse(JSON.stringify(e));let r=n;for(let e=0;e<t.length-1;e++)r=r[t[e]];return r[s]=l,a("info",`Replaced value at path '${t.join(".")}': '${c}' -> '${l}'`),n}return e}(e,t,s,r,o):e;return c!==e&&(a("success",`Replaced outbound value\nFILTER: replace-outbound-value ${i}`),d()),c}if("string"==typeof e){n||a("info",`Original text content: ${e}`);const t=n?h(e,s,r,o):e;return t!==e&&(a("success",`Replaced outbound value: ${t} \nFILTER: replace-outbound-value ${i}`),d()),t}return e}c();const g=function(e,t){let n=e,r=Te(t).split(".");for(let e=0;e<r.length-1;e++){let t=r[e];if(!n||"object"!=typeof n&&"function"!=typeof n)return{base:n,prop:t,remainingPath:r.slice(e).join("."),success:!1};n=n[t]}return{base:n,prop:r[r.length-1],success:!0}}(window,e);if(!g.success)return a("error",`Could not reach the end of the prop chain: ${e}. Remaining path: ${g.remainingPath}`),void u();const{base:w,prop:m}=g,v=w[m];if(!v||"function"!=typeof v)return a("error",`Could not retrieve the method: ${e}`),void u();let b=[];i&&(b=Te(i).split("."));let S=[];s&&(S=Te(s).split(",").map((e=>e.trim())));let E=!1,$=l(v,(function(){if(E)return o(v,this,arguments);E=!0;const e=o(v,this,arguments);if(S.length&&!Nt(S,a))return E=!1,e;if(e&&"function"==typeof e.then)return a("info","Method returned a Promise, modifying resolved value"),E=!1,e.then((e=>{const o="object"==typeof e?JSON.stringify(e):e;return a("info",`Promise resolved with value: ${o}`),y(e,b,t,n,r,i)})).catch((e=>{throw a("info",`Promise rejected: ${e.message}`),e}));const s=y(e,b,t,n,r,i);return E=!1,s}));ut($,v),$i.defineProperty(w,m,{value:$}),a("info",`Wrapped ${e}`),u()},"replace-xhr-request":function(e,t="",n=null,r="replace"){const o=Ve(arguments),i=ot("replace-xhr-request"),{mark:s,end:a}=Qe("replace-xhr-request");if(!e)throw new Ni("[replace-xhr-request]: Missing 'search' parameter");var c;if(Ii||(Ii=new Map,i("info","XMLHttpRequest proxied"),c=e=>{s();let t=e;for(const[e,{replacement:n,needle:r,formattedArgs:o,isJsonPath:s,jsonPathEngine:a,mode:c}]of Ii){if(r){if(!qe(Fe(r,i),t))continue;i("info",`'${r}' found in XHR request body`)}if(s)try{let e=Di.parse(t);const r=a.evaluate(e);Te(r).forEach((({parent:e,key:t})=>{let r=He(n);"append"===c?Je(e,t,r)||i("info",`append has no meaning for the value at [${t}], replaced it instead`):e[t]=r,i("success",`JSONPath [${c}] at [${t}] with `+n,"\nFILTER: replace-xhr-request "+o);const s="replace-xhr-request "+o;Fi.has(s)||(Fi.add(s),Be(s))})),t=Di.stringify(e)}catch(e){i("info","JSONPath: skipping non-JSON body or evaluation error: "+e.message)}else{const r=t;if(t=Te(t).replace(e,n).toString(),r.toString()!==t.toString()){i("success",`'${e}' replaced with '${n}' in XHR request body`,"\nFILTER: replace-xhr-request "+o);const t="replace-xhr-request "+o;Fi.has(t)||(Fi.add(t),Be(t))}}}return a(),t},ji.push(c),Ci()),Te(e).startsWith("jsonpath(")){let s;try{const t=Te(e).slice(9,-1).toString();s=new Dr(t)}catch(t){return void i("error",`Invalid JSONPath query: ${e}. Error: ${t.message}`)}Ii.set(e,{replacement:t,needle:n,formattedArgs:o,isJsonPath:!0,jsonPathEngine:s,mode:r})}else{const s=We(e,i);Ii.set(s,{replacement:t,needle:n,formattedArgs:o,isJsonPath:!1,jsonPathEngine:null,mode:r})}},"replace-xhr-response":function(e,t="",n=null){const r=Ve(arguments),o=ot("replace-xhr-response"),{mark:i,end:s}=Qe("replace-xhr-response");if(e)if(qi||(qi=new Map,o("info","XMLHttpRequest proxied"),Mi((e=>{i();let t=e;for(const[n,{replacement:r,needle:i,formattedArgs:s,isJsonPath:a,jsonPathEngine:c}]of qi){if(i){if(!qe(Fe(i,o),t)){et()&&(console.groupCollapsed(`DEBUG [replace-xhr-response] warn: '${i}' not found in XHR response`),o("warn",t),console.groupEnd());continue}et()&&(console.groupCollapsed(`DEBUG [replace-xhr-response] success: '${i}' found in XHR response`),o("info",t),console.groupEnd())}if(a)try{let e=Wi.parse(t);const n=c.evaluate(e);Te(n).forEach((({parent:e,key:t})=>{e[t]=It(r),o("success",`JSONPath match at [${t}], replaced with `+r,"\nFILTER: replace-xhr-response "+s);const n="replace-xhr-response "+s;Hi.has(n)||(Hi.add(n),Be(n))})),t=Wi.stringify(e)}catch(e){o("info","JSONPath: skipping non-JSON response or evaluation error: "+e.message)}else if(t=Te(t).replace(n,r).toString(),e.toString()!==t.toString()){const e="replace-xhr-response "+s;Hi.has(e)||(Hi.add(e),Be(e)),et()&&(console.groupCollapsed(`DEBUG [replace-xhr-response] success: '${n}' replaced with '${r}' in XHR response`,"\nFILTER: replace-xhr-response "+s),o("success",t),console.groupEnd())}}return s(),t.toString()}))),Te(e).startsWith("jsonpath(")){let i;try{const t=Te(e).slice(9,-1).toString();i=new Dr(t)}catch(t){return void o("error",`Invalid JSONPath query: ${e}. Error: ${t.message}`)}qi.set(e,{replacement:t,needle:n,formattedArgs:r,isJsonPath:!0,jsonPathEngine:i})}else{const i=We(e,o);qi.set(i,{replacement:t,needle:n,formattedArgs:r,isJsonPath:!1,jsonPathEngine:null})}else o("error","The parameter 'pattern' is required")},"strip-fetch-query-parameter":function(e,t=null){const n=Ve(arguments),r=ot("strip-fetch-query-parameter"),{mark:o,end:i}=Qe("strip-fetch-query-parameter"),s=e=>{o();for(let[t,n]of Ji.entries()){const{reg:o,args:i}=n;if((!o||qe(o,e))&&_i(e.searchParams,t)){r("success",`${t} has been stripped from url ${e}`,`\nFILTER: strip-fetch-query-parameter ${i}`);const n="strip-fetch-query-parameter "+i;Vi.has(n)||(Vi.add(n),Be(n)),Bi(e.searchParams,t)}}i()};var a;Ji||(Ji=new Map,a=s,ci.push(a),fi()),Ji.set(e,{reg:t&&Fe(t,r),args:n})},"timer-override":function(e,t="",n="",r=Zi.BOTH,i=""){if(!e)throw new zi("[timer-override snippet]: Missing required parameter timerValue.");if(!Ui.values(Zi).includes(r))throw new zi("[timer-override snippet]: Invalid mode. Acceptable values are: "+Ui.values(Zi).join(", "));const a=Xi(e,10);if(Gi(a))throw new zi("[timer-override snippet]: timerValue must be a number.");const c=ot("timer-override");if(!es){es=Te([]);const{mark:f,end:p}=Qe("timer-override");function d(e){try{return"function"==typeof e?s(Ki,e):""+e}catch(e){return""}}function h(e,t,n,r,i,s,a){const l=d(i);for(const u of es){if(r.indexOf(u.mode)<0)continue;if(u.needleRegex){const e=""+s;if(!qe(u.needleRegex,l)&&!qe(u.needleRegex,e))continue;c("info",u.needle+" found in "+l)}if(u.stackNeedles.length>0&&!Nt(u.stackNeedles,c))continue;let f=i;const p=u.newDelay;u.isNoop&&(f=()=>{},c("success","Callback replaced with noop for "+l)),c("success",n+" replaced with "+p+" for "+l);const d="timer-override "+u.formattedArgs;ts.has(d)||(ts.add(d),Be(d));const h=Te([f,p]);for(let e=2;e<a.length;e++)h.push(a[e]);return o(t,e,h)}return null}f();const y=Te([Zi.TIMEOUT,Zi.BOTH]);let g=l(Qi,(function(e,t){const n=h(this,Qi,"setTimeout",y,e,t,arguments);return null!==n?n:o(Qi,this,arguments)}));ut(g,Qi),Ui.defineProperty(window,"setTimeout",{value:g});const w=Te([Zi.INTERVAL,Zi.BOTH]);let m=l(Yi,(function(e,t){const n=h(this,Yi,"setInterval",w,e,t,arguments);return null!==n?n:o(Yi,this,arguments)}));ut(m,Yi),Ui.defineProperty(window,"setInterval",{value:m}),c("info","timer APIs proxied"),p()}let u=[];i&&(u=i.split(/ +/)),es.push({newDelay:a,needle:t,needleRegex:t?Fe(t,c):null,mode:r,isNoop:"noop"===n,stackNeedles:u,formattedArgs:Ve(arguments)})},trace:function(...e){o(rt,null,e)},"tmp-yt-buffering-spoof":function(e,t,n,r){if(us)return;us=!0;const{Document:i,HTMLIFrameElement:s,Response:a}=Te(window),c=ot("tmp-yt-buffering-spoof"),{mark:u,end:f}=Qe("tmp-yt-buffering-spoof");u();let p=fs,d=null,h=0,y=0;const g=window.JSON.stringify,w=window.JSON.parse,m=os.getOwnPropertyDescriptor(i.prototype,"visibilityState"),v=()=>{try{os.defineProperty(as,"visibilityState",{get:()=>"visible",configurable:!0})}catch(e){}},b=function(e){for(let t=1;t<arguments.length;t++){if(null==e)return;e=e[arguments[t]]}return e},S=function(e){const t=[],n=[];if("string"!=typeof e||0===e.length)return{allow:t,deny:n};const r=e.split(/\s+/);for(let e=0;e<r.length;e++){const o=r[e];o&&("!"===o.charAt(0)&&o.length>1?n.push(o.slice(1).toLowerCase()):t.push(o.toLowerCase()))}return{allow:t,deny:n}}("string"==typeof r&&r.replace(/\s+/g,"").length>0?r:"!homepage !shorts watch"),E=new is;if("string"==typeof e){const t=e.split(/\s+/);for(let e=0;e<t.length;e++){const n=cs(t[e],10);n>=1&&E.add(n)}}const $=e=>!E.has(e),x=(e,t,n)=>{$(e)&&function(e,t,n){try{e()}catch(e){n("error",`Failed to install ${t}: ${e}`)}}(t,n,c)},R=()=>{const e=ls.location.href;return-1!==e.indexOf("/shorts/")||-1!==e.indexOf("youtube.com/tv")||-1!==e.indexOf("youtube.com/embed/")},P=()=>R()||!function(e,t){const n=function(e){if("string"!=typeof e||0===e.length)return"homepage";let t=e;const n=t.indexOf("?");-1!==n&&(t=t.slice(0,n));const r=t.indexOf("#");-1!==r&&(t=t.slice(0,r));const o=t.indexOf("://");-1!==o&&(t=t.slice(o+3));const i=t.indexOf("/");if(-1===i)return"homepage";const s=t.slice(i),a=/^\/([^/]+)/.exec(s);return a?a[1].toLowerCase():"homepage"}(e);for(let e=0;e<t.deny.length;e++)if(t.deny[e]===n)return!1;if(0===t.allow.length)return!0;for(let e=0;e<t.allow.length;e++)if(t.allow[e]===n)return!0;return!1}(ls.location.href,S),k=e=>{if(!e.playbackContext&&!e.playerRequest)return;const t=b(e,"context","client","configInfo");t&&t.appInstallData&&delete t.appInstallData},O=(e,t)=>{try{if(!e||!t)return;(e=>{const t=e.videoId;"string"==typeof t&&0!==t.length&&(null!==d&&d!==t&&(c("info",`New video ${t} (was ${d}) — reset to ${fs}`),p=fs),d=t)})(e);let n=p;const r=(()=>{try{const e=as.getElementById("movie_player");if(!e||"function"!=typeof e.getPlayerResponse)return null;const t=e.getPlayerResponse();return b(t,"playabilityStatus","status")}catch(e){return null}})();"LOGIN_REQUIRED"!==r&&"CONTENT_CHECK_REQUIRED"!==r||(n=gs);const o=b(e,"context","client","clientScreen"),i=()=>{t.contentPlaybackContext&&(t.contentPlaybackContext.lactMilliseconds=`${rs.now()}`)};if(n===fs&&o!==vs)return e.params=ws,e.playerRequest&&e.playerRequest.params!==ws&&(e.playerRequest.params=ws),e.playbackContext&&e.playbackContext.params!==ws&&(e.playbackContext.params=ws),i(),v(),k(e),void h++;if(n===ps&&o!==vs)return e.params!==ms&&(e.params=ms),e.playerRequest&&e.playerRequest.params!==ms&&(e.playerRequest.params=ms),e.playbackContext&&e.playbackContext.params!==ms&&(e.playbackContext.params=ms),!e.playlistId&&e.context&&e.context.client&&(e.context.client.clientScreen=vs),i(),v(),k(e),void h++;if(n===ds&&o!==vs){const n=t.params;if("string"==typeof n&&(0===n.indexOf(ws)||0===n.indexOf(ms)))return;return t.adPlaybackContext={pyv:!0},i(),k(e),void h++}if(n===hs){if("WEB"!==b(e,"context","client","clientName"))return;return e.context.client.clientScreen=vs,i(),v(),k(e),void h++}if(n===ys)return t.adPlaybackContext={adType:"AD_TYPE_INSTREAM"},i(),v(),k(e),void h++;n===gs&&(t.adPlaybackContext&&delete t.adPlaybackContext,(()=>{try{m&&os.defineProperty(as,"visibilityState",m)}catch(e){}})())}catch(e){}},T=e=>{e&&e.context&&e.context.client&&(e.playbackContext&&void 0===e.playbackContext.adPlaybackContext&&O(e,e.playbackContext),e.playerRequest&&e.playerRequest.playbackContext&&void 0===e.playerRequest.playbackContext.adPlaybackContext&&O(e,e.playerRequest.playbackContext))},j=l(g,(function(){if(R())return o(g,this,arguments);try{const e=arguments[0];e&&"object"==typeof e&&T(e)}catch(e){}return o(g,this,arguments)}));ut(j,g),x(1,(()=>{os.defineProperty(window.JSON,"stringify",{value:j,writable:!0,configurable:!0})}),"JSON.stringify");const A=l(w,(function(){if(P()||p===gs)return o(w,this,arguments);let e;try{e=o(w,this,arguments)}catch(e){return o(w,this,arguments)}try{if(!e||"object"!=typeof e)return e;if(!e.responseContext&&!e.playabilityStatus)return e;y++;const t=g(e);let n=!1;for(const e of bs)if(-1!==t.indexOf(e)){n=!0;break}const r=-1!==t.indexOf("CONTENT_CHECK_REQUIRED");if(n&&!r)return(e=>{let t;t=p===fs?ps:p===ps?ds:p===ds?hs:p===hs?ys:gs,c("info",`State: ${p} → ${t} (${e})`),p=t})("response had error marker"),e;if(p===fs){const t=b(e,"playerConfig","audioConfig");if(t&&t.muteOnStart){const n=-1!==ls.location.href.indexOf("/watch"),r=b(e,"playabilityStatus","miniplayer");if(n||e.cards&&!r){delete t.muteOnStart;const n=e.messages;n&&n[0]&&n[0].youThereRenderer&&delete n[0].youThereRenderer}}}if(p===ys){const t=b(e,"playerConfig","granularVariableSpeedConfig");t&&(t.maximumPlaybackRate=200,t.minimumPlaybackRate=25)}}catch(e){}return e}));ut(A,w),x(2,(()=>{os.defineProperty(window.JSON,"parse",{value:A,writable:!0,configurable:!0})}),"JSON.parse");const L=window.TextEncoder.prototype.encode,C=l(L,(function(){if(R())return o(L,this,arguments);try{const e=arguments[0];if("string"==typeof e&&(-1!==e.indexOf('"contentPlaybackContext"')||-1!==e.indexOf('"adSignalsInfo"'))){const t=w(e);t&&t.context&&t.context.client&&(T(t),arguments[0]=g(t))}}catch(e){}return o(L,this,arguments)}));ut(C,L),x(3,(()=>{os.defineProperty(window.TextEncoder.prototype,"encode",{value:C,writable:!0,configurable:!0})}),"TextEncoder.prototype.encode");const M=new Proxy(window.Request,{construct(e,t,n){try{if(R())return Reflect.construct(e,t,n);const r=t[0],o=t[1],i="string"==typeof r?r:r&&"string"==typeof r.url?r.url:"",s=o&&o.body;if(-1!==i.indexOf("youtubei")&&"string"==typeof s&&(-1!==s.indexOf('"contentPlaybackContext"')||-1!==s.indexOf('"adSignalsInfo"'))){const e=w(s);e&&e.context&&e.context.client&&(T(e),o.body=g(e))}}catch(e){}return Reflect.construct(e,t,n)}});x(4,(()=>{os.defineProperty(window,"Request",{value:M,writable:!0,configurable:!0})}),"Request");const I=window.XMLHttpRequest.prototype.send,N=l(I,(function(){if(R())return o(I,this,arguments);try{const e=arguments[0],t=ns.isArray(e),n=t?e[0]:e;if("string"==typeof n&&(-1!==n.indexOf('"contentPlaybackContext"')||-1!==n.indexOf('"adSignalsInfo"'))){const e=w(n);if(e&&e.context&&e.context.client){T(e);const n=g(e);t?arguments[0][0]=n:arguments[0]=n}}}catch(e){}return o(I,this,arguments)}));ut(N,I),x(5,(()=>{os.defineProperty(window.XMLHttpRequest.prototype,"send",{value:N,writable:!0,configurable:!0})}),"XMLHttpRequest.prototype.send");const D={apply(e,t,n){const r=Reflect.apply(e,t,n);try{if(r&&r.responseContext){delete r.adSlots,delete r.playerAds;const e=b(r,"playerConfig","audioConfig");if(e&&e.muteOnStart){const t=-1!==ls.location.href.indexOf("/watch"),n=b(r,"playabilityStatus","miniplayer");if(t||r.cards&&!n){delete e.muteOnStart;const t=r.messages;t&&t[0]&&t[0].youThereRenderer&&delete t[0].youThereRenderer}}}}catch(e){}return r}},F={apply(e,t,n){try{const e=n[0];if(e&&"string"==typeof e.value&&-1!==e.value.indexOf("playerResponse")){let t=e.value;const r=-1!==ls.location.href.indexOf("/watch"),o=-1!==t.indexOf("cards")&&-1===t.indexOf('"miniplayer"');(r||o)&&-1!==t.indexOf('"muteOnStart":true')&&(t=t.replace('"muteOnStart":true','"muteOnStart":false'),-1!==t.indexOf('"youThereRenderer":')&&(t=t.replace('"youThereRenderer":','"no_youThereRenderer":'))),t=t.replace(/"(adSlots|playerAds)":/g,'"no_ads":'),e.value=t,n[0]=e}}catch(e){}return Reflect.apply(e,t,n)}},q=window.Promise.prototype.then,W=l(q,(function(){if(P())return o(q,this,arguments);try{const e=arguments[0];if("function"==typeof e){const t=e.toString();-1!==t.indexOf("jspbResponseCtor")?arguments[0]=new Proxy(e,D):-1!==t.indexOf(".next(")&&(arguments[0]=new Proxy(e,F))}}catch(e){}return o(q,this,arguments)}));ut(W,q),x(6,(()=>{os.defineProperty(window.Promise.prototype,"then",{value:W,writable:!0,configurable:!0})}),"Promise.prototype.then");const H=window.Node.prototype.appendChild,J=l(H,(function(){const e=o(H,this,arguments);if(R())return e;try{e instanceof s&&"about:blank"===e.src&&e.contentWindow&&(e.contentWindow.fetch=ls.fetch,e.contentWindow.Request=ls.Request)}catch(e){}return e}));ut(J,H),x(7,(()=>{os.defineProperty(window.Node.prototype,"appendChild",{value:J,writable:!0,configurable:!0})}),"Node.prototype.appendChild");const B=["/youtubei/v1/player","/get_watch","/get_video_info"];let _=0,V=0,z=0;pi(((e,t)=>{if(!$(8)||!t||"string"!=typeof t.url||P())return e;let n=!1;for(const e of B)if(-1!==t.url.indexOf(e)){n=!0;break}if(!n)return e;if("string"==typeof e.url&&0===e.url.indexOf("data:"))return z++,e;if(-1===(e.headers.get("content-type")||"").toLowerCase().indexOf("json"))return e;const r=$s(ls.location.href);return e.clone().json().then((t=>{let n=!1;const o=[];if(t&&t.playabilityStatus&&o.push(t),ns.isArray(t))for(const e of t)e&&e.playerResponse&&e.playerResponse.playabilityStatus&&o.push(e.playerResponse);for(const e of o){Ss(e)&&(n=!0),Es(e,r)&&(n=!0,V++)}if(!n)return e;_++;const i=new a(g(t),{status:e.status,statusText:e.statusText,headers:e.headers});return os.defineProperties(i,{ok:{value:e.ok},redirected:{value:e.redirected},type:{value:e.type},url:{value:e.url}}),i})).catch((()=>e))})),Mi(((e,t)=>{if(!$(9)||!t||"string"!=typeof t.url||P())return e;let n=!1;for(const e of B)if(-1!==t.url.indexOf(e)){n=!0;break}if(!n)return e;if(0===t.url.indexOf("data:"))return z++,e;if("string"!=typeof e||0===e.length)return e;if(-1===e.indexOf("playerResponse")&&-1===e.indexOf("playabilityStatus"))return e;const r=$s(ls.location.href);try{const t=w(e);let n=!1;const o=[];if(t&&t.playabilityStatus&&o.push(t),ns.isArray(t))for(const e of t)e&&e.playerResponse&&e.playerResponse.playabilityStatus&&o.push(e.playerResponse);for(const e of o){const t=Ss(e),o=Es(e,r);t&&(n=!0),o&&(n=!0,V++)}return n?(_++,g(t)):e}catch(t){return e}}));const U=(e,t)=>{if(null==e)return t;const n=cs(`${e}`,10);return n>=0?n:t},X=U(t,5e3),G=U(n,600),K=new is,Q=new is,Y=new ss;let Z=0,ee=0;const te=()=>{try{const e=as.getElementById("movie_player"),t=e&&"function"==typeof e.getPlayerResponse?e.getPlayerResponse():null;return t&&t.videoDetails&&t.videoDetails.videoId||""}catch(e){return""}},ne=()=>!P(),re=e=>{let t=!1;try{const e=as.getElementById("movie_player");e&&"function"==typeof e.unMute&&(e.unMute(),t=!0,"function"==typeof e.getVolume&&"function"==typeof e.setVolume&&0===e.getVolume()&&e.setVolume(100))}catch(e){}try{e&&e.muted&&(e.muted=!1)}catch(e){}return t},oe=()=>{if(P())return;const e=as.querySelector("video.html5-main-video")||as.querySelector("video.video-stream");if(!e||Y.has(e))return;Y.add(e);let t=0,n=0;e.addEventListener("playing",(()=>{try{if(t=rs.now(),n=0,!ne())return;if(!e.muted)return;const r=te();if(r&&Q.has(r))return;if(r&&K.has(r))return;r&&K.add(r),Z++;const o=re(e);c("info",`[video.playing] muted at first playing for videoId=${r||"?"} — unmuted (via `+(o?"player.unMute()":"element")+").")}catch(e){}})),e.addEventListener("volumechange",(()=>{try{if(!ne())return;const r=te(),o=0!==ee&&rs.now()-ee<G;if(!e.muted)return void(o&&r&&Q.delete(r));if(o)return r&&Q.add(r),void c("info",`[video.volumechange] mute within user-gesture window — remembering + respecting user mute (videoId=${r||"?"}).`);if(r&&Q.has(r))return void c("info",`[video.volumechange] mute on user-muted video — respecting (videoId=${r}).`);if(0===t)return;const i=rs.now()-t;if(i>=X)return;if(n>=5)return;n++,Z++;const s=re(e);c("info",`[video.volumechange] late mute at +${i}ms after playing for videoId=${r||"?"} — unmuted (via `+(s?"player.unMute()":"element")+").")}catch(e){}})),c("info",`[video-watcher] attached to <video> element (late-mute window=${X}ms).`)};if($(10)){oe();new MutationObserver((()=>{oe()})).observe(as,{childList:!0,subtree:!0}),as.addEventListener("yt-navigate-finish",(()=>{oe()}));const e=()=>{ee=rs.now()};as.addEventListener("click",(t=>{try{const n=t.target;n&&"function"==typeof n.closest&&n.closest(".ytp-mute-button")&&e()}catch(e){}}),!0),as.addEventListener("keydown",(t=>{try{const n=t.key;if("m"!==n&&"M"!==n)return;const r=as.activeElement,o=r&&r.tagName?r.tagName:"";if("INPUT"===o||"TEXTAREA"===o||r&&r.isContentEditable)return;e()}catch(e){}}),!0)}c("info",`Installed. Starting state: ${p}. Hooks: JSON.{stringify,parse}, TextEncoder.encode, Request, XMLHttpRequest.send, Promise.then, Node.appendChild, fetch-postFetch, xhr-postResponse, video-unmute. Counters: ${h} mutations, ${y} responses inspected, ${_} response-rewrites, ${V} startSeconds-injects, ${z} honeypot bypasses, ${Z} video-element unmutes. Windows: late-mute=${X}ms, user-gesture=${G}ms.`+(E.size>0?` Disabled hooks: ${[...E].join(",")}.`:"")+function(e){if(0===e.allow.length&&0===e.deny.length)return"";const t=[];e.allow.length>0&&t.push("allow=["+e.allow.join(",")+"]");e.deny.length>0&&t.push("deny=["+e.deny.join(",")+"]");return" Path filter: "+t.join(" ")+"."}(S)),f()},"tmp-yt-force-reload":function(e,t,n,r){if(As)return;As=!0;const o=ot("tmp-yt-force-reload"),{mark:i,end:s}=Qe("tmp-yt-force-reload");i();const a=(()=>{const e="string"==typeof n?n.toString():"0",t=Os(e,10);return isNaN(t)||t<0?0:t})(),c="every"===("string"==typeof e?e.toString():"").toLowerCase()?"every":"first",l=(()=>{const e=("string"==typeof t?t.toString():"").toLowerCase();return"dom"===e||"player"===e||"both"===e?e:"none"})(),u=function(e){const t=[],n=[];if("string"!=typeof e||0===e.length)return{allow:t,deny:n};const r=e.split(/\s+/);for(let e=0;e<r.length;e++){const o=r[e];o&&("!"===o.charAt(0)&&o.length>1?n.push(o.slice(1).toLowerCase()):t.push(o.toLowerCase()))}return{allow:t,deny:n}}(r),f=xs.now();let p="",d=0,h=!1;const y=new Ps;let g=!1,w=0;const m=()=>{if("none"===l)return;if(-1===js.location.href.indexOf("/watch?"))return;if(!Cs(js.location.href,u))return;const e=ks.getElementById("movie_player");if(!e||"function"!=typeof e.loadVideoById)return;if(!(e=>{if("none"===l||!e)return!1;let t=!1,n=!1;if("dom"===l||"both"===l)try{t=e.classList.contains("ytp-error")||null!==e.querySelector(".ytp-error")}catch(e){}if("player"===l||"both"===l)try{const t="function"==typeof e.getPlayerResponse?e.getPlayerResponse():null,r=t&&t.playabilityStatus&&t.playabilityStatus.status;n="string"==typeof r&&"OK"!==r&&"OK_LIMITED"!==r}catch(e){}return"both"===l?t&&n:"player"===l?n:t})(e))return;let t;try{t="function"==typeof e.getPlayerResponse?e.getPlayerResponse():null}catch(e){t=null}const n=t&&t.videoDetails&&t.videoDetails.videoId;if("string"!=typeof n||""===n)return;if(y.has(n))return;y.add(n);const r=t.playerConfig&&t.playerConfig.playbackStartConfig&&t.playerConfig.playbackStartConfig.startSeconds||0;w++;const i=w,s=xs.now()-f,a=t&&t.playabilityStatus&&t.playabilityStatus.status;o("info",`error#${i} [+${s}ms] Error detected for "${n}" (signal=${l}, playabilityStatus=${a}). Firing loadVideoById("${n}", ${r}).`);try{e.loadVideoById(n,r)}catch(e){o("error",`error#${i} loadVideoById threw: ${e}`)}},v=()=>{if(h)return!0;if(-1===js.location.href.indexOf("/watch?"))return!1;if(!Cs(js.location.href,u))return!1;const e=ks.getElementById("movie_player");if(!e||"function"!=typeof e.loadVideoById)return!1;let t;(e=>{if("none"===l)return;if(g||!e)return;g=!0,new Rs((()=>{m()})).observe(e,{attributes:!0,attributeFilter:["class"],childList:!0,subtree:!0}),o("info",`Error arm attached to movie_player (signal=${l}).`),m()})(e);try{t="function"==typeof e.getPlayerResponse?e.getPlayerResponse():null}catch(e){t=null}const n=t&&t.videoDetails&&t.videoDetails.videoId;if("string"!=typeof n||""===n)return!1;if(n===p)return!1;const r=Ls(e,"getPlayerState"),i=Ls(e,"getCurrentTime"),s=Ls(e,"getVideoLoadedFraction"),y=Ls(e,"getDuration"),w=Ls(e,"getPlayerStateObject"),v=`state=${r}, current=${i}, loadedFraction=${s}, duration=${y}, isBuffering=${w&&w.isBuffering}`;let b,S;if(1===r||2===r||0===r?(b=!1,S="already playing/paused/ended"):3===r&&"number"==typeof i&&i>=1&&("number"==typeof s&&s>=.05)?(b=!1,S="mid-playback buffer"):(b=!0,S="fresh / pre-playback"),!b)return p=n,o("info",`Skipping reload for "${n}": ${S}. ${v}`),!0;const E=t.playerConfig&&t.playerConfig.playbackStartConfig&&t.playerConfig.playbackStartConfig.startSeconds||0;p=n,d++;const $=d,x=n,R=E,P=()=>{try{const t=xs.now()-f;o("info",`#${$} [+${t}ms] Firing loadVideoById("${x}", ${R}). ${v}`),e.loadVideoById(x,R)}catch(e){o("error",`#${$} loadVideoById threw: ${e}`)}};return a>0?Ts(P,a):P(),"first"===c&&(h=!0,o("info","first-mode: disabling further reloads after this fire.")),!0},b=()=>{if(v())return;let e=new Rs((()=>{v()&&e&&(e.disconnect(),e=null)}));e.observe(ks,{childList:!0,subtree:!0}),Ts((()=>{e&&(e.disconnect(),e=null)}),1e4)};"loading"===ks.readyState?ks.addEventListener("DOMContentLoaded",b):b(),ks.addEventListener("yt-navigate-finish",(()=>{let e=30;const t=()=>{v()||(e--,e<=0||Ts(t,100))};Ts(t,100)})),o("info","Installed. Mode="+c+". "+("first"===c?"Fires once on the first video, then disables.":"Fires on every new video (cold load + SPA nav).")+(a>0?` +${a}ms delay.`:"")+("none"===l?" Error arm disabled.":` Error arm via ${l} signal (1 reload/video).`)+function(e){if(0===e.allow.length&&0===e.deny.length)return"";const t=[];e.allow.length>0&&t.push("allow=["+e.allow.join(",")+"]");e.deny.length>0&&t.push("deny=["+e.deny.join(",")+"]");return" Path filter: "+t.join(" ")+"."}(u)),s()}};
const snippets=Ms;
let context;
for (const [name, ...args] of filters) {
if (snippets.hasOwnProperty(name)) {
try { context = snippets[name].apply(context, args); }
catch (error) { console.error(error); }
}
}
context = void 0;
};
const graph = new Map([["abort-current-inline-script",null],["abort-on-iframe-property-read",null],["abort-on-iframe-property-write",null],["abort-on-property-read",null],["abort-on-property-write",null],["array-override",null],["blob-override",null],["cookie-remover",null],["debug",null],["event-override",null],["freeze-element",null],["hide-if-canvas-contains",null],["hide-if-shadow-contains",null],["json-override",null],["json-prune",null],["map-override",null],["override-property-read",null],["prevent-element-src-loading",null],["prevent-listener",null],["prevent-window-open",null],["profile",null],["replace-argument",null],["replace-fetch-request",null],["replace-fetch-response",null],["replace-outbound-value",null],["replace-xhr-request",null],["replace-xhr-response",null],["strip-fetch-query-parameter",null],["timer-override",null],["trace",null],["tmp-yt-buffering-spoof",null],["tmp-yt-force-reload",null]]);
callback.get = snippet => graph.get(snippet);
callback.has = snippet => graph.has(snippet);
callback.getGraph = () => graph;
callback.setEnvironment = env => {
  if (typeof currentEnvironment !== "undefined")
    currentEnvironment = env;
};
callback.setDebugStyle = styles => {
  if (typeof currentEnvironment !== "undefined")
  {
    delete currentEnvironment.initial;
    currentEnvironment.debugCSSProperties = styles;
  }
    
};
callback.getEnvironment = () => currentEnvironment;
/* harmony default export */ const main = (callback);
;// ./src/content/shared/constants.js
/*
 * This file is part of eyeo's Web Extension Ad Blocking Toolkit (EWE),
 * Copyright (C) 2006-present eyeo GmbH
 *
 * EWE is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3 as
 * published by the Free Software Foundation.
 *
 * EWE is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with EWE.  If not, see <http://www.gnu.org/licenses/>.
 */

/**
 * Prefix that should be used for storage and synchronization to avoid conflicts
 * when multiple extensions are installed in the same session.
 *
 * !!! IMPORTANT - DO NOT CHANGE THIS VALUE !!!
 * This exact string "abp" is hardcoded in the build
 * configurations and is replaced during the build process with host-specific
 * values (e.g., "ab" for Adblock, "abp" for Adblock Plus).
 *
 * If you change this value, the build process will NOT replace it, and the
 * extension will fail to work properly due to namespace conflicts.
 *
 * Build configuration references:
 * - host/adblock/build/config/base.mjs (replacements.search)
 * - host/adblockplus/build/webext/config/base.mjs (replacements.search)
 *
 * @type {string}
 */
const HOST_PREFIX_TO_REPLACE = "abp";

/**
 * Dataset key used to exchange the communication channel name between content
 * scripts in different contexts (main world and isolated world)
 * @type {string}
 */
const COMMS_CHANNEL_DATASET_KEY = `${HOST_PREFIX_TO_REPLACE}FiltersChannel`;

/**
 * Event used to communicate between content script contexts
 * @type {string}
 */
const HANDSHAKE_EVENT_NAME = `${HOST_PREFIX_TO_REPLACE}-handshake`;

/**
 * Storage key used to cache the filters config in content scripts
 * @type {string}
 */
const CACHED_FILTERS_CONFIG_KEY = `${HOST_PREFIX_TO_REPLACE}-filters-config`;

;// ./src/all/snippets.js
/**
 * CSS properties applied to elements hidden in debug mode
 * @type {string[][]}
 */
const DEBUG_CSS_PROPERTIES = [
    ["background", "repeating-linear-gradient(to bottom, #e67370 0, #e67370 9px, white 9px, white 10px)"],
    ["outline", "solid red"]
  ];
  
;// ./src/content/main/shims/storage.js
/*
 * This file is part of eyeo's Web Extension Ad Blocking Toolkit (EWE),
 * Copyright (C) 2006-present eyeo GmbH
 *
 * EWE is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3 as
 * published by the Free Software Foundation.
 *
 * EWE is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with EWE.  If not, see <http://www.gnu.org/licenses/>.
 */

/* eslint-disable no-extend-native */

function shimStorage(CACHED_FILTERS_CONFIG_KEY) {
  // =================== Secured copies of native functions ====================
  // These are captured before page scripts run.
  // Used inside Proxy apply handlers which run after page scripts.
  const {parse: $JSONparse, stringify: $JSONstringify} = JSON;
  const {keys: $ObjectKeys} = Object;
  const {
    apply: $ReflectApply,
    ownKeys: $ReflectOwnKeys,
    get: $ReflectGet,
    set: $ReflectSet,
    has: $ReflectHas,
    getOwnPropertyDescriptor: $ReflectGetOwnPropertyDescriptor,
    defineProperty: $ReflectDefineProperty,
    deleteProperty: $ReflectDeleteProperty
  } = Reflect;
  const {filter: $ArrayFilter} = Array.prototype;
  const {get: $MapGet, set: $MapSet, has: $MapHas} = Map.prototype;
  const $String = String;

  // Helpers using secured copies
  const filter = (arr, fn) => $ReflectApply($ArrayFilter, arr, [fn]);
  const mapGet = (map, key) => $ReflectApply($MapGet, map, [key]);
  const mapSet = (map, key, val) => $ReflectApply($MapSet, map, [key, val]);
  const mapHas = (map, key) => $ReflectApply($MapHas, map, [key]);

  // Need to unwrap our own proxies when multiple extensions run this shim.
  const realLocalStorage = window.localStorage;
  const realSessionStorage = window.sessionStorage;
  let localStorageProxy;
  let sessionStorageProxy;
  function unwrapStorage(storage) {
    if (storage === localStorageProxy) {
      return realLocalStorage;
    }
    if (storage === sessionStorageProxy) {
      return realSessionStorage;
    }
    return storage;
  }

  const originalToStrings = new Map();

  const storageGetItemDesc = Object.getOwnPropertyDescriptor(
    Storage.prototype, "getItem"
  );
  const originalStorageGetItem = storageGetItemDesc.value;

  // =================== Conditional application of the shim ===================
  function shouldShimStorage() {
    const config = getConfig(window.sessionStorage) ||
      getConfig(window.localStorage);
    return Boolean(config);
  }

  if (!shouldShimStorage()) {
    return;
  }

  // ===================== Storage.prototype.getItem ======================
  // @docs https://developer.mozilla.org/en-US/docs/Web/API/Storage/getItem
  function getConfig(storage) {
    try {
      const configSerialized = $ReflectApply(
        originalStorageGetItem, unwrapStorage(storage),
        [CACHED_FILTERS_CONFIG_KEY]
      );
      if (configSerialized) {
        return $JSONparse(configSerialized);
      }
    }
    catch (e) {
      // If we can't parse, return null
    }
    return null;
  }

  function websiteHasValue(config) {
    return config && typeof config.websiteValue === "string";
  }
  const storageGetItemProxy = new Proxy(originalStorageGetItem, {
    apply(target, thisArg, argumentsList) {
      const key = argumentsList[0];
      const unwrappedThis = unwrapStorage(thisArg);
      if (key === CACHED_FILTERS_CONFIG_KEY) {
        const config = getConfig(unwrappedThis);
        if (websiteHasValue(config)) {
          return config.websiteValue;
        }
        return null;
      }
      return $ReflectApply(target, unwrappedThis, argumentsList);
    }
  });
  Object.defineProperty(Storage.prototype, "getItem", {
    ...storageGetItemDesc,
    value: storageGetItemProxy
  });
  mapSet(
    originalToStrings,
    storageGetItemProxy,
    originalStorageGetItem.toString.bind(originalStorageGetItem)
  );

  // ===================== Storage.prototype.setItem ===========================
  // @docs https://developer.mozilla.org/en-US/docs/Web/API/Storage/setItem
  const storageSetItemDesc = Object.getOwnPropertyDescriptor(
    Storage.prototype, "setItem"
  );
  const originalStorageSetItem = storageSetItemDesc.value;
  const storageSetItemProxy = new Proxy(originalStorageSetItem, {
    apply(target, thisArg, argumentsList) {
      const key = argumentsList[0];
      const unwrappedThis = unwrapStorage(thisArg);
      if (key === CACHED_FILTERS_CONFIG_KEY) {
        const config = getConfig(unwrappedThis) || {};
        config.websiteValue = $String(argumentsList[1]);
        $ReflectApply(
          target,
          unwrappedThis,
          [CACHED_FILTERS_CONFIG_KEY, $JSONstringify(config)]
        );
        return void 0;
      }
      return $ReflectApply(target, unwrappedThis, argumentsList);
    }
  });
  Object.defineProperty(Storage.prototype, "setItem", {
    ...storageSetItemDesc,
    value: storageSetItemProxy
  });
  mapSet(
    originalToStrings,
    storageSetItemProxy,
    originalStorageSetItem.toString.bind(originalStorageSetItem)
  );

  // ================== Storage.prototype.removeItem ==========================
  // @docs https://developer.mozilla.org/en-US/docs/Web/API/Storage/removeItem
  const storageRemoveItemDesc = Object.getOwnPropertyDescriptor(
    Storage.prototype, "removeItem"
  );
  const originalStorageRemoveItem = storageRemoveItemDesc.value;
  const storageRemoveItemProxy = new Proxy(originalStorageRemoveItem, {
    apply(target, thisArg, argumentsList) {
      const key = argumentsList[0];
      const unwrappedThis = unwrapStorage(thisArg);
      if (key === CACHED_FILTERS_CONFIG_KEY) {
        const config = getConfig(unwrappedThis);
        if (websiteHasValue(config)) {
          delete config.websiteValue;
          $ReflectApply(
            originalStorageSetItem,
            unwrappedThis, [CACHED_FILTERS_CONFIG_KEY, $JSONstringify(config)]
          );
        }
        return void 0;
      }
      return $ReflectApply(target, unwrappedThis, argumentsList);
    }
  });
  Object.defineProperty(Storage.prototype, "removeItem", {
    ...storageRemoveItemDesc,
    value: storageRemoveItemProxy
  });
  mapSet(
    originalToStrings,
    storageRemoveItemProxy,
    originalStorageRemoveItem.toString.bind(originalStorageRemoveItem)
  );

  // ==================== Storage.prototype.clear ============================
  // @docs https://developer.mozilla.org/en-US/docs/Web/API/Storage/clear
  const storageClearDesc = Object.getOwnPropertyDescriptor(
    Storage.prototype, "clear"
  );
  const originalStorageClear = storageClearDesc.value;
  const storageClearProxy = new Proxy(originalStorageClear, {
    apply(target, thisArg, argumentsList) {
      const unwrappedThis = unwrapStorage(thisArg);
      const config = getConfig(unwrappedThis);
      if (config) {
        delete config.websiteValue;
      }

      $ReflectApply(target, unwrappedThis, argumentsList);

      // Restore our config (without websiteValue)
      if (config && $ObjectKeys(config).length > 0) {
        $ReflectApply(
          originalStorageSetItem,
          unwrappedThis, [CACHED_FILTERS_CONFIG_KEY, $JSONstringify(config)]
        );
      }
      return void 0;
    }
  });
  Object.defineProperty(Storage.prototype, "clear", {
    ...storageClearDesc,
    value: storageClearProxy
  });
  mapSet(
    originalToStrings,
    storageClearProxy,
    originalStorageClear.toString.bind(originalStorageClear)
  );

  // ===================== Storage.prototype.key ===============================
  // @docs https://developer.mozilla.org/en-US/docs/Web/API/Storage/key
  const storageKeyDesc = Object.getOwnPropertyDescriptor(
    Storage.prototype, "key"
  );
  const originalStorageKey = storageKeyDesc.value;
  const storageKeyProxy = new Proxy(originalStorageKey, {
    apply(target, thisArg, argumentsList) {
      const unwrappedThis = unwrapStorage(thisArg);
      const config = getConfig(unwrappedThis);
      if (!config || websiteHasValue(config)) {
        return $ReflectApply(target, unwrappedThis, argumentsList);
      }

      const requestedIndex = argumentsList[0];
      for (let i = 0; i <= requestedIndex; i++) {
        const key = $ReflectApply(target, unwrappedThis, [i]);
        if (key === CACHED_FILTERS_CONFIG_KEY) {
          return $ReflectApply(target, unwrappedThis, [requestedIndex + 1]);
        }
      }
      return $ReflectApply(target, unwrappedThis, argumentsList);
    }
  });
  Object.defineProperty(Storage.prototype, "key", {
    ...storageKeyDesc,
    value: storageKeyProxy
  });
  mapSet(
    originalToStrings,
    storageKeyProxy,
    originalStorageKey.toString.bind(originalStorageKey)
  );

  // =================== Storage.prototype.length ============================
  // @docs https://developer.mozilla.org/en-US/docs/Web/API/Storage/length
  const storageLengthDesc = Object.getOwnPropertyDescriptor(
    Storage.prototype, "length"
  );
  const originalStorageLengthGetter = storageLengthDesc.get;
  Object.defineProperty(Storage.prototype, "length", {
    ...storageLengthDesc,
    get() {
      const unwrappedThis = unwrapStorage(this);
      const originalLength =
        $ReflectApply(originalStorageLengthGetter, unwrappedThis, []);
      const config = getConfig(unwrappedThis);
      if (config && !websiteHasValue(config)) {
        return originalLength - 1;
      }
      return originalLength;
    }
  });

  // ================== Proxy wrapper for localStorage ===========
  // Handles: {...localStorage}, Object.keys(), Object.values(), for...in, etc.
  const methodProxyCache = new Map();

  function getMethodProxy(method) {
    if (mapHas(methodProxyCache, method)) {
      return mapGet(methodProxyCache, method);
    }
    const methodProxy = new Proxy(method, {
      apply(fn, thisArg, args) {
        return $ReflectApply(fn, thisArg, args);
      }
    });
    mapSet(methodProxyCache, method, methodProxy);
    // Register toString for the wrapper to preserve function name
    const originalMethod = mapGet(originalToStrings, method);
    if (originalMethod) {
      mapSet(originalToStrings, methodProxy, originalMethod);
    }
    return methodProxy;
  }

  const storageInstanceProxyConfig = {
    ownKeys(target) {
      const keys = $ReflectOwnKeys(target);
      const config = getConfig(target);
      if (config && !websiteHasValue(config)) {
        return filter(keys, key => key !== CACHED_FILTERS_CONFIG_KEY);
      }
      return keys;
    },

    // Required for spread operator
    getOwnPropertyDescriptor(target, prop) {
      if (prop === CACHED_FILTERS_CONFIG_KEY) {
        const config = getConfig(target);
        if (config && !websiteHasValue(config)) {
          return void 0; // Hide the property entirely
        }
        // When website has set a value, return a proper enumerable descriptor
        // with the website's value (not our internal config)
        if (websiteHasValue(config)) {
          return {
            value: config.websiteValue,
            writable: true,
            enumerable: true,
            configurable: true
          };
        }
      }
      return $ReflectGetOwnPropertyDescriptor(target, prop);
    },

    // Needed for 'in' operator
    has(target, prop) {
      if (prop === CACHED_FILTERS_CONFIG_KEY) {
        const config = getConfig(target);
        if (config && !websiteHasValue(config)) {
          return false;
        }
      }
      return $ReflectHas(target, prop);
    },

    // Forward get/set using original target so native methods work correctly
    get(target, prop) {
      if (prop === CACHED_FILTERS_CONFIG_KEY) {
        return target.getItem(CACHED_FILTERS_CONFIG_KEY);
      }
      // Return correct toStringTag so Object.prototype.toString returns
      // [object Storage] instead of [object Object] (for older Firefox)
      if (prop === Symbol.toStringTag) {
        return "Storage";
      }
      const value = $ReflectGet(target, prop, target);
      // For methods, wrap in a proxy to bind `this` to original target
      // while preserving toString behavior
      if (typeof value === "function") {
        return getMethodProxy(value);
      }
      return value;
    },

    set(target, prop, value) {
      if (prop === CACHED_FILTERS_CONFIG_KEY) {
        target.setItem(CACHED_FILTERS_CONFIG_KEY, value);
        return true;
      }
      return $ReflectSet(target, prop, value, target);
    },

    defineProperty(target, prop, descriptor) {
      if (prop === CACHED_FILTERS_CONFIG_KEY) {
        if ("value" in descriptor) {
          target.setItem(CACHED_FILTERS_CONFIG_KEY, descriptor.value);
        }
        return true;
      }
      return $ReflectDefineProperty(target, prop, descriptor);
    },

    deleteProperty(target, prop) {
      if (prop === CACHED_FILTERS_CONFIG_KEY) {
        target.removeItem(CACHED_FILTERS_CONFIG_KEY);
        return true;
      }
      return $ReflectDeleteProperty(target, prop);
    }
  };

  localStorageProxy = new Proxy(
    window.localStorage,
    storageInstanceProxyConfig
  );

  sessionStorageProxy = new Proxy(
    window.sessionStorage,
    storageInstanceProxyConfig
  );

  // Capture the native accessor getters before redefining.
  const localStorageDesc =
    Object.getOwnPropertyDescriptor(window, "localStorage");
  const sessionStorageDesc =
    Object.getOwnPropertyDescriptor(window, "sessionStorage");
  const nativeLocalStorageGetter = localStorageDesc && localStorageDesc.get;
  const nativeSessionStorageGetter =
    sessionStorageDesc && sessionStorageDesc.get;

  function localStorageGetter() {
    return localStorageProxy;
  }
  function sessionStorageGetter() {
    return sessionStorageProxy;
  }

  if (nativeLocalStorageGetter) {
    $ReflectDefineProperty(localStorageGetter, "name", {
      value: nativeLocalStorageGetter.name,
      configurable: true
    });
    mapSet(
      originalToStrings,
      localStorageGetter,
      nativeLocalStorageGetter.toString.bind(nativeLocalStorageGetter)
    );
  }
  if (nativeSessionStorageGetter) {
    $ReflectDefineProperty(sessionStorageGetter, "name", {
      value: nativeSessionStorageGetter.name,
      configurable: true
    });
    mapSet(
      originalToStrings,
      sessionStorageGetter,
      nativeSessionStorageGetter.toString.bind(nativeSessionStorageGetter)
    );
  }

  Object.defineProperty(window, "localStorage", {
    get: localStorageGetter,
    configurable: true,
    enumerable: true
  });

  Object.defineProperty(window, "sessionStorage", {
    get: sessionStorageGetter,
    configurable: true,
    enumerable: true
  });

  // ===================== Function.prototype.toString =========================
  // @docs https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function/toString
  const functionToStringDesc = Object.getOwnPropertyDescriptor(
    Function.prototype, "toString"
  );
  const originalFunctionToString = functionToStringDesc.value;
  const functionToStringProxy = new Proxy(originalFunctionToString, {
    apply(target, thisArg, argumentsList) {
      // Call "super" first, just in case the function was overwritten and had
      // checks if it was called
      const r = $ReflectApply(target, thisArg, argumentsList);

      const restoredToString = mapGet(originalToStrings, thisArg);
      if (restoredToString) {
        return $ReflectApply(restoredToString, thisArg, argumentsList);
      }

      return r;
    }
  });
  Object.defineProperty(Function.prototype, "toString", {
    ...functionToStringDesc,
    value: functionToStringProxy
  });
  mapSet(
    originalToStrings,
    functionToStringProxy,
    originalFunctionToString.toString.bind(originalFunctionToString)
  );
}

;// ./src/content/shared/helpers.js
/*
 * This file is part of eyeo's Web Extension Ad Blocking Toolkit (EWE),
 * Copyright (C) 2006-present eyeo GmbH
 *
 * EWE is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3 as
 * published by the Free Software Foundation.
 *
 * EWE is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with EWE.  If not, see <http://www.gnu.org/licenses/>.
 */



/**
 * Claims a communication channel name from the document's dataset.
 *
 * If a channel name already exists in the dataset, it is consumed (removed
 * from the dataset and returned). If no channel name exists, the fallback
 * channel is stored in the dataset and returned.
 *
 * This mechanism ensures that only one content script can claim the
 * channel name at a time, preventing conflicts when the main world
 * and isolated world scripts execution order is not consistent.
 * @see https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/139#changes_for_add-on_developers
 * @see https://bugzil.la/1792685
 * @see https://eyeo.atlassian.net/wiki/spaces/B2C/pages/1666678786/Content-script+based+snippets
 *
 * @param {string} fallbackChannel - The channel name to use and store if
 *   none is present.
 * @returns {string} The claimed channel name (either the existing one
 *   or the fallback).
 */
function claimCommsChannel(fallbackChannel) {
  let channelName = document.documentElement.dataset[COMMS_CHANNEL_DATASET_KEY];

  if (!channelName) {
    channelName = fallbackChannel;
    document.documentElement.dataset[COMMS_CHANNEL_DATASET_KEY] = channelName;
  }
  else {
    delete document.documentElement.dataset[COMMS_CHANNEL_DATASET_KEY];
  }

  return channelName;
}

;// ./src/all/errors.js
/*
 * This file is part of eyeo's Web Extension Ad Blocking Toolkit (EWE),
 * Copyright (C) 2006-present eyeo GmbH
 *
 * EWE is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3 as
 * published by the Free Software Foundation.
 *
 * EWE is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with EWE.  If not, see <http://www.gnu.org/licenses/>.
 */

const ERROR_NO_CONNECTION = (/* unused pure expression or super */ null && ("Could not establish connection. " +
      "Receiving end does not exist."));
const ERROR_CLOSED_CONNECTION = (/* unused pure expression or super */ null && ("A listener indicated an asynchronous " +
      "response by returning true, but the message channel closed before a " +
      "response was received"));
// https://bugzilla.mozilla.org/show_bug.cgi?id=1578697
const ERROR_MANAGER_DISCONNECTED = "Message manager disconnected";

/**
 * Reconstructs an error from a serializable error object
 *
 * @param {Object} errorData - Error object
 *
 * @returns {Error} error
 */
function fromSerializableError(errorData) {
  const error = new Error(errorData.message);
  error.cause = errorData.cause;
  error.name = errorData.name;
  error.stack = errorData.stack;

  return error;
}

/**
 * Filters out `browser.runtime.sendMessage` errors to do with the receiving end
 * no longer existing.
 *
 * @param {Promise} promise The promise that should have "no connection" errors
 *   ignored. Generally this would be the promise returned by
 *   `browser.runtime.sendMessage`.
 * @return {Promise} The same promise, but will resolve with `undefined` instead
 *   of rejecting if the receiving end no longer exists.
 */
function ignoreNoConnectionError(promise) {
  return promise.catch(error => {
    if (typeof error == "object" &&
        (error.message == ERROR_NO_CONNECTION ||
         error.message == ERROR_CLOSED_CONNECTION ||
         error.message == ERROR_MANAGER_DISCONNECTED)) {
      return;
    }

    throw error;
  });
}

/**
 * Creates serializable error object from given error
 *
 * @param {Error} error - Error
 *
 * @returns {Object} serializable error object
 */
function toSerializableError(error) {
  return {
    cause: error.cause instanceof Error ?
      toSerializableError(error.cause) :
      error.cause,
    message: error.message,
    name: error.name,
    stack: error.stack
  };
}

;// ./src/content/main/snippets.entry.js
/*
 * This file is part of eyeo's Web Extension Ad Blocking Toolkit (EWE),
 * Copyright (C) 2006-present eyeo GmbH
 *
 * EWE is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3 as
 * published by the Free Software Foundation.
 *
 * EWE is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with EWE.  If not, see <http://www.gnu.org/licenses/>.
 */









// Use chrome.storage to detect if we're in an isolated world.
// Note: chrome.runtime is unreliable since other extensions may expose it
// in the main world.
const isMainWorld = !(
  (typeof chrome === "object" && !!chrome.storage) ||
  (typeof browser === "object" && !!browser.storage)
);

const nativeDispatch = document.dispatchEvent.bind(document);

// Get or create a unique channel name for communicating with the isolated world
const commsChannelName = claimCommsChannel(esm_browser_v4());

// Creates a sendSnippetHitEvent function that dispatches hit events back to
// the isolated world via the comms channel. The isolated-world listener
// receives, validates, and forwards the event to the telemetry pipeline.
const createMainWorldHitEventSender = (commsChannel, dispatch) => {
  const dispatchFn = dispatch || document.dispatchEvent.bind(document);
  return function sendSnippetHitEvent(filter, domain) {
    try {
      dispatchFn(new CustomEvent(commsChannel, {
        detail: {
          type: "ewe:snippet-hit",
          filter,
          domain
        }
      }));
    }
    catch (e) {
      // telemetry must never break snippet execution
    }
  };
};

const runStorageShim = (shimFn, configKey) => {
  try {
    if (typeof shimFn === "function" && configKey) {
      shimFn(configKey);
    }
  }
  catch (err) {
    // It would be good to report this error to Sentry, but we don't currently
    // have a way to do that from the main world.
  }
};

const runSnippets = snippetsConfig => {
  const {callback, filters, env, commsChannel, serializeError,
    dispatchFn} = snippetsConfig;

  if (filters.length) {
    try {
      callback(env, ...filters);
    }
    catch (e) {
      // It would be good to report this error to Sentry, but we don't currently
      // have a way to do that from the main world.
      const errorEvent = new CustomEvent(commsChannel, {
        detail: {
          type: "ewe:main-error",
          error: serializeError(e)
        }
      });
      dispatchFn(errorEvent);
    }
  }
};

const createTrustedScriptPolicy = () => {
  const isTrustedTypesSupported = typeof trustedTypes !== "undefined";
  let policy = null;

  try {
    if (isTrustedTypesSupported) {
      policy = trustedTypes.createPolicy(esm_browser_v4(), {
        createScript: code => code,
        createScriptURL: url => url
      });
    }
  }
  catch (_) {
  }
  return policy;
};

const injectScript = (executable, policy) => {
  const script = document.createElement("script");
  script.type = "application/javascript";
  script.async = false;

  if (policy) {
    script.textContent = policy.createScript(executable);
  }
  else {
    script.textContent = executable;
  }

  try {
    document.documentElement.appendChild(script);
  }
  catch (_) {}
  document.documentElement.removeChild(script);
};

const appendSnippets = snippetsConfig => {
  const policy = createTrustedScriptPolicy();
  const {
    callback,
    filters,
    env,
    shimFn,
    shimConfigKey,
    commsChannel,
    serializeError
  } = snippetsConfig;

  const snippetsCode = filters.length ? `
    const callback = (${callback});
    const runSnippets = (${runSnippets});
    const serializeError = (${serializeError});
    const createHitSender = (${createMainWorldHitEventSender});
    const env = ${JSON.stringify(env)};
    env.sendSnippetHitEvent = createHitSender(
      "${commsChannel}", null
    );
    const snippetsConfig = {
      callback,
      env,
      filters: ${JSON.stringify(filters)},
      commsChannel: "${commsChannel}",
      serializeError,
      dispatchFn: document.dispatchEvent.bind(document)
    };
    runSnippets(snippetsConfig);
  ` : "";

  const code = `(function () {
    const shimFn = (${shimFn});
    const shimConfigKey = "${shimConfigKey}";
    const runStorageShim = (${runStorageShim});
    runStorageShim(shimFn, shimConfigKey);
    ${snippetsCode}
  })();`;

  injectScript(code, policy);
};

const onFiltersReceived = event => {
  if (!event || !event.detail) {
    return;
  }

  const {type, filters, debug} = event.detail;

  // ignore other events that are not related to filters config
  if (type !== "ewe:filters-config") {
    return;
  }

  // Check which snippets need to be executed in the main world.
  const mainSnippets = [];
  for (const filter of filters) {
    for (const [name, ...args] of filter) {
      if (main.has(name)) {
        mainSnippets.push([name, ...args]);
      }
    }
  }

  // sendDetectionEvent is intentionally not included in the main world env.
  // Detection events rely on ServerLogger and Sentry, which require extension
  // API access only available in the isolated world. See snippet-events.js.
  const snippetsConfig = {
    callback: main,
    env: {
      debugCSSProperties: debug ? DEBUG_CSS_PROPERTIES : null,
      sendSnippetHitEvent: createMainWorldHitEventSender(
        commsChannelName, isMainWorld ? nativeDispatch : null
      )
    },
    filters: mainSnippets,
    shimFn: shimStorage,
    shimConfigKey: CACHED_FILTERS_CONFIG_KEY,
    commsChannel: commsChannelName,
    serializeError: toSerializableError,
    dispatchFn: nativeDispatch
  };

  // If this script is injected into the main world we can execute directly.
  // If we are on isolated world (MV2), we need to create an inline script to
  // inject the snippets into page context.
  if (isMainWorld) {
    runStorageShim(shimStorage, CACHED_FILTERS_CONFIG_KEY);
    runSnippets(snippetsConfig);
  }
  else {
    appendSnippets(snippetsConfig);
  }
};

document.addEventListener(commsChannelName, onFiltersReceived);
document.dispatchEvent(new CustomEvent(HANDSHAKE_EVENT_NAME));

/******/ })()
;
