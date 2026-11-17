export const UI_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Elefant Relay</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--line:#e4e7ec;--ink:#1d2433;--sub:#667085;--ok:#067647;--okbg:#e7f6ee;--ask:#8a5a00;--askbg:#fff4d6;--no:#b42318;--nobg:#fde8e6;--accent:#5b3fd1;--accentbg:#efeafd}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","Hiragino Sans","Noto Sans JP",sans-serif}
main{max-width:1080px;margin:0 auto;padding:28px 24px 64px}
header{display:flex;align-items:baseline;justify-content:space-between;gap:16px;margin-bottom:20px}
h1{font-size:22px;margin:0}
h2{font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--sub);margin:32px 0 12px}
.muted{color:var(--sub);font-size:13px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px}
.me{display:flex;flex-wrap:wrap;gap:12px 32px}
.me div{min-width:140px}.me .k{font-size:12px;color:var(--sub)}.me .v{font-weight:600;word-break:break-all}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(440px,1fr));gap:14px}
.peer h3{margin:0 0 2px;font-size:17px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.tag{font-size:11px;font-weight:600;padding:2px 8px;border-radius:99px;background:var(--accentbg);color:var(--accent)}
.warn{margin:10px 0 0;padding:8px 10px;border-radius:8px;background:var(--askbg);color:var(--ask);font-size:13px;font-weight:600}
.perm{display:grid;grid-template-columns:130px 1fr;gap:4px 12px;padding:10px 0;border-top:1px solid var(--line);margin-top:10px}
.perm:first-of-type{margin-top:12px}
.perm .m{font-weight:600}.perm .m small{display:block;font-weight:400;color:var(--sub);font-size:12px}
.pill{display:inline-block;white-space:nowrap;font-size:13px;font-weight:600;padding:2px 10px;border-radius:99px}
.allow{background:var(--okbg);color:var(--ok)}.ask{background:var(--askbg);color:var(--ask)}.deny{background:var(--nobg);color:var(--no)}
.why{font-size:12px;color:var(--sub);margin-top:3px}
.exp{color:var(--no);font-weight:600}
.meta{font-size:12px;color:var(--sub);margin-top:6px;word-break:break-all}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden;font-size:13px}
th,td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--line);vertical-align:top}
th{background:#fafbfc;color:var(--sub);font-weight:600;font-size:12px}
tr:last-child td{border-bottom:0}
tr.expired td{color:var(--sub);background:#fafafa}
code{font:12px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:#f2f4f7;border-radius:6px;padding:2px 6px;user-select:all;white-space:nowrap}
.pend{white-space:pre-wrap;word-break:break-word;margin:6px 0 0;font-size:13px}
.empty{color:var(--sub);font-size:14px;padding:6px 2px}
.err{color:var(--no);font-weight:600}
@media(max-width:560px){.grid{grid-template-columns:1fr}.perm{grid-template-columns:1fr}}
</style>
</head>
<body>
<main>
<header><h1 id="title"></h1><span class="muted" id="updated"></span></header>
<div id="root"></div>
</main>
<script>
(function(){
var T={
en:{title:"Elefant Relay: who can do what",me:"Me",name:"Name",mode:"Mode",own:"Own computers",people:"With people",files:"Files",on:"on",off:"off",relay:"Relay",agent:"Agent",listening:"Listening",yes:"yes",no:"no — run elefant-relay start",notSetUp:"Not set up yet. Run: elefant-relay setup --relay URL",
peers:"Connected people and computers",noPeers:"Nobody is connected yet.",ownTag:"your computer",peopleTag:"someone else",read:"read",write:"write",readHelp:"look things up",writeHelp:"may create files in the work folder",
allow:"runs without asking",ask:"asks you first",deny:"declined",rule:"rule",until:"until",noUntil:"no expiry",expired:"expired",expiredRule:"rule expired",noRule:"no rule",
everything:"Runs everything without asking: this computer is trusted as yours.",folder:"Shared folder",paired:"Paired",check:"Check number",
rules:"All rules",id:"ID",action:"Action",peerMode:"Person / mode",note:"Note",change:"Remove with",noRules:"No rules. Every request is asked.",allowW:"allow",denyW:"deny",forever:"never expires",
pending:"Waiting requests",from:"From",text:"Request",none:"Nothing is waiting.",pendHelp:"Answer with elefant-relay approve ID or elefant-relay deny ID",
log:"Recent activity",time:"Time",peer:"Person",event:"Event",status:"Result",noLog:"No activity yet.",updated:"Updated",readOnly:"read-only",error:"Could not load: "},
ja:{title:"Elefant Relay: 誰に何を許しているか",me:"自分",name:"名前",mode:"使い方",own:"自分のコンピュータどうし",people:"誰かと",files:"ファイル",on:"オン",off:"オフ",relay:"中継",agent:"AI",listening:"待ち受け",yes:"はい",no:"いいえ（elefant-relay start で起動）",notSetUp:"まだ設定されていません。elefant-relay setup --relay URL を実行してください",
peers:"つながっている人・コンピュータ",noPeers:"まだ誰ともつながっていません。",ownTag:"自分のコンピュータ",peopleTag:"他の人",read:"read",write:"write",readHelp:"調べものだけ",writeHelp:"作業フォルダにファイルを作れる",
allow:"聞かずに実行",ask:"先に聞く",deny:"断る",rule:"ルール",until:"期限",noUntil:"期限なし",expired:"期限切れ",expiredRule:"ルールの期限切れ",noRule:"ルールなし",
everything:"すべて聞かずに実行します。このコンピュータは自分のものとして信頼されています。",folder:"共有フォルダ",paired:"接続日",check:"確認番号",
rules:"すべてのルール",id:"ID",action:"動作",peerMode:"相手 / 種類",note:"メモ",change:"消すには",noRules:"ルールはありません。すべて先に聞きます。",allowW:"許可",denyW:"拒否",forever:"期限なし",
pending:"承認待ちの依頼",from:"依頼元",text:"依頼内容",none:"待っている依頼はありません。",pendHelp:"elefant-relay approve ID または elefant-relay deny ID で答えます",
log:"最近の動き",time:"時刻",peer:"相手",event:"出来事",status:"結果",noLog:"まだ動きはありません。",updated:"更新",readOnly:"閲覧のみ",error:"読み込めません: "}
};
var lang=(navigator.language||"").toLowerCase().indexOf("ja")===0?"ja":"en";
var L=T[lang];
document.documentElement.lang=lang;
document.title=L.title;
document.getElementById("title").textContent=L.title;
var token=new URLSearchParams(location.search).get("t")||"";
function h(tag,cls){var e=document.createElement(tag);if(cls)e.className=cls;for(var i=2;i<arguments.length;i++){var c=arguments[i];if(c==null||c===false)continue;e.appendChild(typeof c==="string"?document.createTextNode(c):c);}return e;}
function fmt(iso){if(!iso)return "";var d=new Date(iso);return isNaN(d)?iso:d.toLocaleString(lang==="ja"?"ja-JP":"en-GB",{dateStyle:"medium",timeStyle:"short"});}
function sec(title,body){return h("section",null,h("h2",null,title),body);}
function pill(a){return h("span","pill "+a,L[a]);}
function permRow(mode,p){
  var why=[];
  if(p.ruleId){why.push(L.rule+" "+p.ruleId+" ("+p.ruleLabel+")");why.push(p.until?L.until+" "+fmt(p.until):L.noUntil);if(p.note)why.push(p.note);}
  else if(p.expiredRuleId){why.push(h("span","exp",L.expiredRule+": "+p.expiredRuleId+" ("+fmt(p.expiredUntil)+")"));}
  else why.push(L.noRule);
  var w=h("div","why");
  why.forEach(function(x,i){if(i)w.appendChild(document.createTextNode(" · "));w.appendChild(typeof x==="string"?document.createTextNode(x):x);});
  return h("div","perm",h("div","m",L[mode],h("small",null,L[mode+"Help"])),h("div",null,pill(p.action),w));
}
function peerCard(x){
  var c=h("div","card peer",h("h3",null,x.name,h("span","tag",x.kind==="own"?L.ownTag:L.peopleTag)));
  if(x.runsEverythingWithoutAsking)c.appendChild(h("div","warn",L.everything));
  c.appendChild(permRow("read",x.perms.read));
  c.appendChild(permRow("write",x.perms.write));
  var m=[];
  if(x.folderPath)m.push(L.folder+": "+x.folderPath);
  if(x.added)m.push(L.paired+": "+fmt(x.added));
  if(x.safety)m.push(L.check+": "+x.safety);
  m.forEach(function(t){c.appendChild(h("div","meta",t));});
  return c;
}
function table(heads,rows){
  var tr=h("tr");heads.forEach(function(t){tr.appendChild(h("th",null,t));});
  var tb=h("tbody");rows.forEach(function(r){tb.appendChild(r);});
  return h("table",null,h("thead",null,tr),tb);
}
function render(s){
  var root=document.getElementById("root");
  var f=document.createDocumentFragment();
  var me=s.me;
  if(me){
    var items=[[L.name,me.name],[L.mode,me.use==="own"?L.own:L.people],[L.files,me.files?L.on:L.off],[L.relay,me.relay],[L.agent,me.agent],[L.listening,me.listening?L.yes:L.no]];
    var box=h("div","card me");
    items.forEach(function(i){box.appendChild(h("div",null,h("div","k",i[0]),h("div","v",i[1])));});
    f.appendChild(sec(L.me,box));
  }else f.appendChild(sec(L.me,h("div","card",L.notSetUp)));
  var grid=h("div","grid");
  s.peers.forEach(function(x){grid.appendChild(peerCard(x));});
  f.appendChild(sec(L.peers,s.peers.length?grid:h("div","empty",L.noPeers)));
  var rr=s.rules.map(function(r){
    var tr=h("tr",r.expired?"expired":"");
    tr.appendChild(h("td",null,h("code",null,r.id)));
    tr.appendChild(h("td",null,h("span","pill "+r.action,r.action==="allow"?L.allowW:L.denyW)));
    tr.appendChild(h("td",null,r.peer+" / "+r.mode));
    tr.appendChild(h("td",null,r.until?fmt(r.until):L.forever,r.expired?h("span","exp"," "+L.expired):null));
    tr.appendChild(h("td",null,r.note||""));
    tr.appendChild(h("td",null,h("code",null,r.command)));
    return tr;
  });
  f.appendChild(sec(L.rules,s.rules.length?table([L.id,L.action,L.peerMode,L.until,L.note,L.change],rr):h("div","empty",L.noRules)));
  var pr=s.pending.map(function(x){
    var tr=h("tr");
    tr.appendChild(h("td",null,x.peer));
    tr.appendChild(h("td",null,x.mode));
    tr.appendChild(h("td",null,h("div","pend",x.text),h("div","meta",fmt(x.received)+" · elefant-relay approve "+x.id+" / elefant-relay deny "+x.id)));
    return tr;
  });
  f.appendChild(sec(L.pending,s.pending.length?table([L.from,L.mode,L.text],pr):h("div","empty",L.none)));
  var lr=s.log.map(function(e){
    var tr=h("tr");
    tr.appendChild(h("td",null,fmt(e.at)));
    tr.appendChild(h("td",null,e.peer||""));
    tr.appendChild(h("td",null,e.event));
    tr.appendChild(h("td",null,e.mode||""));
    tr.appendChild(h("td",null,e.status||""));
    return tr;
  });
  f.appendChild(sec(L.log,s.log.length?table([L.time,L.peer,L.event,L.mode,L.status],lr):h("div","empty",L.noLog)));
  root.replaceChildren(f);
  document.getElementById("updated").textContent=L.readOnly+" · "+L.updated+" "+fmt(s.now);
}
function load(){
  fetch("/api/state?t="+encodeURIComponent(token),{cache:"no-store"}).then(function(r){
    if(!r.ok)throw new Error(String(r.status));
    return r.json();
  }).then(render).catch(function(e){
    document.getElementById("updated").textContent=L.error+e.message;
  });
}
load();
setInterval(load,5000);
})();
</script>
</body>
</html>
`;
