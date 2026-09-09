(()=>{function je(f){let o=String(f||"").match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!o)throw new TypeError(`Invalid calendar date: ${f}`);return new Date(Date.UTC(Number(o[1]),Number(o[2])-1,Number(o[3])))}function cn(f){return f.toISOString().slice(0,10)}function un(f,o){let g=je(f);return g.setUTCDate(g.getUTCDate()+Number(o||0)),cn(g)}function dn(f,o){let g=je(o).getTime()-je(f).getTime();return Math.max(0,Math.ceil(g/864e5))}function fn(f,o){let g=je(f);return g.setUTCMonth(g.getUTCMonth()+Number(o||0)),cn(g)}var pn=/영화제|페스티벌|프라이드시네마|KQFF/i,Qr=/^(?:영화제|페스티벌|영화제\s*(?:상영|프로그램)|페스티벌\s*(?:상영|프로그램))$/i,Wr=/^(?:일반|상영시간표|날짜별\s*시간표|작품별\s*상영일정|영화제|페스티벌|프로그램|상영|2D(?:[-\s]?(?:영화제|페스티벌))?)$/i,Xr=new Set(["program-card","program-window","session-program","session-title","preserved","venue-fallback"]);function q(f){return String(f||"").replace(/\s+/g," ").trim()}function nt(f){return q(f).replace(/\((?:확장판|감독판|디지털|자막|영문자막|무삭제판|리마스터링|4K|2D|3D|더빙)[^)]*\)/gi,"").replace(/[“”‘’"']/g,"").trim()}function mn(f){return nt(f).toLocaleLowerCase("ko").replace(/[\s:：·,./\\_-]+/g,"")}function tt(f,o,g){return`${String(f).padStart(4,"0")}-${String(o).padStart(2,"0")}-${String(g).padStart(2,"0")}`}function ea(f){let o=Array.isArray(f?.dates)?f.dates.filter($=>/^\d{4}-\d{2}-\d{2}$/.test(String($))).sort():[];if(o.length)return{start:o[0],end:o[o.length-1]};let g=q(f?.period).replace(/[년월]/g,".").replace(/일/g,""),v=g.match(/(20\d{2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})\s*(?:[-~–—]|부터|to)\s*(?:(20\d{2})\s*[.\-/]\s*)?(?:(\d{1,2})\s*[.\-/]\s*)?(\d{1,2})/i);if(v){let $=Number(v[1]),L=Number(v[2]),U=Number(v[4]||$),de=Number(v[5]||L);return{start:tt($,L,v[3]),end:tt(U,de,v[6])}}let y=g.match(/(20\d{2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})/);if(!y)return null;let b=tt(y[1],y[2],y[3]);return{start:b,end:b}}function ta(f){if(!f?.start||!f?.end)return Number.POSITIVE_INFINITY;let o=Date.parse(`${f.start}T00:00:00Z`),g=Date.parse(`${f.end}T00:00:00Z`);return!Number.isFinite(o)||!Number.isFinite(g)?Number.POSITIVE_INFINITY:Math.max(0,Math.round((g-o)/864e5))}function na(f,o){let g=nt(o?.title),v=Array.isArray(f?.movies)?f.movies.map(nt).filter(Boolean):[],y=!!(g&&v.includes(g)),b=mn(g),$=!!(!y&&b&&v.some(K=>{let se=mn(K);return se.length>=4&&(b.includes(se)||se.includes(b))})),L=q([o?.title,o?.program,rt(o),...o?.tags||[]].filter(Boolean).join(" ")),U=V(f?.title),fe=U.replace(/제?\s*\d+\s*회/gi," ").replace(/영화제|페스티벌|국제/gi," ").split(/[\s:·,.'‘’"()[\]\-]+/).filter(K=>K.length>=2&&!/^(?:서울|영화|상영|프로그램)$/i.test(K)).filter(K=>L.includes(K)).length,me=!!(U&&q(L).replace(/\s+/g,"").includes(U.replace(/\s+/g,"")));return{score:Number(y)*1e3+Number($)*800+Number(me)*500+fe*20,exactMovieMatch:y,containedMovieMatch:$,directNameMatch:me,tokenHits:fe}}function rt(f){return!f?.festivalName||Xr.has(f?.festivalNameSource)?"":f.festivalName}function ra(f,{includeGeneratedName:o=!1}={}){let g=o?f?.festivalName:rt(f);return pn.test(q([f?.program,g,f?.eventName,...f?.tags||[]].filter(Boolean).join(" ")))}function aa(f,o){let g=(Array.isArray(o)?o:[]).filter(b=>ae(b?.title)).filter(b=>!b?.venueId||!f?.venueId||b.venueId===f.venueId).map(b=>{let $=ea(b);return $&&f?.date&&(f.date<$.start||f.date>$.end)?null:{program:b,match:na(b,f),range:$,span:ta($)}}).filter(Boolean),v=g.filter(b=>b.match.score>0).sort((b,$)=>$.match.score-b.match.score||b.span-$.span||String(b.program.title).localeCompare(String($.program.title),"ko"));if(v.length){let[b,$]=v;if(!$||b.match.score>$.match.score||b.match.score===$.match.score&&b.span<$.span)return{...b,source:"program-card",confidence:"high"}}let y=g.filter(b=>b.range);return De(f)&&y.length===1?{...y[0],source:"program-window",confidence:"medium"}:null}function V(f){return q(f).replace(/^2D-?/,"").replace(/^#+/,"").replace(/\([^)]*\)/g,"").replace(/^\d{1,2}\s*월\s*\d{1,2}\s*일?\s*/i,"").replace(/^\d{1,2}\s*[.\-/]\s*\d{1,2}(?:\s*[월화수목금토일])?\s*/i,"").replace(/^\d+\s*회\s+(?=.{0,40}(?:영화제|페스티벌))/i,"").replace(/\s*[|｜]\s*[^|｜]+$/g,"").replace(/^(.*?(?:영화제|페스티벌))\s*['"‘’“”]([^'"‘’“”]+)['"‘’“”]\s*$/i,"$1: $2").replace(/\s+/g," ").trim()}function ae(f){let o=V(f);return pn.test(o)&&!Qr.test(o)}function gn(f){let o=V(f);return!o||Wr.test(o)}function De(f){return f?.kind==="festival"?!0:ra(f,{includeGeneratedName:!0})}function sa(f){let o=q(f);if(!o)return"";if(/\bKQFF\b/i.test(o))return"KQFF";let g=o.match(/제\s*\d+\s*회\s*[A-Za-z0-9가-힣·'‘’:\s-]{1,48}?(?:영화제|페스티벌)(?![가-힣])/i);if(g)return V(g[0]);let v=o.match(/(?:^|[\s:|｜<〈>〉"'‘’“”()[\]-])((?:\d+\s*회\s*)?[A-Za-z0-9가-힣·'‘’:-]{2,}(?:\s+[A-Za-z0-9가-힣·'‘’:-]{1,20}){0,5}\s*(?:영화제|페스티벌))(?![가-힣])/i),y=V(v?.[1]||"");return ae(y)?y:""}function ia({session:f,programs:o,venueName:g="\uC0C1\uC601\uAD00"}){let v=[rt(f),f?.eventName].map(V).find(ae);if(ae(v))return{name:v,source:"source-field",confidence:"high",programId:f?.festivalProgramId||""};let y=aa(f,o);if(y)return{name:V(y.program.title),source:y.source,confidence:y.confidence,programId:y.program.id||""};let b=V(f?.program);if(ae(b))return{name:b,source:"session-program",confidence:"high",programId:""};let $=sa(f?.title);if($)return{name:$,source:"session-title",confidence:"medium",programId:""};let L=V(f?.festivalName);return ae(L)?{name:L,source:"preserved",confidence:"low",programId:f?.festivalProgramId||""}:{name:`${q(g)||"\uC0C1\uC601\uAD00"} \uC601\uD654\uC81C \uC0C1\uC601`,source:"venue-fallback",confidence:"low",programId:""}}function bn(f){return ia(f).name}var oa=new Set(["a.ltrbxd.com","api.dtryx.com","arthousemomo.co.kr","blog.kakaocdn.net","cdn.imweb.me","cine.arirang.go.kr","dmzdocs.com","forms.gle","i1.daumcdn.net","img.dtryx.com","img1.daumcdn.net","indiespace.kr","kucinema.net","laikacinema.com","litt.ly","map.naver.com","mjff.or.kr","moviee.co.kr","movieland.co","scinema.org","seff.kr","siff.kr","upload.wikimedia.org","www.arthousemomo.co.kr","www.bifan.kr","www.biff.kr","www.cinecube.co.kr","www.cinematheque.seoul.kr","www.dtryx.com","www.emuartspace.com","www.filmforum.kr","www.jeonjufest.kr","www.koreafilm.or.kr","www.sangsangmadang.com","www.siwff.or.kr","www.tinyticket.net","www.youtube.com"]),la=new Set(["www.emuartspace.com","www.filmforum.kr"]),ca=new Set(["api.dtryx.com:30443","cine.arirang.go.kr:8443"]);function hn(f,o="#"){let g=String(f||"").trim();if(!g)return o;if(/^#[A-Za-z][A-Za-z0-9:_-]*$/.test(g))return g;if(!/^https?:\/\//i.test(g))return o;try{let v=new URL(g),y=v.hostname.toLowerCase(),b=`${y}:${v.port}`;return v.username||v.password||v.port&&!ca.has(b)||!oa.has(y)?o:v.protocol==="https:"||v.protocol==="http:"&&la.has(y)?v.href:o}catch{return o}}function ua(f){let o=String(f?.date||"").trim(),g=String(f?.timeSort||f?.time||"").match(/\b\d{1,2}:\d{2}\b/)?.[0]||"";if(!/^\d{4}-\d{2}-\d{2}$/.test(o)||!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(g))return null;let[v,y,b]=o.split("-").map(Number),$=new Date(Date.UTC(v,y-1,b));if($.getUTCFullYear()!==v||$.getUTCMonth()!==y-1||$.getUTCDate()!==b)return null;let L=Date.parse(`${o}T${g}:00+09:00`);return Number.isFinite(L)?L:null}function vn(f,o=Date.now()){let g=ua(f);return g==null?!1:g<o}(function(){if(new Set(["seoulcinemaschedule.com","www.seoulcinemaschedule.com"]).has(window.location.hostname)&&navigator.doNotTrack!=="1"){window.dataLayer=window.dataLayer||[],window.gtag=function(){window.dataLayer.push(arguments)},window.gtag("js",new Date),window.gtag("config","G-GQNT88MLH4");let e=document.createElement("script");e.async=!0,e.src="https://www.googletagmanager.com/gtag/js?id=G-GQNT88MLH4",document.head.append(e)}let o={data:null,query:"",date:null,linkFilter:"all",venueFilter:"all",favoriteVenueIds:new Set,hashSyncKey:"",dataRefreshing:!1,dataSignature:"",lastDataRefreshAt:0,currentKstDate:"",lastRenderedMobileLayout:null,view:"today",communityTrends:null},g="cineSeoulFavoriteVenues",v=600*1e3,y=60*1e3,b=["\uC77C","\uC6D4","\uD654","\uC218","\uBAA9","\uAE08","\uD1A0"],$=["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"],L={talk:"GV\xB7\uD1A0\uD06C",festival:"\uC601\uD654\uC81C",program:"\uAE30\uD68D\uC804",package:"\uAD7F\uC988",special:"\uD2B9\uBCC4\uC0C1\uC601"},U={confirmed:"\uD655\uC815","needs-check":"\uD655\uC778 \uD544\uC694",soldout:"\uB9E4\uC9C4"},de={kofa:"\uC11C\uC6B8 \uB9C8\uD3EC\uAD6C \uC6D4\uB4DC\uCEF5\uBD81\uB85C 400 \uD55C\uAD6D\uC601\uC0C1\uC790\uB8CC\uC6D0",sac:"\uC11C\uC6B8 \uC911\uAD6C \uC815\uB3D9\uAE38 3 \uACBD\uD5A5\uC544\uD2B8\uD790 2\uCE35",laika:"\uC11C\uC6B8 \uC11C\uB300\uBB38\uAD6C \uC5F0\uD76C\uB85C8\uAE38 18 \uC2A4\uD398\uC774\uC2A4\uB3C5 1\uCE35",indiespace:"\uC11C\uC6B8 \uB9C8\uD3EC\uAD6C \uC591\uD654\uB85C 176 \uC640\uC774\uC988\uD30C\uD06C 8\uCE35",momo:"\uC11C\uC6B8 \uC11C\uB300\uBB38\uAD6C \uC774\uD654\uC5EC\uB300\uAE38 52 ECC B402",cinecube:"\uC11C\uC6B8 \uC885\uB85C\uAD6C \uC0C8\uBB38\uC548\uB85C 68 \uD765\uAD6D\uC0DD\uBA85\uBE4C\uB529 B2",emu:"\uC11C\uC6B8 \uC885\uB85C\uAD6C \uACBD\uD76C\uAD811\uAC00\uAE38 7",forest:"\uC11C\uC6B8 \uB178\uC6D0\uAD6C \uB178\uD574\uB85C 480 \uC870\uAD11\uBE4C\uB529 \uC9C0\uD5581\uCE35",arirang:"\uC11C\uC6B8 \uC131\uBD81\uAD6C \uC544\uB9AC\uB791\uB85C 82 \uC544\uB9AC\uB791\uC2DC\uB124\uC13C\uD130",filmforum:"\uC11C\uC6B8 \uC11C\uB300\uBB38\uAD6C \uC131\uC0B0\uB85C 527 \uD558\uB2AC\uC194\uBE4C\uB529 A\uB3D9 \uC9C0\uD5581\uCE35",sangsangmadang:"\uC11C\uC6B8 \uB9C8\uD3EC\uAD6C \uC5B4\uC6B8\uB9C8\uB2F9\uB85C 65 KT&G \uC0C1\uC0C1\uB9C8\uB2F9 B4",movieland:"\uC11C\uC6B8\uD2B9\uBCC4\uC2DC \uC131\uB3D9\uAD6C \uC5F0\uBB34\uC7A5\uAE38 5-5",artnine:"\uC11C\uC6B8 \uB3D9\uC791\uAD6C \uB3D9\uC791\uB300\uB85C 89 \uACE8\uB4E0\uC2DC\uB124\uB9C8\uD0C0\uC6CC 12\uCE35",kucine:"\uC11C\uC6B8 \uAD11\uC9C4\uAD6C \uB2A5\uB3D9\uB85C 120 \uAC74\uAD6D\uB300\uD559\uAD50 \uC608\uC220\uB514\uC790\uC778\uB300\uD559 B108",heyri:"\uACBD\uAE30 \uD30C\uC8FC\uC2DC \uD0C4\uD604\uBA74 \uD5E4\uC774\uB9AC\uB9C8\uC744\uAE38 93-119"},fe={kofa:"\uC77C\xB7\uC6D4 \uD734\uBB34",sac:"\uC6D4 \uD734\uBB34",laika:"\uC5F0\uC911\uBB34\uD734",indiespace:"\uC5F0\uC911\uBB34\uD734",momo:"\uC5F0\uC911\uBB34\uD734",cinecube:"\uC5F0\uC911\uBB34\uD734",emu:"\uC5F0\uC911\uBB34\uD734",forest:"\uC5F0\uC911\uBB34\uD734",arirang:"2\xB74\uC8FC \uC6D4 \uD734\uBB34",filmforum:"\uC5F0\uC911\uBB34\uD734",sangsangmadang:"\uC6D4 \uD734\uBB34",movieland:"\uC6D4\xB7\uD654\xB7\uC218 \uD734\uBB34",artnine:"\uC5F0\uC911\uBB34\uD734",kucine:"\uC6D4 \uD734\uBB34",heyri:"\uC0C1\uC601\uC77C \uC6B4\uC601"},me={kofa:"assets/venue-marks/kofa.png",sac:"assets/venue-marks/sac.png",laika:"assets/venue-marks/laika.png",indiespace:"assets/venue-marks/indiespace.png",momo:"assets/venue-marks/momo.png",cinecube:"assets/venue-marks/cinecube.png",emu:"assets/venue-marks/emu.png",forest:"assets/venue-marks/forest.jpg",arirang:"assets/venue-marks/arirang.png",filmforum:"assets/venue-marks/filmforum.png",sangsangmadang:"assets/venue-marks/sangsangmadang.svg",artnine:"assets/venue-marks/artnine.png",kucine:"assets/venue-marks/kucine.jpg",movieland:"assets/venue-marks/movieland.png",heyri:"assets/venue-marks/heyri.svg"},K={kofa:"KOFA",sac:"SAC",laika:"LAIKA",indiespace:"INDIE",momo:"MOMO",cinecube:"C",emu:"EMU",forest:"THE SOOP",arirang:"ARIRANG",filmforum:"FILM FORUM",sangsangmadang:"KT&G",artnine:"ARTNINE",kucine:"KU",movieland:"MOVIE LAND",heyri:"HEYRI"},se=new Set(["artnine","cinecube","emu","filmforum"]),Ae={"p-sac-rossellini":"https://www.cinematheque.seoul.kr/data/file/program/thumb-cd350d699bb6addbeff893b0d2cf9159_5IpMwGuj_ebb50b412a6aa0d39ee6fb254d9d31640c68de5f_400x300.jpg","p-sac-wiseman":"https://www.cinematheque.seoul.kr/data/file/program/thumb-cd350d699bb6addbeff893b0d2cf9159_8S1EGAHr_98b3e011c1e80809f8b95c0286931b524d7ee6a5_400x300.jpg","p-laika-park":"https://cdn.imweb.me/thumbnail/20260525/4f0422dc8398c.png","p-momo-trier":"https://arthousemomo.co.kr/data/editor/2606/thumb-ca88447528637a04e78b194f07b294a5_1781065501_9701_250x180.jpg","p-indie-pride":"https://i1.daumcdn.net/thumb/C230x300/?fname=https%3A%2F%2Fblog.kakaocdn.net%2Fdna%2FPvkcO%2FdJMcagePITM%2FAAAAAAAAAAAAAAAAAAAAAC8fm7sNowgy1L75yKw-9tQ9tw6jVU1oVJmFYmGNnJtE%2Fimg.jpg%3Fcredential%3DyqXZFxpELC7KVnFOS48ylbz2pIh7yKj8%26expires%3D1782831599%26allow_ip%3D%26allow_referer%3D%26signature%3D27VGngaxo1A88f2L17bYMpv%252FEUo%253D"},m=e=>document.querySelector(e),Fe="/assets/lucide-sprite.svg";function Ne(e,t=""){return`<svg class="ui-icon ${t}" aria-hidden="true"><use href="${Fe}#${e}"></use></svg>`}function l(e){return String(e??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;")}function M(e,t="#"){return hn(e,t)}function pe(e,t="#"){return l(M(e,t))}function Be(e){let t=String(e||"").trim();if(/^\/assets\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.(?:png|jpe?g|svg|webp|gif)$/i.test(t))return t;let n=M(t,"");return n.startsWith("https://")?n:""}function xn(e){try{return decodeURIComponent(e)}catch{return""}}function Q(e){return M(e?.url,"")}function $n(){try{let e=JSON.parse(localStorage.getItem(g)||"[]");return new Set(Array.isArray(e)?e.filter(Boolean):[])}catch{return new Set}}function at(){try{localStorage.setItem(g,JSON.stringify([...o.favoriteVenueIds]))}catch{}}function E(e){return o.favoriteVenueIds.has(String(e||""))}function Ue(e){let[t=""]=Array.from(String(e?.name||"").trim()),n=t.codePointAt(0)||0;return n>=44032&&n<=55203||n>=12593&&n<=12686?0:n>=65&&n<=90||n>=97&&n<=122?1:2}function yn(e,t){let n=Ue(e)-Ue(t);if(n)return n;let r=Ue(e)===1?"en":"ko";return String(e?.name||"").localeCompare(String(t?.name||""),r,{numeric:!0,sensitivity:"base"})||String(e?.id||"").localeCompare(String(t?.id||""),"en")}function wn(e,t){let n=+!E(e?.id)-+!E(t?.id);return n||yn(e,t)}function kn(e){return[...e].sort(wn)}function Sn(e,t){return kn(e).map(t)}function Ee(e,t,n=""){if(!e||e==="all")return"";let r=E(e),a=`${t||"\uC0C1\uC601\uAD00"} \uC990\uACA8\uCC3E\uAE30 ${r?"\uD574\uC81C":"\uCD94\uAC00"}`;return`
      <button class="inline-flex shrink-0 items-center justify-center rounded-full bg-transparent transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 ${r?"text-primary":"text-on-surface-variant hover:text-primary"} ${n}" type="button" data-favorite-venue="${l(e)}" aria-pressed="${r}" aria-label="${l(a)}" title="${l(a)}">
        ${Ne(r?"star-fill":"star")}
      </button>
    `}function Ln(e,t=!1){return e==="sac"?t?"max-h-8 max-w-[118px]":"max-h-10 max-w-[160px]":se.has(e)?t?"max-h-9 max-w-[54px]":"max-h-10 max-w-[70px]":t?"max-h-7 max-w-[86px]":"max-h-8 max-w-[126px]"}function st(e,t=!1){if(e.id==="all")return`
        <span class="flex ${t?"h-8 w-8":"h-10 w-10"} items-center justify-center border border-primary/10 bg-primary text-surface">
          ${Ne("film",t?"ui-icon-sm":"")}
        </span>
      `;let n=me[e.id],r=K[e.id]||e.name||"\uC0C1\uC601\uAD00",a=Ln(e.id,t);return n?`
      <img class="${a} object-contain" src="${l(n)}" alt="${l(e.name)} \uB85C\uACE0" width="${t?86:126}" height="${t?28:40}" loading="lazy" decoding="async" />
    `:`
        <span class="flex ${t?"h-7 min-w-7 px-1 text-[10px]":"h-10 min-w-10 px-2 text-[11px]"} items-center justify-center border border-primary/10 font-bold tracking-normal text-primary">
          ${l(r)}
        </span>
      `}function Tn(e){let t=String(e||"");if(!t||t==="all")return;let r=k()[t]?.name||"\uC0C1\uC601\uAD00";if(o.favoriteVenueIds.has(t)){o.favoriteVenueIds.delete(t),at(),D(),Me(`${r} \uC990\uACA8\uCC3E\uAE30\uB97C \uD574\uC81C\uD588\uC2B5\uB2C8\uB2E4.`);return}o.favoriteVenueIds.add(t),at(),D(),Me(`${r} \uC990\uACA8\uCC3E\uAE30\uC5D0 \uCD94\uAC00\uD588\uC2B5\uB2C8\uB2E4.`)}let ge=null,it=null;function k(){let e=o.data?.venues||[];return it===e&&ge||(it=e,ge=Object.fromEntries(e.map(t=>[t.id,t]))),ge}function Re(e){return e?.address||de[e?.id]||e?.area||"\uC11C\uC6B8"}function Mn(e){let t=Re(e);return`https://map.naver.com/p/search/${encodeURIComponent(t)}`}function Pe(e,t="\uC0C1\uC601\uC77C \uC6B4\uC601 | \uC11C\uC6B8",n=!1){if(!e)return l(t);let r=fe[e.id]||"\uC0C1\uC601\uC77C \uC6B4\uC601",a=Re(e),s=e.name||"\uC0C1\uC601\uAD00";return`
      <span>
        ${l(r)} |
        <a class="text-on-surface-variant underline decoration-primary/20 underline-offset-2 transition-colors hover:text-primary hover:decoration-primary" href="${pe(Mn(e))}" target="_blank" rel="noopener noreferrer" aria-label="${l(`${a} \xB7 ${s} \uB124\uC774\uBC84 \uC9C0\uB3C4 \uC5F4\uAE30`)}" title="\uB124\uC774\uBC84\uB9F5\uC5D0\uC11C \uC8FC\uC18C \uBCF4\uAE30">${l(a)}</a>
      </span>
    `}function N(e){return new Date(`${e}T00:00:00`)}function ot(e=o.data?.sessions||[]){return[...new Set(e.map(t=>t.date).filter(Boolean))].sort()}function G(){return(o.data?.sessions||[]).filter(e=>!ee(e))}function C(e=new Date){let t=new Intl.DateTimeFormat("en",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(e),n=Object.fromEntries(t.map(r=>[r.type,r.value]));return`${n.year}-${n.month}-${n.day}`}function lt(e,t,n){let r=Number(e),a=Number(t),s=Number(n);return!r||!a||!s?"":`${String(r).padStart(4,"0")}-${String(a).padStart(2,"0")}-${String(s).padStart(2,"0")}`}function ct(e,t){return un(e,t)}function Cn(e,t){return dn(e,t)}function In(e,t){return fn(e,t)}function jn(e,t){if(!e&&!t)return"";let n=N(e),r=`${n.getFullYear()}.${String(n.getMonth()+1).padStart(2,"0")}.${String(n.getDate()).padStart(2,"0")}`;if(!t||e===t)return r;let a=N(t),s=`${String(a.getMonth()+1).padStart(2,"0")}.${String(a.getDate()).padStart(2,"0")}`;return`${r} - ${s}`}function Ve(e,t=[]){let n=T(t).filter(Boolean).sort(),r=String(e||""),a=Number(C().slice(0,4)),s=[],i=/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/g,c=r.replace(i,(u,h,w,p)=>(a=Number(h)||a,s.push(lt(h,w,p))," "));for(let u of c.matchAll(/(^|[^\d])(\d{1,2})[.\/](\d{1,2})(?!\d)/g))s.push(lt(a,u[2],u[3]));let d=T([...s,...n]).filter(Boolean).sort();return d.length?{start:d[0],end:d[d.length-1]}:null}function ie(e){if(!e?.start||!e?.end)return null;let t=C();if(e.end<t)return{expired:!0};if(e.start>t){let r=Cn(t,e.start);return{label:`D-${r}`,tone:"upcoming",expired:!1,daysLeft:r}}let n=ct(t,3);return e.end<=n?{label:"\uACE7 \uC885\uB8CC",tone:"ending",expired:!1}:{label:"\uC9C4\uD589 \uC911",tone:"active",expired:!1}}function ut(e){let t=e?.sessions||[],n=e?.programs||[],r=t[t.length-1]||{};return[e?.meta?.lastVerifiedAt||"",e?.meta?.generatedAt||"",e?.meta?.seatStatusVerifiedAt||"",t.length,t[0]?.id||"",r.id||"",n.length].join("|")}function dt(e,t={}){o.data=e,o.dataSignature=ut(e),o.currentKstDate=C(),o.lastDataRefreshAt=Date.now(),t.resetDate&&(o.date=null),Ke()}function ft(){let e=be(),t=C();return e.includes(t)?t:e[0]||t}function mt(e){return!!e&&e<C()}function be(){let e=ot(G());if(e.length)return e;let t=ot(),n=C(),r=t.filter(a=>a>=n);return r.length?r:t}function Ke(){if(!o.date)return;let e=new Set(be());(mt(o.date)||!e.has(o.date))&&(o.date=null)}function H(){let e=o.date&&!mt(o.date)?o.date:null;return o.view==="today"?e||ft():e}function pt(e={}){if(!o.data)return!1;let t=C();return o.currentKstDate===t?!1:(o.currentKstDate=t,Ke(),D(),e.refreshData&&Ce({force:!0}),!0)}function Dn(e){return e===C()}function oe(e){if(!e)return"\uB0A0\uC9DC \uD655\uC778";let t=N(e);if(Number.isNaN(t.getTime()))return"\uB0A0\uC9DC \uD655\uC778";let n=String(t.getMonth()+1).padStart(2,"0"),r=String(t.getDate()).padStart(2,"0");return`${n}.${r} ${b[t.getDay()]}`}function An(e){let t=new Date(e||"");return Number.isNaN(t.getTime())?"":new Intl.DateTimeFormat("ko-KR",{timeZone:"Asia/Seoul",month:"long",day:"numeric",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(t)}function gt(e){return N(e).getDay()===0}function Fn(e,t="text-primary"){return gt(e)?"text-error":t}function da(){return O(o.data?.sources||[],e=>e.venueId||"unknown")}function Nn(){return Object.fromEntries((o.data?.sources||[]).map(e=>[e.id,e]))}function Bn(){let e=be(),t=o.data?.meta?.rangeLabel||"\uC0C1\uC601 \uC77C\uC815 \uD655\uC778 \uC911";if(e.length){let a=N(e[0]),s=N(e[e.length-1]);t=a.getMonth()===s.getMonth()?`${a.getFullYear()}\uB144 ${a.getMonth()+1}\uC6D4`:`${a.getFullYear()}\uB144 ${a.getMonth()+1}\uC6D4 - ${s.getMonth()+1}\uC6D4`}m("#desktopScheduleTitle").textContent="\uC0C1\uC601\uC2DC\uAC04\uD45C",m("#desktopMonth").textContent=t;let n=m("#desktopDataStatus");if(n){let a=An(o.data?.meta?.lastVerifiedAt||o.data?.meta?.generatedAt),s=(o.data?.venues||[]).length;n.textContent=a?`${a} \uAE30\uC900, ${s}\uAC1C \uC0C1\uC601\uAD00`:`${s}\uAC1C \uC0C1\uC601\uAD00`}let r=m("#mobileScheduleHeading");if(r){let a=o.linkFilter==="all"?"":`${X({bookingType:o.linkFilter})} `;o.view==="film"?r.textContent="\uC601\uD654\uBCC4 \uC0C1\uC601":o.view==="venue"?r.textContent="\uC0C1\uC601\uAD00\uBCC4 \uC2DC\uAC04\uD45C":r.textContent=`${a}\uC0C1\uC601\uC2DC\uAC04\uD45C`}}function bt(e,t,n){if(!n)return!0;let r=t[e.venueId];return[e.title,e.program,e.summary,e.screen,r?.name,r?.area,...e.tags||[]].join(" ").toLowerCase().includes(n)}function ht(e={}){let t=e.includeLinkFilter??!0,n=e.includeVenueFilter??!0,r=e.includeDate??!0,a=k(),s=o.query.trim().toLowerCase(),i=r?H():null;return(o.data?.sessions||[]).filter(c=>!i||c.date===i).filter(c=>!ee(c)).filter(c=>!t||o.linkFilter==="all"||c.bookingType===o.linkFilter).filter(c=>!n||o.venueFilter==="all"||c.venueId===o.venueFilter).filter(c=>bt(c,a,s)).sort((c,d)=>`${c.date} ${c.timeSort||c.time}`.localeCompare(`${d.date} ${d.timeSort||d.time}`))}function O(e,t){return e.reduce((n,r)=>{let a=t(r);return n[a]||=[],n[a].push(r),n},{})}function vt(e,t){return e.reduce((n,r)=>{let a=t(r);return n[a]=(n[a]||0)+1,n},{})}function z(e){let t=e?.posterUrl||e?.thumbnailUrl||e?.imageUrl||"";return/placeholder_image/i.test(t)?"":t}function xt(e){return String(e||"").replace(/\.small\.jpg(?=$|[?#])/i,".thumb.jpg")}function $t(e,t,n="\uC11C\uC6B8\uB3C5\uB9BD\uC601\uD654\uAD00\uC2DC\uAC04\uD45C"){return`
      <div class="${t} poster-fallback">
        ${n?`<span>${l(n)}</span>`:""}
        <strong>${l(e)}</strong>
      </div>
    `}function He(e,t,n,r="\uC11C\uC6B8\uB3C5\uB9BD\uC601\uD654\uAD00\uC2DC\uAC04\uD45C",a={}){let s=Be(z(e));if(s){let i=xt(s),c=!!a.priority,d=xt(Be(e?.posterSourceUrl||"")),u=i!==s?s:d&&d!==i?d:"",h=u?` data-poster-fallback-src="${l(u)}"`:"";return`<img alt="${l(t)}" class="${n}" src="${l(i)}" width="400" height="600" loading="${c?"eager":"lazy"}" decoding="async" ${c?'fetchpriority="high"':""} referrerpolicy="no-referrer" data-poster-title="${l(t)}" data-poster-kicker="${l(r)}"${h} />`}return $t(t,n,r)}function _e(e){if(!e||e.dataset.posterReplaced)return;let t=Be(e.dataset.posterFallbackSrc||"");if(t&&!e.dataset.posterFallbackTried){e.dataset.posterFallbackTried="true",e.addEventListener("error",()=>_e(e),{once:!0}),e.src=t;return}e.dataset.posterReplaced="true";let n=e.dataset.posterTitle||e.alt||"\uC11C\uC6B8\uB3C5\uB9BD\uC601\uD654\uAD00\uC2DC\uAC04\uD45C",r=e.dataset.posterKicker??"\uC11C\uC6B8\uB3C5\uB9BD\uC601\uD654\uAD00\uC2DC\uAC04\uD45C",a=document.createElement("div");a.innerHTML=$t(n,e.className,r).trim(),e.replaceWith(a.firstElementChild)}function Un(){document.querySelectorAll("img[data-poster-title]").forEach(e=>{e.addEventListener("error",()=>_e(e),{once:!0}),e.complete&&e.naturalWidth===0&&_e(e)})}function En(e){return[e.rating,e.program,e.summary,...e.tags||[]].filter(Boolean).join(" ")}function Rn(e){let t=En(e);return/청소년\s*관람\s*불가|청불|19\s*세|18\s*세/.test(t)?"19":/15\s*세/.test(t)?"15":/12\s*세/.test(t)?"12":/전체\s*관람가|ALL\s*세|\bALL\b/i.test(t)?"ALL":""}function le(e){return e.kind==="festival"?"FEST":e.kind==="talk"||(e.tags||[]).some(t=>/감독|GV|관객과의\s*대화/.test(t))?"GV":Rn(e)||"INFO"}function Pn(e){return e==="FEST"?"bg-error text-white":e==="GV"?"bg-primary text-surface":e==="19"?"bg-major-festival text-white":e==="15"?"bg-tertiary text-white":e==="12"?"bg-rating-12 text-white":e==="INFO"?"bg-outline-variant text-primary":"bg-rating-all text-white"}function ce(e){return`inline-flex h-5 min-w-7 items-center justify-center px-2 text-[10px] ${Pn(e)} shrink-0 rounded-sm font-bold leading-none`}function ue(){return"mt-1"}function he(e){return e.time||"\uC2DC\uAC04 \uD655\uC778"}function I(e){let t=N(e),n=String(t.getMonth()+1).padStart(2,"0"),r=String(t.getDate()).padStart(2,"0");return`${n}.${r}`}function yt(e){return H()?he(e):`${I(e.date)} | ${he(e)}`}function ve(e){return`${e.date||""} ${e.timeSort||e.time||""} ${e.venueId||""} ${e.title||""}`}function W(e){return[...e].sort((t,n)=>ve(t).localeCompare(ve(n),"ko"))}function T(e){let t=new Set;return e.map(n=>String(n||"").trim()).filter(n=>!n||t.has(n)?!1:(t.add(n),!0))}function R(e,t=2){let n=T(e);if(!n.length)return"";let r=n.length-t;return`${n.slice(0,t).join(" / ")}${r>0?` \uC678 ${r}`:""}`}function xe(e,t=16){let n=String(e||"").trim(),r=Array.from(n);return r.length>t?`${r.slice(0,t).join("")}...`:n}function P(e,t,n={}){return Object.entries(O(W(e),t)).map(([r,a])=>({key:r,sessions:W(a)})).sort((r,a)=>{if(n.sortByFavorites){let s=+!E(r.key)-+!E(a.key);if(s)return s}return ve(r.sessions[0]).localeCompare(ve(a.sessions[0]),"ko")})}function Y(e){return M(e?.bookingUrl,"")||M(e?.detailUrl,"")||"#"}function X(e){return e?.actionLabel?e.actionLabel:e?.bookingType==="booking"?"\uC608\uB9E4":e?.bookingType==="guide"?"\uC608\uB9E4 \uC548\uB0B4":e?.bookingType==="detail"?"\uC0C1\uC138":e?.bookingType==="official"?"\uACF5\uC2DD \uD655\uC778":"\uD655\uC778"}function wt(e,t="",n={}){let r=ee(e),a=Se(e),s=n.withSubLabel??!1,i=a?U.soldout:X(e),c=yt(e),d=`${e.title||"\uC0C1\uC601"} ${c} ${i}`,u=Y(e);return a?`
        <span class="time-btn time-soldout ${t}" aria-label="${l(`${e.title||"\uC0C1\uC601"} ${c} \uB9E4\uC9C4`)}" title="\uB9E4\uC9C4">
          <span class="font-schedule-time text-sm leading-none whitespace-nowrap">${l(c)}</span>
          <span class="time-soldout-label whitespace-nowrap">\uB9E4\uC9C4</span>
        </span>
      `:r?`
        <span class="time-btn time-ended ${t}" aria-label="${l(`${e.title||"\uC0C1\uC601"} ${c} \uC885\uB8CC`)}" title="\uC0C1\uC601 \uC885\uB8CC">
          <span class="font-schedule-time text-sm leading-none whitespace-nowrap">${l(c)}</span>
        </span>
      `:u==="#"?`
        <span class="time-btn time-ended ${t}" aria-label="${l(`${e.title||"\uC0C1\uC601"} ${c} \uB9C1\uD06C \uD655\uC778 \uD544\uC694`)}" title="\uB9C1\uD06C \uD655\uC778 \uD544\uC694">
          <span class="font-schedule-time text-sm leading-none whitespace-nowrap">${l(c)}</span>
          ${s?'<span class="text-[10px] font-label-caps uppercase whitespace-nowrap">\uD655\uC778\uC911</span>':""}
        </span>
      `:`
      <a class="time-btn ${t}" href="${l(u)}" target="_blank" rel="noopener noreferrer" aria-label="${l(d)}">
        <span class="font-schedule-time text-sm leading-none whitespace-nowrap">${l(c)}</span>
        ${s?`<span class="text-[10px] font-label-caps uppercase whitespace-nowrap">${l(i)}</span>`:""}
      </a>
    `}function Vn(){let e=be(),t=k(),n=o.query.trim().toLowerCase(),r=H(),a=C(),s=o.view==="today",i=(o.data.sessions||[]).filter(p=>o.linkFilter==="all"||p.bookingType===o.linkFilter).filter(p=>o.venueFilter==="all"||p.venueId===o.venueFilter).filter(p=>!ee(p)).filter(p=>bt(p,t,n)),c=vt(i,p=>p.date),d=i.length,u=!r;if(S()){m("#desktopDateBar")?.replaceChildren();let p=r||e[0]||a,x=N(p),A=$[x.getMonth()]||"",J=String(x.getMonth()+1).padStart(2,"0"),_=m("#mobileDateMonth");_&&(_.innerHTML=`
          <strong class="mobile-date-month-number">${l(J)}</strong>
          <span class="mobile-date-month-label mobile-kicker">${l(A)}</span>
        `);let Ie=`
        <button class="mobile-date-item flex h-[72px] min-w-[62px] flex-col items-center justify-center transition-opacity ${r?"text-on-surface-variant hover:text-primary":"border-b-2 border-primary text-primary"}" type="button" data-date="" aria-pressed="${!r}" aria-label="ALL ${d.toLocaleString("ko-KR")} \uD68C\uCC28, \uC804\uCCB4 \uB0A0\uC9DC">
          <span class="mobile-kicker">ALL</span>
          <span class="text-2xl font-bold leading-none">${d.toLocaleString("ko-KR")}</span>
          <span class="mobile-kicker">\uD68C\uCC28</span>
        </button>
      `;m("#mobileDateBar").innerHTML=(s?"":Ie)+e.map(F=>{let re=N(F),sn=r===F,on=gt(F),Jr=sn?`border-b-2 ${on?"border-error text-error":"border-primary text-primary"}`:`${on?"text-error":"text-on-surface-variant"} hover:text-primary`,ln=c[F]||0;return`
            <button class="mobile-date-item flex h-[72px] min-w-[54px] flex-col items-center justify-center transition-colors ${Jr}" type="button" data-date="${l(F)}" aria-pressed="${sn}" ${F===a?'aria-current="date"':""} aria-label="${l(`${re.getDate()} ${F===a?"\uC624\uB298":b[re.getDay()]} \xB7 ${ln}, ${re.getMonth()+1}\uC6D4 ${re.getDate()}\uC77C`)}">
              <span class="text-2xl font-bold leading-none">${re.getDate()}</span>
              <span class="mobile-kicker mt-2">${F===a?"\uC624\uB298":b[re.getDay()]} \xB7 ${ln}</span>
            </button>
          `}).join("");return}m("#mobileDateBar")?.replaceChildren();let w=`
      <button class="flex-shrink-0 flex flex-col items-center justify-center w-20 h-16 rounded-sm transition-colors cursor-pointer border border-transparent ${u?"bg-primary text-surface":"text-on-surface-variant hover:bg-primary/5 hover:border-primary/10"}" type="button" data-date="" aria-pressed="${u}" aria-label="\uC804\uCCB4 ${d.toLocaleString("ko-KR")} \uD68C\uCC28, \uC804\uCCB4 \uB0A0\uC9DC">
        <span class="text-[10px] font-medium mb-1">\uC804\uCCB4</span>
        <span class="text-lg font-bold">${d.toLocaleString("ko-KR")}</span>
        <span class="text-[10px]">\uD68C\uCC28</span>
      </button>
    `;m("#desktopDateBar").innerHTML=(s?"":w)+e.map(p=>{let x=N(p),A=r===p,J=x.getDay()===0,_=p===a?"\uC624\uB298":b[x.getDay()],Ie=J?"text-error":"text-on-surface-variant",F=c[p]||0;return`
          <button class="flex-shrink-0 flex flex-col items-center justify-center w-16 h-16 rounded-sm transition-colors cursor-pointer border border-transparent ${A?"bg-primary text-surface":`${Ie} hover:bg-primary/5 hover:border-primary/10`}" type="button" data-date="${l(p)}" aria-pressed="${A}" ${p===a?'aria-current="date"':""} aria-label="${l(`${_} ${x.getDate()} ${F}\uD68C, ${x.getMonth()+1}\uC6D4 ${x.getDate()}\uC77C`)}">
            <span class="text-[10px] font-medium mb-1">${l(_)}</span>
            <span class="text-lg font-bold">${x.getDate()}</span>
            <span class="text-[10px]">${F.toLocaleString("ko-KR")}\uD68C</span>
          </button>
        `}).join("")}function Kn(){document.querySelectorAll("[data-view]").forEach(e=>{let t=e.dataset.view===o.view;if(e.setAttribute("aria-pressed",String(t)),e.dataset.toggleStyle==="mobile"){e.className=t?"min-w-0 w-full py-2 text-center text-label-caps uppercase bg-surface text-primary border border-outline-variant/20":"min-w-0 w-full py-2 text-center text-label-caps uppercase text-on-surface-variant";return}e.className=t?"px-6 py-2 text-sm font-bold bg-primary text-surface rounded-sm transition-colors":"px-6 py-2 text-sm text-on-surface-variant hover:text-primary transition-colors rounded-sm"})}function S(){return window.matchMedia("(max-width: 767px)").matches}function $e(){return S()?88:92}function Hn(){return S()?["mobile-schedule","mobile-programs","mobile-festivals"]:["schedule","programs","festivals"]}function _n(){let e=Hn(),t=window.scrollY+$e()+48,n=e[0];return e.forEach(r=>{let a=document.getElementById(r);a&&a.offsetTop<=t&&(n=r)}),n}let qe=null;function ye(e){e!==qe&&(qe=e,document.querySelectorAll("[data-nav-target]").forEach(t=>{let n=t.dataset.navTarget===e;if(n?t.setAttribute("aria-current","location"):t.removeAttribute("aria-current"),t.dataset.navKind==="desktop"){t.className=n?"font-body-md text-sm font-bold text-primary border-b-2 border-primary pb-1 transition-colors":"font-body-md text-sm text-on-surface-variant hover:text-primary border-b-2 border-transparent pb-1 transition-colors";return}t.className=n?"min-w-0 w-full h-full flex flex-col items-center justify-center gap-1 text-primary":"min-w-0 w-full h-full flex flex-col items-center justify-center gap-1 text-on-surface-variant";let r=t.querySelector("span:last-child");r&&r.classList.toggle("font-bold",n)}))}function we(){ye(_n())}function Ge(e,t="smooth"){let n=document.getElementById(e);if(!n)return!1;let r=n.getBoundingClientRect().top+window.scrollY-$e();return window.scrollTo({top:Math.max(0,r),behavior:t}),ye(e),!0}function ke(e,t=S()?"mobile":"desktop"){let n=String(e||"unknown").replace(/[^a-zA-Z0-9_-]/g,"-");return`${t}-venue-${n}`}function kt(e,t="smooth"){let n=ke(e),r=document.getElementById(n);if(!r)return!1;let a=$e()+(S()?72:0),s=r.getBoundingClientRect().top+window.scrollY-a;return window.scrollTo({top:Math.max(0,s),behavior:t}),ye(S()?"mobile-schedule":"schedule"),!0}function qn(e){o.venueFilter="all",o.view="today",D(),window.requestAnimationFrame(()=>{if(e==="all"){Ge(S()?"mobile-schedule":"schedule");return}kt(e)||(o.view="venue",o.date=null,D(),window.requestAnimationFrame(()=>{if(kt(e)){Me("\uC624\uB298 \uD68C\uCC28\uAC00 \uC5C6\uC5B4 \uC0C1\uC601\uAD00\uBCC4 \uC77C\uC815\uC73C\uB85C \uC774\uB3D9\uD588\uC2B5\uB2C8\uB2E4.");return}Me("\uD604\uC7AC \uC870\uAC74\uC5D0 \uB9DE\uB294 \uC0C1\uC601 \uD68C\uCC28\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4."),Ge(S()?"mobile-schedule":"schedule")}))})}function St(e,t="desktop"){let n=H()?"min-w-20":"min-w-28",r=t==="mobile"?`flex flex-col items-center justify-center ${n} h-10 px-2 whitespace-nowrap`:`flex flex-col items-center justify-center ${n} h-10 px-3 whitespace-nowrap`;return e.bookingType==="booking"?`${r} bg-primary text-surface`:`${r} border border-primary/20 text-primary bg-surface`}function Lt(e){return vn(e)}function ee(e){return Lt(e)}function Se(e){if(!e)return!1;let t=[e.status,e.actionLabel,e.summary,...e.tags||[]].filter(Boolean).join(" ");return e.status==="soldout"||t.includes("\uB9E4\uC9C4")||/sold\s*out/i.test(t)}function Oe(e,t,n=o.view){let r=R(e.map(i=>i.program),2),a=R(e.map(i=>i.screen||"\uC0C1\uC601\uAD00"),2),s=H()?"":R(e.map(i=>I(i.date)),3);return n==="film"?[t?.area||t?.type||"",r,a].filter(Boolean).join(" \xB7 "):[r,a,s].filter(Boolean).join(" \xB7 ")}function Gn(e,t){let n=e.sessions,r=n[0],a=t[r.venueId],s=le(r),i=o.view==="film"?a?.name||r.screen||"\uC0C1\uC601\uAD00":r.title,c=xe(i),d=Oe(n,a),u=Q(a),h=o.view==="film"?u?`<a class="block max-w-full truncate text-left text-base font-bold text-primary hover:underline" href="${l(u)}" target="_blank" rel="noopener noreferrer" title="${l(`${i} \uACF5\uC2DD \uC0AC\uC774\uD2B8`)}">${l(c)}</a>`:`<span class="block max-w-full truncate text-base font-bold text-primary" title="${l(i)}">${l(c)}</span>`:`<h4 class="block max-w-full truncate text-base font-bold text-primary leading-tight" title="${l(i)}">${l(c)}</h4>`;return`
      <div class="min-w-0 py-4 border-t border-primary/10 hover:bg-primary/[0.025] transition-colors">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0 flex items-start gap-2">
            <span class="${ce(s,!0)} ${ue(!0)}">${l(s)}</span>
            <span class="min-w-0">
              ${h}
              <span class="block mt-1 text-xs text-on-surface-variant leading-relaxed">${l(d)}</span>
            </span>
          </div>
          <span class="shrink-0 pt-1 text-[10px] font-label-caps text-on-surface-variant uppercase">${n.length}\uD0C0\uC784</span>
        </div>
        <div class="mt-3 min-w-0 flex flex-wrap gap-2">
          ${n.map(w=>wt(w,`${St(w)} font-schedule-time`)).join("")}
        </div>
      </div>
    `}function On(e,t,n,r,a){let i=k()[e],c=o.view==="venue"&&i?Pe(i):l(n),d=Q(i),u=o.view==="venue"?d?`<a class="block max-w-full truncate text-left text-2xl font-bold font-display-lg text-primary hover:underline" href="${l(d)}" target="_blank" rel="noopener noreferrer" title="${l(`${t} \uACF5\uC2DD \uC0AC\uC774\uD2B8`)}">${l(t)}</a>`:`<h3 class="block max-w-full truncate text-2xl font-bold font-display-lg text-primary" title="${l(t)}">${l(t)}</h3>`:`<h3 class="block max-w-full truncate text-2xl font-bold font-display-lg text-primary" title="${l(t)}">${l(t)}</h3>`,h=o.view==="venue"&&i?Ee(e,t,"h-9 w-9"):"";return`
      <div class="flex flex-col md:flex-row md:items-end md:justify-between gap-2 border-b-2 border-primary pb-3">
        <div class="min-w-0 overflow-hidden">
          <div class="flex min-w-0 items-center gap-3">
            <div class="min-w-0">${u}</div>
            ${h}
          </div>
          <p class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-on-surface-variant leading-relaxed">${c}</p>
        </div>
        <span class="text-sm text-on-surface-variant">${r.length}${o.view==="film"?"\uACF3":"\uD3B8"} \xB7 ${a.length}\uD68C\uCC28</span>
      </div>
    `}function zn(e){let t=T([e.summary,e.program,...e.tags||[]]).flatMap(n=>String(n||"").split("\xB7").map(r=>r.trim())).filter(Boolean);return T(t)}function Yn(e){return/^(?:ALL(?:세|관람가)?|전체(?:관람가)?|\d+\s*세(?:이상)?(?:관람가)?|청소년(?:관람불가|관람가))$/i.test(String(e||"").trim())}function Zn(e){return/^\d+\s*분$/.test(String(e||"").trim())}function Jn(e,t,n){let r=String(e||"").trim();return r?r===String(t.screen||"").trim()||r===String(n?.name||"").trim()||r===String(t.venueName||"").trim()||/^(?:\d+관|[A-Z]관|아리랑인디웨이브관|시네마테크KOFA\s*\d관)/i.test(r):!1}function Qn(e){return e.find(t=>/^(?:일반|조조|심야|GV|무대인사|관객과의\s*대화|시네토크|굿즈|패키지)$/i.test(t))||""}function Wn(e){return e.find(t=>/^(?:2D|3D|4D|IMAX|D-Cinema|35mm|16mm|필름)(?:\([^)]*\))?$/i.test(t))||""}function Xn(e){return e.find(t=>/^잔여\s*\d+\s*\/\s*\d+\s*석$/.test(t))||""}function er(e){return e.find(t=>Zn(t))||""}function tr(e,t){let n=zn(e).filter(a=>!(Jn(a,e,t)||Yn(a)||Se(e)&&(a.includes("\uB9E4\uC9C4")||a.includes("\uC608\uB9E4\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4")))),r=T([Xn(n),er(n),Qn(n),Wn(n)]);return r.length?r.join(" \xB7 "):n.join(" \xB7 ")}function nr(e,t,n=!1){let r=t[e.venueId],a=le(e),s=tr(e,r),i=e.screen||r?.area||"\uC0C1\uC601\uAD00",c=n?T([i,s]).join(" \xB7 "):s||r?.name||"",d=ee(e),u=Se(e),h=xe(e.title||"\uC81C\uBAA9 \uD655\uC778"),w=Y(e),p=!d&&!u&&w!=="#",x=u?U.soldout:d?"\uC885\uB8CC":X(e),A=d?"border border-outline/40 text-on-surface-variant bg-surface-container-low":u?"border border-error/30 text-error bg-surface-container-low":e.bookingType==="booking"?"bg-primary text-surface":"border border-primary/20 text-primary",J=d?"text-on-surface-variant line-through decoration-1":u?"text-on-surface-variant":"text-primary";return`
      <div class="${n?"block py-4 border-t border-outline-variant/20":"block border border-primary/10 bg-surface-container-lowest px-4 py-4 transition-colors hover:border-primary/25 hover:bg-surface"}">
        <div class="${n?"flex items-start gap-3":"grid grid-cols-[5.5rem_minmax(0,1fr)_auto] gap-5 items-start"}">
          <span class="${n?"w-16":""} shrink-0">
            <strong class="block font-schedule-time text-lg leading-none ${d||u?"text-on-surface-variant":"text-error"}">${l(he(e))}</strong>
            ${n?"":`<span class="mt-2 block text-xs text-on-surface-variant">${l(i)}</span>`}
          </span>
          <span class="min-w-0">
            <span class="flex min-w-0 items-start gap-2">
              <span class="${ce(a,n)} ${ue(n)}">${l(a)}</span>
              <strong class="block min-w-0 ${n?"mobile-row-title":"text-lg leading-[22px]"} ${J} truncate" title="${l(e.title||"")}">${l(h)}</strong>
            </span>
            <span class="${n?"mobile-meta mt-1 block break-keep":"mt-2 block text-sm text-on-surface-variant"}">${l(c)}</span>
          </span>
          <span class="${n?"ml-auto flex shrink-0 flex-col gap-2":"flex shrink-0 flex-col items-stretch gap-2"}">
            ${p?`<a class="inline-flex justify-center px-3 py-1 text-[10px] font-label-caps ${A}" href="${l(w)}" target="_blank" rel="noopener noreferrer">${l(x)}</a>`:`<span class="inline-flex justify-center px-3 py-1 text-[10px] font-label-caps ${A}">${l(x)}</span>`}
          </span>
        </div>
      </div>
    `}function Tt(e,t,n=!1){let r=k(),a=r[e],s=a?.name||e||"\uC0C1\uC601\uAD00",i=ke(e,n?"mobile":"desktop"),c=W(t),d=Q(a),u=n?"mobile-card-title":"text-2xl font-bold font-display-lg",h=d?`<a class="block max-w-full truncate text-left text-primary hover:underline" href="${l(d)}" target="_blank" rel="noopener noreferrer" title="${l(`${s} \uACF5\uC2DD \uC0AC\uC774\uD2B8`)}">${l(s)}</a>`:l(s),w=`<h3 class="block max-w-full truncate ${u} text-primary" title="${l(s)}">${h}</h3>`,p=a?Ee(e,s,"h-9 w-9"):"",x=E(e),A=n?`border-b border-outline-variant/20 pb-5 scroll-mt-40 ${x?"bg-primary/[0.035] -mx-4 px-4 py-4":""}`:`scroll-mt-28 ${x?"border border-primary/25 bg-primary/[0.025] p-4":""}`,J=n?"pb-3":"flex flex-col md:flex-row md:items-end md:justify-between gap-2 border-b-2 border-primary pb-3";return`
      <div id="${l(i)}" class="${A}">
        <div class="${J}">
          <div class="min-w-0 overflow-hidden">
            <div class="flex min-w-0 items-center gap-3">
              <div class="min-w-0">${w}</div>
              ${p}
            </div>
            <p class="${n?"mobile-meta mt-2":"mt-2 text-sm text-on-surface-variant leading-relaxed"} flex flex-wrap items-center gap-x-2 gap-y-1">${Pe(a,"\uC0C1\uC601\uC77C \uC6B4\uC601 | \uC11C\uC6B8",n)}</p>
          </div>
          <span class="${n?"mobile-kicker text-on-surface-variant":"text-sm text-on-surface-variant"}">${c.length}\uD68C\uCC28</span>
        </div>
        <div class="${n?"":"agenda-grid"}">
          ${c.map(_=>nr(_,r,n)).join("")}
        </div>
      </div>
    `}function rr(e){let t=m("#desktopSchedule"),n=H(),r=P(e,a=>a.venueId||"unknown",{sortByFavorites:!0});if(!r.length){t.innerHTML=`<div class="p-10 border-y border-primary/10 bg-surface text-center text-on-surface-variant">${l(oe(n))}\uC5D0 \uB9DE\uB294 \uC0C1\uC601 \uD68C\uCC28\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.</div>`;return}t.innerHTML=r.map(a=>Tt(a.key,a.sessions)).join("")}function ar(e){if(o.view==="today"){rr(e);return}let t=k(),n=O(e,s=>o.view==="film"?s.title:s.venueId),r=o.view==="venue"?P(e,s=>s.venueId||"unknown",{sortByFavorites:!0}).map(s=>[s.key,s.sessions]):Object.entries(n),a=m("#desktopSchedule");if(!r.length){a.innerHTML='<div class="p-10 border-y border-primary/10 bg-surface text-center text-on-surface-variant">\uC870\uAC74\uC5D0 \uB9DE\uB294 \uC0C1\uC601 \uD68C\uCC28\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.</div>';return}a.innerHTML=r.map(([s,i])=>{let c=i[0],d=t[c.venueId],u=o.view==="film"?s:d?.name||s,h=P(i,x=>o.view==="film"?x.venueId||"unknown":x.title||"\uC81C\uBAA9 \uD655\uC778",{sortByFavorites:o.view==="film"}),w=o.view==="film"?R(i.map(x=>t[x.venueId]?.name),4):d?.area||d?.type||"\uC11C\uC6B8",p=o.view==="venue"?ke(s,"desktop"):"";return`
          <div ${p?`id="${l(p)}"`:""} class="scroll-mt-28">
            ${On(s,u,w,h,i)}
            <div class="grid grid-cols-1 xl:grid-cols-2 xl:gap-x-10">
              ${h.map(x=>Gn(x,t)).join("")}
            </div>
          </div>
        `}).join("")}function Mt(e){return e.map(t=>wt(t,`${St(t,"mobile")} font-schedule-time`,{withSubLabel:!1})).join("")}function sr(e,t){let n=t[0],r=Oe(t,e,"film"),a=e?.name||n.screen||"\uC0C1\uC601\uAD00",s=E(e?.id),i=Q(e);return`
      <div class="py-3 border-t border-outline-variant/20 ${s?"bg-primary/[0.035] -mx-3 px-3":""}">
        <div class="flex justify-between items-start gap-3">
          <span class="min-w-0 flex-1">
            <span class="flex min-w-0 items-start gap-2">
              <span class="min-w-0">
                ${i?`<a class="mobile-row-title block max-w-full truncate text-left text-primary hover:underline" href="${l(i)}" target="_blank" rel="noopener noreferrer" title="${l(`${a} \uACF5\uC2DD \uC0AC\uC774\uD2B8`)}">${l(a)}</a>`:`<span class="mobile-row-title block max-w-full truncate text-primary" title="${l(a)}">${l(a)}</span>`}
              </span>
            </span>
            <span class="mobile-meta block mt-1">${l(r)}</span>
          </span>
          <span class="mobile-kicker shrink-0 text-on-surface-variant">${t.length}\uD0C0\uC784</span>
        </div>
        <div class="mt-3 flex flex-wrap gap-2">
          ${Mt(t)}
        </div>
      </div>
    `}function ir(e,t){let n=t[0],r=le(n),a=Oe(t,null,"venue"),s=e||n.title,i=xe(s);return`
      <div class="py-3 border-t border-outline-variant/20">
        <div class="flex items-start justify-between gap-3">
          <span class="min-w-0">
            <span class="flex items-start gap-2 min-w-0">
              <span class="${ce(r,!0)} ${ue(!0)}">${l(r)}</span>
              <strong class="mobile-row-title block min-w-0 truncate text-on-surface" title="${l(s)}">${l(i)}</strong>
            </span>
            <span class="mobile-meta block mt-1">${l(a)}</span>
          </span>
          <span class="mobile-kicker shrink-0 text-on-surface-variant">${t.length}\uD0C0\uC784</span>
        </div>
        <div class="mt-3 flex flex-wrap gap-2">
          ${Mt(t)}
        </div>
      </div>
    `}function or(e,t,n){let r=k(),a=t[0],s=le(a),i=P(t,u=>u.venueId||"unknown",{sortByFavorites:!0}),c=R(t.map(u=>r[u.venueId]?.name),2),d=xe(e);return`
      <div class="border-b border-outline-variant/20 pb-5">
        <div class="min-w-0">
          <div class="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2">
            <span class="${ce(s,!0)} ${ue(!0,"card")}">${l(s)}</span>
            <span class="min-w-0">
              <h3 class="mobile-card-title max-w-full truncate text-on-surface" title="${l(e)}">${l(d)}</h3>
            </span>
            <span class="mobile-meta col-start-2 block mt-1">${l(c||a.program||"\uC0C1\uC601")}</span>
          </div>
          <div class="mt-3 flex flex-wrap gap-2">
            <span class="mobile-kicker text-on-surface-variant">${l(L[a.kind]||a.kind)}</span>
            <span class="mobile-kicker text-on-surface-variant">${t.length}\uD68C\uCC28</span>
            <span class="mobile-kicker text-on-surface-variant">${i.length}\uACF3</span>
          </div>
        </div>
        <div class="mt-3">
          ${i.map(u=>sr(r[u.sessions[0].venueId],u.sessions)).join("")}
        </div>
      </div>
    `}function lr(e,t,n){let r=P(t,u=>u.title||"\uC81C\uBAA9 \uD655\uC778"),a=e?.name||"\uC0C1\uC601\uAD00",s=ke(e?.id||t[0]?.venueId||n,"mobile"),i=e?Ee(e.id,a,"h-9 w-9"):"",c=E(e?.id),d=Q(e);return`
      <div id="${l(s)}" class="border-b border-outline-variant/20 pb-5 scroll-mt-40 ${c?"bg-primary/[0.035] -mx-4 px-4 py-4":""}">
        <div class="min-w-0">
          <div class="flex min-w-0 items-center gap-3">
            <div class="min-w-0">
              ${d?`<a class="mobile-card-title block max-w-full truncate text-left text-primary hover:underline" href="${l(d)}" target="_blank" rel="noopener noreferrer" title="${l(`${a} \uACF5\uC2DD \uC0AC\uC774\uD2B8`)}">${l(a)}</a>`:`<h3 class="mobile-card-title block max-w-full truncate text-primary" title="${l(a)}">${l(a)}</h3>`}
            </div>
            ${i}
          </div>
          <p class="mobile-meta mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">${Pe(e,"\uC0C1\uC601\uC77C \uC6B4\uC601 | \uC11C\uC6B8",!0)}</p>
          <div class="mt-3 flex flex-wrap gap-2">
            <span class="mobile-kicker text-on-surface-variant">${t.length}\uD68C\uCC28</span>
            <span class="mobile-kicker text-on-surface-variant">${r.length}\uD3B8</span>
          </div>
        </div>
        <div class="mt-3">
          ${r.map(u=>ir(u.key,u.sessions)).join("")}
        </div>
      </div>
    `}function cr(e){if(o.view==="today"){let a=H(),s=P(e,i=>i.venueId||"unknown",{sortByFavorites:!0});m("#mobileSchedule").innerHTML=s.length?s.map(i=>Tt(i.key,i.sessions,!0)).join(""):`<div class="p-6 border border-outline-variant/20 bg-surface-container-lowest text-center text-on-surface-variant">${l(oe(a))}\uC5D0 \uB9DE\uB294 \uC0C1\uC601 \uD68C\uCC28\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.</div>`;return}let t=k(),n=o.view==="film"?O(e,a=>a.title):O(e,a=>a.venueId),r=o.view==="venue"?P(e,a=>a.venueId||"unknown",{sortByFavorites:!0}).map(a=>[a.key,a.sessions]):Object.entries(n);if(!r.length){m("#mobileSchedule").innerHTML='<div class="p-6 border border-outline-variant/20 bg-surface-container-lowest text-center text-on-surface-variant">\uC870\uAC74\uC5D0 \uB9DE\uB294 \uC0C1\uC601 \uD68C\uCC28\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.</div>';return}m("#mobileSchedule").innerHTML=r.map(([a,s],i)=>{if(o.view==="film")return or(a,s,i);let c=t[a];return lr(c,s,i)}).join("")}function ur(){let e=o.data.venues||[],t=H()||ft(),n=Dn(t)?"\uC624\uB298 \uC0C1\uC601\uAD00 \uBC14\uB85C\uAC00\uAE30":"\uC0C1\uC601\uAD00 \uBC14\uB85C\uAC00\uAE30",r=m("#desktopVenueShortcutTitle"),a=m("#mobileVenueShortcutTitle");r&&(r.textContent=n),a&&(a.textContent=n);let s=G().filter(p=>p.date===t),i=vt(s,p=>p.venueId),d=Sn(e,p=>({id:p.id,name:p.name,displayName:p.name,area:p.area,address:Re(p),count:i[p.id]||0,countLabel:`${(i[p.id]||0).toLocaleString("ko-KR")}\uD68C\uCC28`,shortCountLabel:`${(i[p.id]||0).toLocaleString("ko-KR")}\uD68C\uCC28`})),u=S(),h=m(u?"#mobileVenueFilter":"#desktopVenueFilter");m(u?"#desktopVenueFilter":"#mobileVenueFilter")?.replaceChildren(),dr(h,d,u)}function dr(e,t,n){if(!e)return;e.parentElement?.classList.toggle("hidden",!t.length);let r=n?"group flex h-24 w-32 flex-col items-center justify-between border bg-surface-container-lowest px-2 py-2 text-center text-primary transition-colors active:bg-primary/5":"group flex min-h-28 w-full min-w-0 flex-col items-center justify-between border bg-surface px-3 py-3 text-center text-primary transition-colors hover:border-primary/30 hover:bg-primary/5";e.innerHTML=t.map(a=>{let s=a.displayName||a.name,i=E(a.id)?"border-primary/25 ring-1 ring-primary/35":n?"border-outline-variant/20":"border-primary/10",c=n?`<span class="flex h-9 w-full items-center justify-center px-1">${st(a,!0)}</span>`:`<span class="flex h-11 w-full items-center justify-center px-1">${st(a)}</span>`,d=n?`<span class="mt-1 flex h-8 w-full items-center justify-center overflow-hidden text-[11px] font-bold leading-4">${l(s)}</span>`:`<span class="mt-2 flex h-9 w-full items-center justify-center overflow-hidden text-sm font-bold leading-[1.2]">${l(s)}</span>`,u=n?`<span class="mobile-kicker mt-1 block text-on-surface-variant">${l(a.shortCountLabel||a.countLabel)}</span>`:`<span class="mt-1 block text-[10px] font-label-caps text-on-surface-variant">${l(a.countLabel)}</span>`;return`
          <div class="relative ${n?"w-32 shrink-0 snap-start":"min-w-0"}">
            <button class="${r} ${i}" type="button" data-venue-jump="${l(a.id)}" aria-label="${l(`${a.name} ${a.countLabel}`)}">
              ${c}
              ${d}
              ${u}
            </button>
          </div>
        `}).join("")}function fr(e){let t=R(e.map(r=>I(r.date)),4);return[`${new Set(e.map(r=>r.venueId).filter(Boolean)).size.toLocaleString("ko-KR")}\uACF3`,`${e.length.toLocaleString("ko-KR")}\uD68C\uCC28`,t].filter(Boolean).join(" \xB7 ")}function mr(e,t=!1){let n=k(),r=P(e,u=>u.venueId||"unknown",{sortByFavorites:!0}),a=new Set(e.map(u=>u.date).filter(Boolean)).size>1,s=t?"inline-flex shrink-0 items-center gap-2 border border-outline-variant/15 bg-surface-container-lowest px-3 py-2":"flex max-w-full min-w-0 items-center gap-2 border border-primary/10 bg-surface-container-lowest px-3 py-2",i=t?"max-w-[7.2rem] truncate text-[12px] font-bold leading-none text-primary":"max-w-[8.8rem] shrink-0 truncate text-sm font-bold leading-none text-primary",c=t?"flex w-full max-w-full min-w-0 gap-2 overflow-x-auto overscroll-x-contain no-scrollbar pb-1":"flex w-full max-w-full min-w-0 flex-wrap gap-2 pb-1",d=r.map(u=>{let h=u.sessions[0],p=n[h.venueId]?.name||h.venueName||h.screen||"\uC0C1\uC601\uAD00",x=u.sessions.map(A=>pr(A,t,a)).join("");return`
          <span class="${s}">
            <span class="${i}" title="${l(p)}">${l(p)}</span>
            <span class="${t?"flex shrink-0 items-center gap-1":"flex min-w-0 flex-wrap items-center gap-1"}">${x}</span>
          </span>
        `}).join("");return`<div class="${c}">${d}</div>`}function pr(e,t=!1,n=!1){let r=ee(e),a=Se(e),s=n?`${I(e.date)} | ${he(e)}`:yt(e),i=Y(e),c=a?U.soldout:r?"\uC885\uB8CC":X(e),d=t?"inline-flex h-7 min-w-[3.55rem] items-center justify-center px-2 text-[12px] leading-none":"inline-flex h-8 min-w-16 items-center justify-center px-3 text-sm leading-none",u=a||r||i==="#"?"border border-primary/20 bg-surface text-on-surface-variant":e.bookingType==="booking"?"bg-primary text-surface":"border border-primary/20 bg-surface text-primary",h=a?`<span class="ml-1 text-[10px] font-label-caps text-error">${l(c)}</span>`:"",w=`<span class="font-schedule-time whitespace-nowrap">${l(s)}</span>${h}`,p=`time-btn ${d} ${u}`;return a||r||i==="#"?`<span class="${p}" aria-label="${l(`${e.title||"\uC0C1\uC601"} ${s} ${c}`)}" title="${l(c)}">${w}</span>`:`<a class="${p}" href="${l(i)}" target="_blank" rel="noopener noreferrer" aria-label="${l(`${e.title||"\uC0C1\uC601"} ${s} ${c}`)}">${w}</a>`}function B(e,t){e?.classList.toggle("hidden",t)}function gr(e){B(m("#desktopDateBar")?.parentElement,e),B(document.querySelector("[data-toggle-style='desktop']")?.parentElement?.parentElement,e),B(m("#desktopVenueFilter")?.parentElement,e),B(m("#desktopSchedule"),e),B(m("#mobileDateBar")?.closest(".sticky"),e),B(m("#view-today")?.parentElement,e),B(m("#mobileVenueFilter")?.parentElement,e),B(m("#mobileScheduleHeading")?.parentElement,e),B(m("#mobileSchedule"),e),["programs","festivals","mobile-programs","mobile-festivals"].forEach(t=>{B(document.getElementById(t),e)})}function Ct(e,t,n=!1){let r=W(t),a=r[0],s=le(a),i=n?"mobile-row-title":"text-lg leading-tight",c=n?"mobile-meta":"text-xs text-on-surface-variant";return`
      <div class="${n?"py-4":"py-5"} border-t border-primary/10">
        <div class="flex flex-col ${n?"gap-3":"lg:flex-row lg:items-start gap-4"}">
          <div class="min-w-0 ${n?"":"lg:w-[22rem] shrink-0"}">
            <div class="flex items-start gap-2">
              <span class="${ce(s,n)} ${ue(n)}">${l(s)}</span>
              <span class="min-w-0">
                <strong class="block ${i} line-clamp-1 text-primary" title="${l(e)}">${l(e)}</strong>
                <span class="mt-1 block ${c}">${l(fr(r))}</span>
              </span>
            </div>
          </div>
          <div class="min-w-0 ${n?"w-full":"w-full lg:flex-1"}">
            ${mr(r,n)}
          </div>
        </div>
      </div>
    `}function br(e){let t=o.query.trim(),n=!!t,r=n?P(e,u=>u.title||"\uC81C\uBAA9 \uD655\uC778"):[],a=m("#desktopSearchResults"),s=m("#mobileSearchResults"),i=S(),c=m("#searchResultStatus");c&&(c.textContent=n?`${r.length}\uD3B8, ${e.length.toLocaleString("ko-KR")}\uD68C\uCC28`:""),gr(n);let d=i?a:s;d&&(d.classList.add("hidden"),d.replaceChildren()),a&&!i&&(a.classList.toggle("hidden",!n),a.innerHTML=n?`
          <div class="border-y-2 border-primary bg-surface">
            <div class="py-4 flex items-end justify-between gap-4">
              <span>
                <strong class="block text-2xl font-bold text-primary">"${l(t)}" \uAC80\uC0C9 \uACB0\uACFC</strong>
                <span class="mt-1 block text-sm text-on-surface-variant">${r.length}\uD3B8 \xB7 ${e.length.toLocaleString("ko-KR")}\uD68C\uCC28</span>
              </span>
            </div>
            <div>
              ${r.length?r.map(u=>Ct(u.key,u.sessions)).join(""):'<div class="py-10 border-t border-primary/10 text-center text-on-surface-variant">\uAC80\uC0C9 \uACB0\uACFC\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.</div>'}
            </div>
          </div>
        `:""),s&&i&&(s.classList.toggle("hidden",!n),s.innerHTML=n?`
          <div class="border-y border-outline-variant/20">
            <div class="py-3">
              <strong class="block text-base text-primary">"${l(t)}" \uAC80\uC0C9 \uACB0\uACFC</strong>
              <span class="mt-1 block text-xs text-on-surface-variant">${r.length}\uD3B8 \xB7 ${e.length.toLocaleString("ko-KR")}\uD68C\uCC28</span>
            </div>
            ${r.length?r.map(u=>Ct(u.key,u.sessions,!0)).join(""):'<div class="py-6 border-t border-outline-variant/20 text-sm text-on-surface-variant">\uAC80\uC0C9 \uACB0\uACFC\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.</div>'}
          </div>
        `:"")}function hr(e){let t=T(e.map(n=>n.date)).sort();return t.length?t.length===1?I(t[0]):`${I(t[0])} - ${I(t[t.length-1])}`:""}function vr(e){return/^(?:상영시간표|날짜별 시간표|작품별 상영일정|일반|2D(?:\([^)]*\))?|영문자막|자막|상영)$/i.test(String(e||"").trim())}function j(e){let t=String(e||"").replace(/^2D-/,"").replace(/^#+/,"").replace(/\([^)]*\)/g,"").replace(/\s+/g," ").trim();return t=t.replace(/^\d{1,2}\s*월\s*\d{1,2}\s*일?\s*/i,"").replace(/^\d{1,2}\s*월\s*/,"").replace(/^\d{1,2}\s*[.\-/]\s*\d{1,2}(?:\s*[월화수목금토일])?\s*/i,"").replace(/^\d+\s*회\s+(?=.{0,40}(?:영화제|페스티벌))/i,"").replace(/\s*[|｜]\s*[^|｜]+$/g,"").replace(/^(.*?(?:영화제|페스티벌))\s*['"‘’“”]([^'"‘’“”]+)['"‘’“”]\s*$/i,"$1: $2").replace(/(.+[가-힣].*?)\s+(?=[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff々〆〤ヶー・0-9A-Za-z\s]*[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff々〆〤ヶー・])[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff々〆〤ヶー・0-9A-Za-z\s]+$/u,"$1").replace(/\s+/g," ").replace(/\s+([:：])/g,"$1").trim(),t}function ze(e){return/GV|관객과의\s*대화|씨네토크|시네토크|인디토크|토크|강연|연주상영/i.test(String(e||""))}function It(e){return/영화제|페스티벌|프라이드시네마|KQFF|기획전|특별\s*상영|특별전|감독전|회고전|발굴복원전|인디돌잔치|상영회|패키지|주간/i.test(String(e||""))}function jt(e){return/굿즈|패키지/i.test(String(e||""))}function xr(e){let t=String(e||"");return/영화제|페스티벌|프라이드시네마|KQFF/i.test(t)?"\uC601\uD654\uC81C":/회고전/.test(t)?"\uD68C\uACE0\uC804":/감독전/.test(t)?"\uAC10\uB3C5\uC804":/특별\s*상영|특별전|상영회/.test(t)?"\uD2B9\uBCC4\uC0C1\uC601":"\uD504\uB85C\uADF8\uB7A8"}function Dt(e){let t=`${e.title||""} ${e.kind||""} ${e.summary||""}`;return!It(t)||jt(t)?!1:!ze(e.title)}function At(e){let n=k()[e.venueId]?.name||"\uC0C1\uC601\uAD00",r=String(e.program||"").trim(),a=`${e.title||""} ${r} ${e.summary||""}`;if(!It(a)||jt(a)||e.kind==="talk"||ze(e.title)||ze(r))return"";if(/^2D-?영화제/.test(r))return`${e.venueId}::${n} \uC601\uD654\uC81C \uC0C1\uC601`;if(/^2D-?기획전/.test(r))return"";if(De(e))return`${e.venueId}::${Kt(e)}`;let s=j(r);return/기획전|특별\s*상영|패키지|감독전|회고전|상영회|시네마테크|주간|프라이드시네마/i.test(s)&&!vr(s)&&!/^(?:기획전|영화제|특별상영|상영회|패키지)$/i.test(s)?`${e.venueId}::${s}`:""}function Ft(e){return T(j(e.title).split(/[\s:·,.'‘’"()[\]\-]+/).filter(t=>t.length>=2&&!/영화|기획전|특별|상영|프로그램|파트|the|and/i.test(t)))}function Nt(e){return String(e||"").replace(/\((?:확장판|감독판|디지털|자막|영문자막|무삭제판|리마스터링|4K|2D|3D|더빙)[^)]*\)/gi,"").replace(/\s+/g," ").trim()}function Le(e){let t=j(e.title).replace(/[“”‘’"']/g,"").replace(/\s+/g," ").trim(),n=t.match(/[<〈]([^>〉]*(?:영화제|페스티벌|기획전|특별전|감독전|회고전|추모전|프로젝트)[^>〉]*)[>〉]/i);if(n?.[1])return j(n[1]);let r=t.match(/([가-힣A-Za-z0-9·\s]+(?:영화제|페스티벌|기획전|특별전|감독전|회고전|추모전|프로젝트))/i);return j(r?.[1]||t)}function $r(e,t){return!e?.start||!e?.end||!t?.start||!t?.end?!0:e.start<=t.end&&t.start<=e.end}function yr(e,t){if(!e?.venueId||e.venueId!==t?.venueId||!$r(te(e),te(t)))return!1;let n=Le(e),r=Le(t);return!n||!r?!1:n===r||n.includes(r)||r.includes(n)}function wr(e,t){let n=r=>{let a=Le(r),s=0;return r.sourceId||(s+=30),(z(r)||Ae[r.id])&&(s+=4),/영화제|페스티벌|기획전|특별전|감독전|회고전|추모전|프로젝트/i.test(a)&&(s+=8),/[<〈>〉]/.test(r.title||"")&&(s-=6),s-=Math.min(String(r.title||"").length,80)/10,s};return n(e)>=n(t)?e:t}function kr(e,t){if(e.venueId&&t.venueId!==e.venueId)return!1;let n=te(e);if(n?.start&&n?.end&&(t.date<n.start||t.date>n.end))return!1;let r=`${e.title||""} ${e.kind||""} ${e.summary||""}`,a=`${t.title||""} ${t.program||""} ${t.summary||""} ${(t.tags||[]).join(" ")}`;return Ft({title:Le(e)}).some(i=>a.includes(i))?!0:/영화제|페스티벌|기획전|특별전|감독전|회고전|추모전|프로젝트/i.test(r)?/영화제|페스티벌|기획전|특별|감독전|회고전|추모전/i.test(a):!1}function Ye(e){let t=Array.isArray(e.movies)?e.movies:[],n=G().filter(r=>kr(e,r)).map(r=>Nt(r.title));return T([...t,...n].map(Nt).filter(Boolean)).slice(0,10)}function Sr(e,t){let n=wr(e,t),r=n===e?t:e,a=T([...e.dates||[],...t.dates||[]].filter(Boolean)).sort(),s=T([...e.movieTitles||[],...t.movieTitles||[],...Ye(e),...Ye(t)].filter(Boolean));return{...n,dates:a.length?a:n.dates,url:n.url||r.url||"",posterUrl:z(n)?n.posterUrl:r.posterUrl||n.posterUrl,movieTitles:s,sessions:Math.max(Number(e.sessions||0),Number(t.sessions||0))||n.sessions,titleCount:Math.max(Number(e.titleCount||0),Number(t.titleCount||0))||n.titleCount}}function Lr(e){return e.reduce((t,n)=>{let r={...n,movieTitles:Ye(n)},a=t.findIndex(s=>yr(s,r));return a>=0?t[a]=Sr(t[a],r):t.push(r),t},[])}function Bt(e){let t=Ft(e),n=j(e.title);return G().filter(r=>{if(e.venueId&&r.venueId!==e.venueId)return!1;let a=`${r.program||""} ${r.title||""} ${r.summary||""}`;return n&&a.includes(n)?!0:t.filter(i=>a.includes(i)).length>=Math.min(2,t.length||2)})}function Ut(e){if(z(e))return e;if(Ae[e.id])return{...e,posterUrl:Ae[e.id]};let t=Bt(e).find(n=>z(n));return t?{...e,posterUrl:z(t)}:e}function Tr(){let e=k(),t=Nn(),n=O(G().filter(r=>At(r)),At);return Object.entries(n).map(([r,a])=>{let s=W(a),i=s[0],c=e[i.venueId],[,d]=r.split("::"),u=T(s.map(x=>x.title)),h=t[i.sourceId],w=M(i.detailUrl,"")||M(h?.url,"")||M(i.bookingUrl,"")||Q(c)||"#",p=s.find(x=>z(x))||i;return{id:`auto-${r}`,title:d,venueId:i.venueId,period:hr(s),dates:T(s.map(x=>x.date)).sort(),kind:xr(`${d} ${i.program||""}`),status:"\uC790\uB3D9 \uBC18\uC601",url:w,posterUrl:p.posterUrl,sessions:s.length,titleCount:u.length,sortKey:`${s[0].date||""} ${d}`}}).filter(r=>r.title&&!/^영화제$/.test(r.title)).filter(Dt).sort((r,a)=>r.sortKey.localeCompare(a.sortKey,"ko"))}function te(e){let t=Array.isArray(e.dates)?e.dates:[],n=t.length?t:Bt(e).map(r=>r.date);return Ve(e.period,n)}function Ze(e){return ie(te(e))}function ne(e,t=!1){return e?.label?`<span class="festival-lifecycle-pill inline-flex shrink-0 items-center border ${{ending:"border-primary bg-primary text-surface",active:"border-status-active/25 bg-status-active/10 text-status-active",upcoming:"border-primary/15 bg-primary/5 text-on-surface-variant"}[e.tone]||"border-primary/10 bg-primary/5 text-on-surface-variant"} ${t?"px-2 py-1 text-[10px]":"px-3 py-1 text-[11px]"} font-bold leading-none">${l(e.label)}</span>`:""}function Et(e){return e?.tone==="ending"||e?.tone==="active"?0:e?.tone==="upcoming"?1:e?.expired?3:2}function Rt(e,t){return e&&(e.end||e.start)||""}function Pt(e,t,n,r,a,s){let i=Et(t)-Et(a);if(i)return i;let c=Rt(e,t).localeCompare(Rt(r,a));return c||String(n||"").localeCompare(String(s||""),"ko")}function Mr(){let e=(o.data.programs||[]).filter(Dt).map(Ut).filter(r=>!Ze(r)?.expired),t=new Set(e.map(r=>`${r.venueId||""}::${r.title||""}`)),n=Tr().filter(r=>{let a=`${r.venueId||""}::${r.title||""}`,s=e.some(i=>i.venueId!==r.venueId?!1:r.title.includes(i.title)||i.title.includes(r.title));return t.has(a)||s?!1:(t.add(a),!0)}).map(Ut);return Lr([...e,...n]).sort((r,a)=>{let s=te(r),i=te(a);return Pt(s,ie(s),r.sortKey||r.title,i,ie(i),a.sortKey||a.title)})}function Vt(e,t){return[e.kind,t?.name].filter(Boolean).join(" | ")||"\uD504\uB85C\uADF8\uB7A8"}function Cr(){let e=k(),t=Mr(),n=S(),r=m("#programList"),a=m("#mobileProgramList");if(n){r?.replaceChildren(),a.innerHTML=t.map(s=>{let i=e[s.venueId],c=Vt(s,i),d=Ze(s),u=M(s.url,"#");return`
            <a class="flex gap-3 p-4 bg-surface-container-lowest border border-outline-variant/10" href="${l(u)}" target="_blank" rel="noopener noreferrer">
              ${He(s,s.title,"w-24 h-16 object-cover shrink-0","")}
              <span class="flex flex-col justify-center min-w-0">
                <span class="mb-1 flex items-center gap-2">
                  <span class="min-w-0 text-sm font-bold text-tertiary line-clamp-1">${l(c||"\uD504\uB85C\uADF8\uB7A8")}</span>
                  ${ne(d,!0)}
                </span>
                <strong class="mobile-row-title line-clamp-2" title="${l(j(s.title))}">${l(j(s.title))}</strong>
                ${s.period?`<span class="mobile-kicker mt-2 inline-flex w-fit bg-primary/5 px-2 py-1 text-primary">${l(s.period)}</span>`:""}
              </span>
            </a>
          `}).join("");return}a?.replaceChildren(),r.innerHTML=t.map(s=>{let i=e[s.venueId],c=Vt(s,i),d=Ze(s),u=M(s.url,"#");return`
          <a class="group flex h-full cursor-pointer flex-col rounded-sm border border-primary/10 bg-surface p-4 transition-colors hover:border-primary/30" href="${l(u)}" target="_blank" rel="noopener noreferrer">
            <div class="aspect-video bg-surface/10 mb-6 overflow-hidden">
              ${He(s,s.title,"w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.02]","")}
            </div>
            <div class="mb-3 flex items-center justify-between gap-2">
              <span class="min-w-0 text-base md:text-lg font-bold text-on-surface-variant block line-clamp-1">${l(c||"\uD504\uB85C\uADF8\uB7A8")}</span>
              ${ne(d)}
            </div>
            <h3 class="text-xl font-bold leading-snug h-[3.4rem] line-clamp-2 group-hover:text-tertiary transition-colors" title="${l(j(s.title))}">${l(j(s.title))}</h3>
            <div class="mt-5 flex flex-wrap items-center gap-2">
              ${s.period?`<span class="text-base md:text-lg font-bold px-3 py-1 bg-primary/5 text-primary">${l(s.period)}</span>`:""}
              ${s.sessions?`<span class="text-[10px] font-label-caps px-2 py-1 bg-primary/5 text-primary">${l(s.sessions)}\uD68C\uCC28</span>`:""}
            </div>
          </a>
        `}).join("")}function Kt(e){let n=k()[e.venueId]?.name||"\uC0C1\uC601\uAD00";return bn({session:e,programs:o.data?.programs,venueName:n})}function Ir(e){let t=String(e.program||"").trim();return/^2D-?영화제/.test(t)?j(t).replace(/^영화제\s*/,"")||e.screen||"\uC0C1\uC601":t||e.screen||"\uC0C1\uC601"}function jr(){let e=C();return(o.data.majorFestivals||[]).map(t=>{let n=t.startDate||t.date,r=t.endDate||n;if(!n||!r)return null;let a=t.showFrom||In(n,-1),s=t.showUntil||ct(r,1);if(e<a||e>s)return null;let i=t.periodLabel||jn(n,r);return{id:`major-festival-${t.id||t.name}`,kind:"major-festival",date:n,time:t.time||"\uAE30\uAC04",name:t.name||"\uC8FC\uC694 \uC601\uD654\uC81C",section:t.section||"\uC8FC\uC694 \uC601\uD654\uC81C",title:i,startDate:n,endDate:r,periodLabel:i,region:t.region||"",venueName:t.venueName||t.region||"",logoUrl:t.logoPath||t.logoUrl||"",logoTheme:t.logoTheme||"",accentColor:t.accentColor||"",accentTextColor:t.accentTextColor||"",programHighlights:Array.isArray(t.programHighlights)?t.programHighlights:[],highlightGroups:Array.isArray(t.highlightGroups)?t.highlightGroups:[],dailyHighlights:Array.isArray(t.dailyHighlights)?t.dailyHighlights:[],detailUrl:t.url||t.detailUrl,sourceLabel:t.sourceLabel||"",sourceUrl:t.sourceUrl||t.url||"",status:t.status||"confirmed",bookingType:"detail",actionLabel:t.actionLabel||"\uACF5\uC2DD"}}).filter(Boolean)}function Je(e,t){return e.venueName||e.region||t[e.venueId]?.name||""}function Te(e){return(e?.rows||[]).find(t=>t.kind==="major-festival")}function Ht(e){let t=Te(e),n=Qe(e);return!!(t&&!n?.expired&&(n?.tone==="active"||n?.tone==="ending"))}function _t(e,t){let n=Te(e);if(n)return[n.periodLabel,Je(n,t),n.section].filter(Boolean).join(" \xB7 ");let r=R(e.rows.map(i=>Je(i,t)),3),a=R(e.rows.map(i=>oe(i.date)),2),s=qt(e).length;return[a,r,`${e.rows.length}\uD68C\uCC28, ${s}\uAC1C \uC139\uC158`].filter(Boolean).join(" \xB7 ")}function Dr(e,t){let n=String(e.title||"").trim(),r=j(e.section||""),a=String(t||"").replace(/\s+/g,"").toLowerCase(),s=r.replace(/\s+/g,"").toLowerCase(),c=[[/\bEX[-\s]?Now\b/i,"EX-Now"],[/\bEX[-\s]?Choice\b/i,"EX-Choice"],[/\bAsia\s+Forum\b/i,"Asia Forum"],[/개막식|개막작/,"\uAC1C\uB9C9"],[/폐막식|폐막작/,"\uD3D0\uB9C9"],[/포럼|Forum/i,"\uD3EC\uB7FC"],[/포커스/i,"\uD3EC\uCEE4\uC2A4"]].find(([d])=>d.test(n));return c?c[1]:r&&s!==a&&!gn(r)&&!/영화제|페스티벌|KQFF/i.test(r)?r:`${I(e.date)} \uD504\uB85C\uADF8\uB7A8`}function qt(e){let t=new Map;for(let n of e?.rows||[]){if(n.kind==="major-festival")continue;let r=Dr(n,e.name);t.has(r)||t.set(r,{label:r,rows:[]}),t.get(r).rows.push(n)}return[...t.values()]}function Ar(e){return[R(e.rows.map(n=>I(n.date)),2),`${e.rows.length}\uD68C`].filter(Boolean).join(" \xB7 ")}function Fr(){let e=jr(),t=G().filter(De).map(s=>({id:`festival-${s.id}`,date:s.date,time:s.time,name:Kt(s),section:Ir(s),title:s.title,venueId:s.venueId,bookingUrl:s.bookingUrl,detailUrl:s.detailUrl,bookingType:s.bookingType,actionLabel:s.actionLabel})),n=(o.data.festivals||[]).filter(s=>!Lt(s)).filter(s=>{let i=/확인 필요|시간표 확인|needs-check|시간 확인/i.test(`${s.status||""} ${s.title||""} ${s.time||""}`),c=t.some(d=>{if(d.venueId!==s.venueId)return!1;let u=`${d.name||""} ${d.section||""} ${d.title||""}`,h=`${s.name||""} ${s.section||""} ${s.title||""}`;return u.includes(s.name||"")||h.includes(d.name||"")});return!(i&&c)}),r=[...e,...n,...t],a=new Set;return r.filter(s=>{let i=`${s.kind||"festival"}|${s.date}|${s.time}|${s.venueId||s.name}|${s.title}`;return a.has(i)?!1:(a.add(i),!0)}).sort((s,i)=>`${s.date} ${s.time}`.localeCompare(`${i.date} ${i.time}`))}function Nr(e){return Object.entries(O(e,t=>t.name||"\uC601\uD654\uC81C")).map(([t,n])=>{let r=n.sort((i,c)=>`${i.date} ${i.time}`.localeCompare(`${c.date} ${c.time}`)),a=r.find(i=>i.kind==="major-festival"),s=a?{start:a.startDate||a.date,end:a.endDate||a.date}:Ve("",r.map(i=>i.date));return{name:t,rows:r,range:s,lifecycle:ie(s)}}).sort((t,n)=>{let r=Number(Ht(n))-Number(Ht(t));return r||Pt(t.range,t.lifecycle,`${t.rows[0]?.date||""} ${t.name}`,n.range,n.lifecycle,`${n.rows[0]?.date||""} ${n.name}`)})}function Qe(e){return e?.lifecycle||ie(e?.range||Ve("",(e?.rows||[]).map(t=>t.date)))}function Gt(e,t=!1){let n=X(e),r=Y(e),a=r!=="#",s=e.bookingType==="booking"?"bg-primary text-surface":"festival-action text-primary",i=t?"px-3 py-1 text-[10px]":"px-3 py-2 text-xs";return a?`<a class="inline-flex ${i} font-bold transition-colors ${s}" href="${l(r)}" target="_blank" rel="noopener noreferrer">${l(n)}</a>`:`<span class="inline-flex ${i} font-bold border border-outline-variant/40 text-on-surface-variant">\uD655\uC778\uC911</span>`}function Ot(e,t=!1){if(!e?.logoUrl)return"";let n=t?"h-7 w-16":"h-9 w-24",r=e.logoTheme==="dark"?"festival-logo-dark":"bg-surface-container-lowest";return`
      <span class="festival-logo-box festival-logo-inline ${n} ${r}">
        <img src="${l(e.logoUrl)}" alt="${l(e.name)} \uB85C\uACE0" loading="lazy" />
      </span>
    `}function zt(e,t=!1){let n=Array.isArray(e?.highlightGroups)?e.highlightGroups.filter(i=>i?.label&&Array.isArray(i.items)&&i.items.length):[];if(n.length)return`
        <div class="festival-highlight-details mt-3">
          ${n.slice(0,6).map(i=>{let c=M(i.url,"");return`
                <details class="festival-highlight-detail">
                  <summary>${c?`<a class="festival-highlight-title-link" href="${l(c)}" target="_blank" rel="noopener noreferrer" data-stop-propagation>${l(i.label)}</a>`:`<span>${l(i.label)}</span>`}</summary>
                  <div>
                    ${i.items.filter(Boolean).slice(0,4).map(u=>`<span>${l(u)}</span>`).join("")}
                  </div>
                </details>
              `}).join("")}
        </div>
      `;let r=Array.isArray(e?.dailyHighlights)?e.dailyHighlights:[],a=t?2:3;if(r.length)return`
        <div class="festival-highlight-days mt-3">
          ${r.slice(0,a).map(i=>{let c=Array.isArray(i.items)?i.items.filter(Boolean).slice(0,t?2:3):[];return!i.date||!c.length?"":`
                <span class="festival-highlight-day">
                  <strong>${l(I(i.date))}</strong>
                  <span>${l(c.join(" \xB7 "))}</span>
                </span>
              `}).join("")}
        </div>
      `;let s=Array.isArray(e?.programHighlights)?e.programHighlights.filter(Boolean):[];return s.length?`
      <div class="festival-highlight-chips mt-3">
        ${s.slice(0,t?4:6).map(i=>`<span>${l(i)}</span>`).join("")}
      </div>
    `:""}function Yt(e,t){let n=qt(e);return n.length?`
      <div class="festival-highlight-details festival-schedule-details mt-3">
        ${n.map(r=>`
              <details class="festival-highlight-detail festival-schedule-detail">
                <summary>
                  <span class="festival-schedule-section-summary">
                    <strong>${l(r.label)}</strong>
                    <small>${l(Ar(r))}</small>
                  </span>
                </summary>
                <div class="festival-schedule-items">
                  ${r.rows.map(a=>{let s=Je(a,t),i=X(a),c=Y(a),d=c!=="#",u=Fn(a.date,"text-on-surface-variant"),h=a.bookingType==="booking"?"bg-primary text-surface":"border border-primary/20 text-primary",w=d?"a":"span",p=d?`href="${l(c)}" target="_blank" rel="noopener noreferrer" aria-label="${l(`${a.title} ${oe(a.date)} ${a.time} ${s} ${i}`)}"`:"";return`
                        <${w} class="festival-schedule-item" ${p}>
                          <span class="festival-schedule-when ${u}">
                            <strong>${l(oe(a.date))}</strong>
                            <small>${l(a.time)}</small>
                          </span>
                          <span class="festival-schedule-copy">
                            <strong title="${l(a.title)}">${l(a.title)}</strong>
                            <small>${l(s)}</small>
                          </span>
                          <span class="festival-schedule-action ${d?h:"border border-outline-variant/40 text-on-surface-variant"}">${l(d?i:"\uD655\uC778\uC911")}</span>
                        </${w}>
                      `}).join("")}
                </div>
              </details>
            `).join("")}
      </div>
    `:""}function Br(){let e=k(),t=Fr(),n=Nr(t),r=m("#festivalRows"),a=m("#mobileFestivalList"),s=S();s?r?.replaceChildren():a?.replaceChildren(),r&&!s&&(r.innerHTML=n.length?n.map(i=>{let c=Qe(i),d=_t(i,e),u=Te(i);if(u){let w=Ot(u),p=zt(u);return`
                  <tr class="festival-group-row major-festival-row">
                    <td class="px-4 py-5 align-top" colspan="4">
                      <div class="min-w-0">
                        <span class="major-festival-heading flex min-w-0 flex-wrap items-center gap-3 md:gap-4">
                          <strong class="major-festival-title block text-lg text-primary truncate">${l(i.name)}</strong>
                          ${w}
                          ${ne(c)}
                        </span>
                        <small class="major-festival-summary mt-1 block text-on-surface-variant">${l(d)}</small>
                        ${p}
                      </div>
                    </td>
                    <td class="px-4 py-5 align-middle whitespace-nowrap">${Gt(u)}</td>
                  </tr>
                `}let h=Yt(i,e);return`
                <tr class="festival-group-row">
                  <td class="px-4 py-4 align-top" colspan="5">
                    <div class="flex items-start justify-between gap-4">
                      <span class="min-w-0">
                        <span class="flex min-w-0 items-center gap-2">
                          <strong class="festival-group-title block text-base text-primary truncate">${l(i.name)}</strong>
                          ${ne(c)}
                        </span>
                        <small class="festival-group-summary mt-1 block text-on-surface-variant">${l(d)}</small>
                      </span>
                    </div>
                    ${h}
                  </td>
                </tr>
              `}).join(""):'<tr><td class="px-4 py-6 text-on-surface-variant" colspan="5">\uB4F1\uB85D\uB41C \uC601\uD654\uC81C \uC2DC\uAC04\uD45C\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.</td></tr>'),a&&s&&(a.innerHTML=n.length?n.map(i=>{let c=Qe(i),d=_t(i,e),u=Te(i);if(u){let w=Ot(u,!0),p=zt(u,!0);return`
                  <div class="festival-mobile-card major-festival-mobile-card">
                    <div class="major-festival-panel p-4">
                      <div class="flex items-start justify-between gap-3">
                        <span class="min-w-0">
                          <span class="major-festival-heading flex min-w-0 flex-wrap items-center gap-3">
                            <strong class="major-festival-title block min-w-0 text-base text-primary truncate">${l(i.name)}</strong>
                            ${w}
                            ${ne(c,!0)}
                          </span>
                          <span class="major-festival-summary mt-1 block text-xs text-on-surface-variant">${l(d)}</span>
                        </span>
                        <span class="shrink-0">${Gt(u,!0)}</span>
                      </div>
                      ${p}
                    </div>
                  </div>
                `}let h=Yt(i,e);return`
              <div class="festival-mobile-card">
                <div class="festival-group-panel p-4">
                  <span class="flex items-center gap-2">
                    <strong class="festival-group-title block min-w-0 text-base text-primary truncate">${l(i.name)}</strong>
                    ${ne(c,!0)}
                  </span>
                  <span class="festival-group-summary mt-1 block text-xs text-on-surface-variant">${l(d)}</span>
                  ${h}
                </div>
              </div>
            `}).join(""):'<div class="p-5 bg-surface-container-lowest border border-outline-variant/10 text-sm text-on-surface-variant">\uB4F1\uB85D\uB41C \uC601\uD654\uC81C \uC2DC\uAC04\uD45C\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.</div>')}function Zt(e){return String(e||"").replace(/\([^)]*\)/g,"").replace(/[^\p{Letter}\p{Number}]+/gu,"").toLowerCase()}function Ur(e){let t=Zt(e?.title);return t?W(G().filter(n=>{let r=Zt(n.title);return r&&(r.includes(t)||t.includes(r))})):[]}function Er(){return(Array.isArray(o.communityTrends?.items)?o.communityTrends.items:[]).filter(t=>t?.title).map((t,n)=>{let r=Ur(t),a=r[0];return{...t,rank:t.rank||n+1,sessions:r,firstSession:a,posterUrl:t.posterUrl||a?.posterUrl||"",url:a?Y(a):M(t.url,"#")}}).slice(0,4)}function Rr(e){let t=k(),n=C(),a=(e.sessions||[]).filter(c=>c.date===n)[0]||e.firstSession;if(!a)return e.caption||"\uC0C1\uC601 \uC77C\uC815 \uD655\uC778 \uC911";let s=t[a.venueId]?.name||"\uC0C1\uC601\uAD00";return`${a.date===n?"\uC624\uB298":I(a.date)} ${a.time} \xB7 ${s}`}function Jt(e){let t=Number(e?.rank||0);return t>0?String(t).padStart(2,"0"):""}function Pr(e){return`https://www.youtube.com/results?search_query=${encodeURIComponent(`${e||"\uC601\uD654"} \uC608\uACE0\uD3B8`)}`}function Vr(e){return M(e?.trailerUrl,"")||Pr(e?.title)}function Kr(e,t=2){let n=k(),r=new Set,a=[];for(let s of e.sessions||[]){let i=Y(s);if(!i||i==="#")continue;let c=s.venueId||"",d=n[c]?.name||s.venueName||s.venue||"\uC0C1\uC601\uAD00",u=c||d;if(!r.has(u)&&(r.add(u),a.push({url:i,venueName:d,timeLabel:`${s.date===C()?"\uC624\uB298":I(s.date)} ${s.time||""}`.trim()}),a.length>=t))break}return a}function Qt(e,t=!1){let n=Kr(e,2);return n.length?`
      <div class="${t?"mt-3 grid gap-2":"mt-4 grid gap-2"}">
        ${n.map(r=>t?`
              <a class="flex min-w-0 flex-col gap-1 border border-primary/10 px-3 py-2 text-primary active:bg-primary active:text-surface" href="${pe(r.url)}" target="_blank" rel="noopener noreferrer" aria-label="${l(`${r.venueName} ${r.timeLabel} \uC608\uB9E4`)}">
                <span class="truncate text-[12px] font-bold">${l(r.venueName)}</span>
                <span class="text-[10px] font-medium text-on-surface-variant">${l(r.timeLabel)}</span>
              </a>
            `:`
              <a class="flex min-w-0 items-center justify-between gap-3 border border-primary/15 px-3 py-2 text-sm font-bold text-primary transition-colors hover:bg-primary hover:text-surface" href="${pe(r.url)}" target="_blank" rel="noopener noreferrer" aria-label="${l(`${r.venueName} ${r.timeLabel} \uC608\uB9E4`)}">
                <span class="min-w-0 truncate">${l(r.venueName)}</span>
                <span class="shrink-0 text-xs font-medium">${l(r.timeLabel)}</span>
              </a>
            `).join("")}
      </div>
    `:`<p class="${t?"mobile-meta mt-2":"mt-3 text-sm text-on-surface-variant"}">${l(Rr(e))}</p>`}function Wt(e,t,n,r=!1){let a=Vr(e),s={posterUrl:e.posterUrl,posterSourceUrl:e.posterSourceUrl};return`
      <a class="${t}" href="${pe(a)}" target="_blank" rel="noopener noreferrer" aria-label="${l(e.title)} \uC608\uACE0\uD3B8 \uBCF4\uAE30">
        ${He(s,e.title,n,"",{priority:r})}
      </a>
    `}function Hr(e,t=!1,n=!1){return t?`
        <article class="grid w-[calc(100vw-4rem)] max-w-[19rem] shrink-0 snap-start grid-cols-[5.5rem_minmax(0,1fr)] gap-3 border border-outline-variant/20 bg-surface-container-lowest p-4">
          ${Wt(e,"relative block aspect-[2/3] w-full overflow-hidden bg-primary/5","h-full w-full object-cover",n)}
          <div class="flex min-w-0 flex-col justify-start">
            <span class="mb-1 text-[19px] font-black leading-none text-primary">${l(Jt(e))}</span>
            <strong class="mobile-row-title line-clamp-2">${l(e.title)}</strong>
            ${Qt(e,!0)}
          </div>
        </article>
      `:`
      <article class="group flex min-h-52 flex-col border border-primary/10 bg-surface p-4">
        ${Wt(e,"relative mx-auto mb-5 block aspect-[2/3] w-full max-w-[13rem] overflow-hidden bg-primary/5","h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]",n)}
        <span class="mb-2 block text-[22px] font-black leading-none text-primary">${l(Jt(e))}</span>
        <h3 class="line-clamp-2 text-lg font-bold leading-snug">${l(e.title)}</h3>
        ${Qt(e)}
      </article>
    `}function _r(){let e=Er(),t=!!o.query.trim(),n=o.view==="today"&&!t,r=m("#popular"),a=m("#mobile-popular"),s=m("#popularList"),i=m("#mobilePopularList"),c=S(),d=c?a:r,u=c?r:a,h=c?i:s,w=c?s:i;d?.classList.toggle("hidden",!n||!e.length),u?.classList.add("hidden"),w?.replaceChildren(),[m("#popularUpdatedAt"),m("#mobilePopularUpdatedAt")].forEach(p=>{p&&(p.textContent="",p.classList.add("hidden"))}),h&&(h.innerHTML=n&&e.length?e.map((p,x)=>Hr(p,c,x===0)).join(""):"")}async function qr(){try{let e=await fetch("data/community-trends.json",{cache:"no-cache"});if(!e.ok)throw new Error(`data/community-trends.json ${e.status}`);o.communityTrends=await e.json()}catch{o.communityTrends={items:[]}}}function D(){if(!o.data)return;let e=S();o.lastRenderedMobileLayout=e,Ke();let t=ht(),n=o.query.trim()?ht({includeDate:!1,includeLinkFilter:!1,includeVenueFilter:!1}):t;Bn(),ur(),br(n),Vn(),Kn(),o.query.trim()?(m("#desktopSchedule")?.replaceChildren(),m("#mobileSchedule")?.replaceChildren()):e?(m("#desktopSchedule")?.replaceChildren(),cr(t)):(m("#mobileSchedule")?.replaceChildren(),ar(t)),o.query.trim()?[m("#programList"),m("#mobileProgramList"),m("#festivalRows"),m("#mobileFestivalList")].forEach(r=>r?.replaceChildren()):(Cr(),Br()),_r(),Un(),We(),we()}function Xt(){document.body.classList.remove("app-loading");let e=m("#bootFallback");e&&e.remove()}function We(){if(!window.location.hash)return;let e=window.location.hash;if(o.hashSyncKey===e)return;o.hashSyncKey=e;let t=()=>{let n=xn(e.slice(1)),r=n?document.getElementById(n):null;if(!r)return;let a=r.getBoundingClientRect().top+window.scrollY-$e();window.scrollTo({top:Math.max(0,a),behavior:"auto"}),ye(n)};window.requestAnimationFrame(t),[80,300,700,1400,2400].forEach(n=>window.setTimeout(t,n))}function Me(e){let t=m("#toast");t.textContent=e,t.classList.add("visible"),window.setTimeout(()=>t.classList.remove("visible"),1800)}let Z=null;function Xe(e){o.query=e,[m("#searchInput"),m("#tabletSearchInput"),m("#mobileSearchInput")].forEach(t=>{t&&t.value!==e&&(t.value=e)}),Z&&clearTimeout(Z),Z=window.setTimeout(()=>{Z=null,D()},180)}async function Ce(e={}){if(!o.data||o.dataRefreshing)return!1;let t=Date.now();if(!e.force&&t-o.lastDataRefreshAt<v)return!1;o.dataRefreshing=!0;try{let n=await an(),r=ut(n);return o.lastDataRefreshAt=Date.now(),r===o.dataSignature?!1:(dt(n),D(),!0)}catch{return!1}finally{o.dataRefreshing=!1}}function Gr(){let e=()=>{pt(),document.hidden||Ce()};document.addEventListener("visibilitychange",()=>{document.hidden||e()}),window.addEventListener("focus",e),window.addEventListener("online",()=>Ce({force:!0})),window.setInterval(()=>{!pt({refreshData:!0})&&!document.hidden&&Ce()},y)}function en(e){let t=m("#mobileSearchPanel"),n=m("#mobileSearchButton"),r=n?.querySelector(".ui-icon use");t?.classList.toggle("hidden",!e),n?.setAttribute("aria-expanded",String(e)),n?.setAttribute("aria-label",e?"\uAC80\uC0C9 \uB2EB\uAE30":"\uAC80\uC0C9 \uC5F4\uAE30"),r&&r.setAttribute("href",`${Fe}#${e?"x":"search"}`)}function et(e){let t=m("#tabletSearchPanel"),n=m("#tabletSearchButton"),r=n?.querySelector(".ui-icon use");t?.classList.toggle("hidden",!e),n?.setAttribute("aria-expanded",String(e)),n?.setAttribute("aria-label",e?"\uAC80\uC0C9 \uB2EB\uAE30":"\uAC80\uC0C9 \uC5F4\uAE30"),r&&r.setAttribute("href",`${Fe}#${e?"x":"search"}`)}function tn(){Z&&(clearTimeout(Z),Z=null),o.query="",[m("#searchInput"),m("#tabletSearchInput"),m("#mobileSearchInput")].forEach(e=>{e&&(e.value="")}),D()}function nn(){tn(),en(!1)}function rn(){tn(),et(!1)}function Or(){m("#searchInput")?.addEventListener("input",t=>Xe(t.target.value)),m("#tabletSearchInput")?.addEventListener("input",t=>Xe(t.target.value)),m("#mobileSearchInput")?.addEventListener("input",t=>Xe(t.target.value)),m("#tabletSearchButton")?.addEventListener("click",()=>{m("#tabletSearchPanel")?.classList.contains("hidden")?(et(!0),window.setTimeout(()=>m("#tabletSearchInput")?.focus(),30)):rn()}),m("#mobileSearchButton")?.addEventListener("click",()=>{m("#mobileSearchPanel")?.classList.contains("hidden")?(en(!0),window.setTimeout(()=>m("#mobileSearchInput")?.focus(),30)):nn()}),m("#mobileSearchInput")?.addEventListener("keydown",t=>{t.key==="Escape"&&(nn(),m("#mobileSearchButton")?.focus())}),m("#tabletSearchInput")?.addEventListener("keydown",t=>{t.key==="Escape"&&(rn(),m("#tabletSearchButton")?.focus())}),document.addEventListener("click",t=>{t.target.closest("[data-stop-propagation]")&&t.stopPropagation();let n=t.target.closest("[data-nav-target]");if(n){let c=n.dataset.navTarget;if(c&&Ge(c)){t.preventDefault(),o.hashSyncKey="",history.pushState(null,"",`#${encodeURIComponent(c)}`);return}}let r=t.target.closest("[data-date]");if(r){let c=r.dataset.date||"";o.date=c||null,D(),[...document.querySelectorAll("[data-date]")].find(u=>u.dataset.date===c)?.focus({preventScroll:!0});return}let a=t.target.closest("[data-view]");if(a){let c=a.dataset.view;o.view=c,o.venueFilter="all",D();return}let s=t.target.closest("[data-favorite-venue]");if(s){t.preventDefault(),t.stopPropagation(),Tn(s.dataset.favoriteVenue||"");return}let i=t.target.closest("[data-venue-jump]");if(i){qn(i.dataset.venueJump||"all");return}t.target.closest("[data-retry-load]")&&window.location.reload()}),window.addEventListener("hashchange",()=>{o.hashSyncKey="",window.setTimeout(We,0),window.setTimeout(We,300),window.setTimeout(we,320)});let e=!1;window.addEventListener("scroll",()=>{e||(e=!0,requestAnimationFrame(()=>{e=!1,we()}))},{passive:!0}),window.addEventListener("resize",()=>{if((window.innerWidth<768||window.innerWidth>=1024)&&et(!1),o.data&&o.lastRenderedMobileLayout!==S()){qe=null,D();return}we()}),Gr()}function zr(e){if(!e||typeof e!="object")throw new Error("schedule payload is not an object");for(let t of["venues","sessions","programs","sources"])if(!Array.isArray(e[t]))throw new Error(`schedule payload is missing ${t}`);return e}async function an(){let e=await fetch("data/schedule.json",{cache:"no-cache"});if(!e.ok)throw new Error(`data/schedule.json ${e.status}`);return zr(await e.json())}function Yr(){Xt();let e=`
      <div class="border border-primary/10 bg-surface p-10 text-center text-on-surface-variant" role="alert">
        <strong class="block text-primary">\uC2DC\uAC04\uD45C \uB370\uC774\uD130\uB97C \uBD88\uB7EC\uC624\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.</strong>
        <span class="mt-2 block text-sm">\uC778\uD130\uB137 \uC5F0\uACB0\uC744 \uD655\uC778\uD55C \uB4A4 \uB2E4\uC2DC \uC2DC\uB3C4\uD574 \uC8FC\uC138\uC694.</span>
        <button class="mt-4 inline-flex items-center gap-2 border border-primary bg-primary px-4 py-2 text-sm font-bold text-surface" type="button" data-retry-load>
          ${Ne("refresh-cw","ui-icon-sm")}
          \uB2E4\uC2DC \uC2DC\uB3C4
        </button>
      </div>
    `;m("#desktopSchedule").innerHTML=e,m("#mobileSchedule").innerHTML=e}async function Zr(){Or();try{o.favoriteVenueIds=$n();let[e]=await Promise.all([an(),qr()]);dt(e,{resetDate:!0}),D(),Xt()}catch{Yr()}}document.addEventListener("DOMContentLoaded",Zr)})();})();
